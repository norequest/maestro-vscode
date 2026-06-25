import { describe, expect, it } from "vitest";
import type { AgentEvent } from "@hallucinate/core";
import { FleetLineParser, parseFleetLine } from "../src/fleet-json.js";

/** Map a list of raw JSONL lines through ONE stateful parser, dropping the null
 *  (ignored) ones. Attribution is stateful, so a single parser must see the
 *  whole transcript in order (exactly as a live session does). */
function parseAll(lines: string[]): AgentEvent[] {
  const parser = new FleetLineParser();
  const out: AgentEvent[] = [];
  for (const line of lines) {
    const event = parser.parse(line);
    if (event) out.push(event);
  }
  return out;
}

/** Envelope helper matching the verified Copilot shape `{ type, data }`. */
function envelope(type: string, data: Record<string, unknown>): string {
  return JSON.stringify({ type, data });
}

describe("FleetLineParser", () => {
  it("maps subagent.started to subagent-started with callId/name/description", () => {
    const line = envelope("subagent.started", {
      toolCallId: "call-alpha",
      agentName: "scribe-alpha",
      agentDisplayName: "Scribe Alpha",
      agentDescription: "drafts the intro section",
      model: "claude-sonnet-4.6",
    });
    expect(parseFleetLine(line)).toEqual({
      kind: "subagent-started",
      callId: "call-alpha",
      name: "scribe-alpha",
      description: "drafts the intro section",
    });
  });

  it("omits description when subagent.started has none", () => {
    const line = envelope("subagent.started", { toolCallId: "call-beta", agentName: "scribe-beta" });
    expect(parseFleetLine(line)).toEqual({
      kind: "subagent-started",
      callId: "call-beta",
      name: "scribe-beta",
    });
  });

  it("maps subagent.completed to subagent-done with its callId", () => {
    const line = envelope("subagent.completed", {
      toolCallId: "call-alpha",
      agentName: "scribe-alpha",
      agentDisplayName: "Scribe Alpha",
      model: "claude-sonnet-4.6",
    });
    expect(parseFleetLine(line)).toEqual({ kind: "subagent-done", callId: "call-alpha" });
  });

  it("maps assistant.message WITH a known parent to subagent-output correlated by callId", () => {
    // Attribution is stateful: the sub-agent must have started before its output
    // can be correlated. Drive both lines through one parser.
    const events = parseAll([
      envelope("subagent.started", { toolCallId: "call-alpha", agentName: "scribe-alpha" }),
      envelope("assistant.message", {
        text: "Drafting the introduction now.",
        parentToolCallId: "call-alpha",
      }),
    ]);
    expect(events[1]).toEqual({
      kind: "subagent-output",
      callId: "call-alpha",
      text: "Drafting the introduction now.",
    });
  });

  it("maps assistant.message WITHOUT a parent to top-level lead output", () => {
    const line = envelope("assistant.message", { text: "I will delegate to two scribes." });
    expect(parseFleetLine(line)).toEqual({
      kind: "output",
      text: "I will delegate to two scribes.",
    });
  });

  it("treats a top-level message carrying ONLY parentId as lead output (the founder bug)", () => {
    // `parentId` is the assistant TURN id, present on the lead's own
    // narration. It must NOT be mistaken for a sub-agent parent: this is the
    // exact bug that mislabeled the lead's top-level message as a child.
    const line = envelope("assistant.message", {
      text: "Planning the fleet.",
      parentId: "turn-7",
    });
    expect(parseFleetLine(line)).toEqual({ kind: "output", text: "Planning the fleet." });
  });

  it("attributes sub-agent output using the real shapes (parentToolCallId + top-level agentId)", () => {
    // Real run: subagent.started carries data.toolCallId AND a top-level agentId
    // equal to it; the sub-agent's own message carries data.parentToolCallId ==
    // that id (and a top-level agentId); the lead's message carries
    // neither. Drive the whole sequence through one stateful parser.
    const started = JSON.stringify({
      type: "subagent.started",
      agentId: "call-alpha",
      data: { toolCallId: "call-alpha", agentName: "scribe-alpha", agentDescription: "drafts" },
    });
    const childMsg = JSON.stringify({
      type: "assistant.message",
      agentId: "call-alpha",
      data: { text: "Writing the intro.", parentToolCallId: "call-alpha", parentId: "turn-3" },
    });
    const topMsg = JSON.stringify({
      type: "assistant.message",
      data: { text: "Coordinating the scribes.", parentId: "turn-4" },
    });

    expect(parseAll([started, childMsg, topMsg])).toEqual([
      { kind: "subagent-started", callId: "call-alpha", name: "scribe-alpha", description: "drafts" },
      { kind: "subagent-output", callId: "call-alpha", text: "Writing the intro." },
      { kind: "output", text: "Coordinating the scribes." },
    ]);
  });

  it("degrades output for an UNKNOWN parent callId to top-level output", () => {
    // A parentToolCallId for a sub-agent that never started must not conjure a
    // phantom child; it falls back to top-level lead output.
    const line = envelope("assistant.message", {
      text: "orphaned chunk",
      parentToolCallId: "call-never-started",
    });
    expect(parseFleetLine(line)).toEqual({ kind: "output", text: "orphaned chunk" });
  });

  it("renders a sub-agent tool.execution_start as a subagent-output action line", () => {
    const events = parseAll([
      envelope("subagent.started", { toolCallId: "call-alpha", agentName: "scribe-alpha" }),
      envelope("tool.execution_start", {
        toolName: "create",
        arguments: { path: "docs/intro.md" },
        toolCallId: "tool-1",
        parentToolCallId: "call-alpha",
      }),
    ]);
    expect(events[1]).toEqual({
      kind: "subagent-output",
      callId: "call-alpha",
      text: "▸ create: docs/intro.md",
    });
  });

  it("renders a top-level task tool.execution_start as a lead delegate line", () => {
    const line = envelope("tool.execution_start", {
      toolName: "task",
      arguments: { description: "write the intro", prompt: "..." },
      toolCallId: "tool-0",
    });
    expect(parseFleetLine(line)).toEqual({ kind: "output", text: "▸ delegate: write the intro" });
  });

  it("skips background-task churn and tool lifecycle frames (no event)", () => {
    expect(parseFleetLine(envelope("session.background_tasks_changed", { tasks: [] }))).toBeNull();
    expect(
      parseFleetLine(envelope("tool.execution_partial_result", { parentToolCallId: "call-alpha" })),
    ).toBeNull();
    expect(
      parseFleetLine(envelope("tool.execution_complete", { parentToolCallId: "call-alpha" })),
    ).toBeNull();
  });

  it("maps a result with exitCode 0 to done, summarizing files modified", () => {
    const line = envelope("result", {
      sessionId: "s1",
      exitCode: 0,
      usage: { premiumRequests: 4, codeChanges: { filesModified: 3 } },
    });
    expect(parseFleetLine(line)).toEqual({
      kind: "done",
      summary: "fleet run complete, 3 files modified",
    });
  });

  it("maps a result with a nonzero exitCode to an error", () => {
    const line = envelope("result", { sessionId: "s1", exitCode: 2, usage: {} });
    expect(parseFleetLine(line)).toEqual({
      kind: "error",
      message: "fleet run exited with code 2",
    });
  });

  it("falls back to a raw output event for a malformed line (never throws)", () => {
    const malformed = '{"type":"subagent.started","data": broken\n';
    expect(() => parseFleetLine(malformed)).not.toThrow();
    expect(parseFleetLine(malformed)).toEqual({ kind: "output", text: malformed });
  });

  it("falls back to a raw output event for an unmodeled JSON type", () => {
    const line = envelope("telemetry.heartbeat", { n: 7 });
    expect(parseFleetLine(line)).toEqual({ kind: "output", text: line });
  });

  it("parses a realistic two-scribe transcript into the expected event sequence", () => {
    const transcript = [
      // Lead narrates and delegates.
      envelope("assistant.message", { text: "Planning a two-scribe fleet." }),
      envelope("tool.execution_start", {
        toolName: "task",
        arguments: { description: "draft intro", prompt: "write the intro" },
        toolCallId: "deleg-1",
      }),
      // Alpha lifecycle.
      envelope("subagent.started", {
        toolCallId: "call-alpha",
        agentName: "scribe-alpha",
        agentDescription: "drafts the intro",
      }),
      envelope("assistant.message", { text: "Working on the intro.", parentToolCallId: "call-alpha" }),
      envelope("tool.execution_start", {
        toolName: "create",
        arguments: { path: "docs/intro.md" },
        toolCallId: "t-a1",
        parentToolCallId: "call-alpha",
      }),
      envelope("subagent.completed", { toolCallId: "call-alpha", agentName: "scribe-alpha" }),
      // Beta lifecycle.
      envelope("subagent.started", {
        toolCallId: "call-beta",
        agentName: "scribe-beta",
        agentDescription: "drafts the body",
      }),
      envelope("assistant.message", { text: "Working on the body.", parentToolCallId: "call-beta" }),
      envelope("subagent.completed", { toolCallId: "call-beta", agentName: "scribe-beta" }),
      // Background churn (ignored) and the final result.
      envelope("session.background_tasks_changed", { tasks: [] }),
      envelope("result", { exitCode: 0, usage: { codeChanges: { filesModified: 2 } } }),
    ];

    expect(parseAll(transcript)).toEqual([
      { kind: "output", text: "Planning a two-scribe fleet." },
      { kind: "output", text: "▸ delegate: draft intro" },
      { kind: "subagent-started", callId: "call-alpha", name: "scribe-alpha", description: "drafts the intro" },
      { kind: "subagent-output", callId: "call-alpha", text: "Working on the intro." },
      { kind: "subagent-output", callId: "call-alpha", text: "▸ create: docs/intro.md" },
      { kind: "subagent-done", callId: "call-alpha" },
      { kind: "subagent-started", callId: "call-beta", name: "scribe-beta", description: "drafts the body" },
      { kind: "subagent-output", callId: "call-beta", text: "Working on the body." },
      { kind: "subagent-done", callId: "call-beta" },
      { kind: "done", summary: "fleet run complete, 2 files modified" },
    ]);
  });

  it("tolerates a malformed line mid-transcript and keeps parsing the rest", () => {
    const transcript = [
      envelope("subagent.started", { toolCallId: "call-alpha", agentName: "scribe-alpha" }),
      '{"type":"assistant.message","data": broken\n', // malformed
      envelope("subagent.completed", { toolCallId: "call-alpha" }),
    ];
    const events = parseAll(transcript);
    expect(events[0]).toEqual({ kind: "subagent-started", callId: "call-alpha", name: "scribe-alpha" });
    expect(events[1]).toEqual({ kind: "output", text: '{"type":"assistant.message","data": broken\n' });
    expect(events[2]).toEqual({ kind: "subagent-done", callId: "call-alpha" });
  });
});
