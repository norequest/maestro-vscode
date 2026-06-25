/**
 * Parser for Copilot's `/fleet ... --output-format json` stream.
 *
 * In fleet mode Maestro spawns ONE `copilot` session for the conductor and
 * drives it with a `/fleet ...` prompt. Copilot's built-in orchestrator runs the
 * named custom agents (e.g. scribe-alpha, scribe-beta) as IN-SESSION sub-agents
 * and reports their lifecycle on the JSONL stream (one JSON object per line,
 * envelope `{ "type": "<name>", "data": { ... } }`). This module maps one parsed
 * line to zero-or-one {@link AgentEvent}, always degrading gracefully: any line
 * that is not valid JSON, or whose shape we do not model, becomes a raw `output`
 * event, so the stream is never dropped and parsing never throws.
 *
 * The parser is STATEFUL: it tracks the toolCallId of every sub-agent it has
 * seen `start` so it can correctly attribute later assistant/tool output. The
 * discriminator for "this output belongs to a sub-agent" is the presence of
 * `data.parentToolCallId` (or, equivalently, a top-level `agentId`) whose value
 * is a KNOWN sub-agent callId. It is NEVER `data.parentId`: that is the
 * assistant TURN id and is present on the conductor's OWN top-level narration.
 *
 * Verified schema (from a real fleet run, copilot v1.0.65):
 *   - subagent.started -> data: { toolCallId, agentName, agentDisplayName, agentDescription, model };
 *       ALSO a top-level `agentId` equal to that toolCallId.
 *   - subagent.completed -> data: { toolCallId, agentName, agentDisplayName, model }
 *   - session.background_tasks_changed -> fleet task-state churn (ignored)
 *   - tool.execution_start -> data: { toolName, arguments, toolCallId, parentToolCallId? };
 *       (toolName === "task" at top level is the orchestrator delegating)
 *   - tool.execution_partial_result / tool.execution_complete -> tool lifecycle (skipped)
 *   - assistant.message_delta / assistant.message -> assistant text; a frame
 *       PRODUCED BY a sub-agent carries `data.parentToolCallId` (== the
 *       sub-agent's toolCallId) AND a top-level `agentId`; a TOP-LEVEL conductor
 *       frame carries NEITHER (only a generic `parentId`, which we must ignore).
 *   - result -> data: { sessionId, exitCode, usage: { ..., codeChanges: { filesModified } } }
 */

import type { AgentEvent } from "@maestro/core";

/** Prefix marking a rendered tool/action line, matching {@link renderJsonLine}. */
const TOOL_PREFIX = "▸";

/**
 * Stateful per-session parser for the fleet JSONL stream. Instantiate ONE per
 * conductor session and feed it every complete (spinner-cleaned) stdout line via
 * {@link parse}; it remembers which toolCallIds belong to sub-agents so that
 * later output is attributed correctly. {@link parse} maps one line to a single
 * {@link AgentEvent}, or `null` when the line carries no signal (background-task
 * churn, a skipped tool-lifecycle frame, an empty delta). An unparseable line or
 * an unmodeled JSON shape degrades to a raw `output` event; this never throws.
 */
export class FleetLineParser {
  /** toolCallIds of sub-agents seen `start`, used to attribute later output. */
  private readonly subAgentCallIds = new Set<string>();

  /**
   * Map one complete cleaned stdout line to a single {@link AgentEvent}, or
   * `null` when it carries no signal.
   *
   * @param line - one complete line from the stream, already spinner-cleaned. Any
   *   trailing newline is preserved on the raw fallback so concatenating output
   *   texts still reconstructs the original stream.
   */
  parse(line: string): AgentEvent | null {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return rawOutput(line); // not JSON at all -> raw fallback
    }
    if (!isRecord(parsed)) {
      return rawOutput(line); // valid JSON but not an object (array, number, ...)
    }

    const type = parsed["type"];
    // Fields can live under `data` (the verified envelope) or, defensively, at
    // the top level. Merge with `data` winning so a real envelope is read first.
    const data = isRecord(parsed["data"]) ? parsed["data"] : {};
    const field = (key: string): unknown => data[key] ?? parsed[key];
    // The sub-agent correlation key: a sub-agent frame carries
    // `data.parentToolCallId` (preferred) or, equivalently, a TOP-LEVEL
    // `agentId`. Crucially NOT `data.parentId` (the assistant turn id, present on
    // the conductor's own top-level narration too).
    const parentCallId = (): string | undefined =>
      str(data["parentToolCallId"]) ?? str(parsed["agentId"]);

    switch (type) {
      case "subagent.started": {
        // The sub-agent's own callId is its toolCallId (or the top-level agentId).
        const callId = str(field("toolCallId")) ?? str(parsed["agentId"]);
        const name = str(field("agentName"));
        if (!callId || !name) return rawOutput(line); // missing correlation key
        this.subAgentCallIds.add(callId);
        const description = str(field("agentDescription"));
        return description
          ? { kind: "subagent-started", callId, name, description }
          : { kind: "subagent-started", callId, name };
      }

      case "subagent.completed": {
        const callId = str(field("toolCallId"));
        if (!callId) return rawOutput(line);
        // Keep the id in the set: trailing output for a just-finished sub-agent
        // should still attribute to it, not degrade to top-level output.
        return { kind: "subagent-done", callId };
      }

      case "assistant.message":
      case "assistant.message_delta": {
        const text = messageText(field("text") ?? field("content") ?? field("delta"));
        if (text === undefined) return null; // empty/contentless delta -> no event
        return this.attribute(parentCallId(), text);
      }

      case "tool.execution_start": {
        const toolName = str(field("toolName")) ?? "tool";
        const parent = parentCallId();
        const args = isRecord(field("arguments")) ? (field("arguments") as Record<string, unknown>) : {};
        // The orchestrator delegating (top level, toolName "task"): surface the
        // delegation description as conductor narration. subagent.started carries
        // the same delegation, so we keep this terse and non-duplicative.
        if (!parent && toolName === "task") {
          const description = str(args["description"]) ?? "";
          return { kind: "output", text: `${TOOL_PREFIX} delegate: ${description}` };
        }
        const target = toolTarget(args);
        const text = target ? `${TOOL_PREFIX} ${toolName}: ${target}` : `${TOOL_PREFIX} ${toolName}`;
        return this.attribute(parent, text);
      }

      // Tool lifecycle frames add no signal beyond execution_start; skip them to
      // avoid spamming the stream (partial_result is the noisiest).
      case "tool.execution_partial_result":
      case "tool.execution_complete":
        return null;

      // Fleet background task-state churn: not user-visible signal.
      case "session.background_tasks_changed":
        return null;

      case "result": {
        const exitCode = num(field("exitCode"));
        if (exitCode !== undefined && exitCode !== 0) {
          return { kind: "error", message: `fleet run exited with code ${exitCode}` };
        }
        // Do NOT synthesize a Diff: the orchestrator computes the real git diff
        // from the conductor's worktree. Summarize files-modified when present.
        return { kind: "done", summary: resultSummary(field("usage")) };
      }

      default:
        return rawOutput(line); // recognized JSON object, unmodeled type -> raw fallback
    }
  }

  /**
   * Attribute a piece of text to a sub-agent when `parent` is a KNOWN sub-agent
   * callId, otherwise to the top-level conductor. Output for an unknown parent
   * (never `start`ed) degrades to top-level `output` rather than a phantom child.
   */
  private attribute(parent: string | undefined, text: string): AgentEvent {
    return parent && this.subAgentCallIds.has(parent)
      ? { kind: "subagent-output", callId: parent, text }
      : { kind: "output", text };
  }
}

/**
 * Convenience for one-off, single-line parsing (e.g. unit tests of a single
 * frame): create a fresh {@link FleetLineParser} and parse `line` through it.
 * Sessions that need cross-line attribution MUST keep a long-lived
 * {@link FleetLineParser} instead.
 */
export function parseFleetLine(line: string): AgentEvent | null {
  return new FleetLineParser().parse(line);
}

/** Wrap an unparseable / unmodeled line as a raw output event (tolerant fallback). */
function rawOutput(line: string): AgentEvent {
  return { kind: "output", text: line };
}

/** Extract a short, human-readable summary from a `result` usage block. */
function resultSummary(usage: unknown): string {
  if (isRecord(usage)) {
    const codeChanges = usage["codeChanges"];
    if (isRecord(codeChanges)) {
      const filesModified = num(codeChanges["filesModified"]);
      if (filesModified !== undefined) {
        const plural = filesModified === 1 ? "file" : "files";
        return `fleet run complete, ${filesModified} ${plural} modified`;
      }
    }
  }
  return "fleet run complete";
}

/** Extract the most descriptive target from a tool's `arguments`, if present. */
function toolTarget(args: Record<string, unknown>): string | undefined {
  return str(args["path"]) ?? str(args["command"]) ?? str(args["filePath"]) ?? undefined;
}

/** Read assistant text from a string field; returns undefined when empty/absent. */
function messageText(value: unknown): string | undefined {
  const text = str(value);
  return text && text.length > 0 ? text : undefined;
}

/** Narrow to a non-empty string, else undefined. */
function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Narrow to a finite number, else undefined. */
function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
