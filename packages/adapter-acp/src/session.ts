import type {
  AgentEvent,
  AgentSession,
  ApprovalDecision,
  Autonomy,
  SkillRef,
  SoulDoc,
  Task,
  ToolGrant,
} from "@maestro/core";
import { EventQueue, composePreamble, renderToolsForPreamble } from "@maestro/core";
import { buildInitialize, buildPermissionResponse, buildUserTurn } from "./messages.js";
import type { AcpApprovalDetail, AcpMessage, AcpTransport } from "./types.js";
import { autonomyToPermissionMode } from "./types.js";

/** Tools that are safe to auto-approve in auto-approve-safe mode. */
const SAFE_TOOLS = new Set([
  "read_file",
  "list_directory",
  "search_files",
  "grep",
  "get_file_info",
  "tree",
]);

export interface AcpSessionOptions {
  instructions: string;
  model?: string;
  autonomy: Autonomy;
  /** Optional soul doc resolved at spawn time. */
  soulDoc?: SoulDoc;
  /** Optional tool grant for the role. */
  tools?: ToolGrant;
  /** Resolved skills, advertised by name in the preamble (bodies not inlined). */
  skills?: SkillRef[];
}

export class AcpSession implements AgentSession {
  private readonly queue = new EventQueue();
  private settled = false;
  private statusEmitted = false;

  constructor(
    private readonly transport: AcpTransport,
    private readonly opts: AcpSessionOptions,
  ) {
    void this.consume();
  }

  get events(): AsyncIterable<AgentEvent> {
    return this.queue;
  }

  /** Call once after construction to send the ACP initialize + first user turn. */
  start(task: Task): void {
    const systemPrompt = composePreamble({
      soul: this.opts.soulDoc,
      instructions: this.opts.instructions,
      tools: renderToolsForPreamble(this.opts.tools),
      skills: this.opts.skills,
      task: "",
    });
    const initMsg = buildInitialize({
      systemPrompt,
      permissionMode: autonomyToPermissionMode(this.opts.autonomy),
      model: this.opts.model,
    });
    this.transport.send(initMsg);
    this.transport.send(buildUserTurn(task.description));
  }

  private async consume(): Promise<void> {
    try {
      for await (const msg of this.transport.messages) {
        if (this.settled) break;
        this.handleMessage(msg);
      }
    } catch {
      this.fail("ACP transport read error");
      return;
    }
    // The transport stream ended. If no terminal ACP message (turn/complete or
    // error) settled us and stop() was not called, end the event stream so
    // consumers do not hang. The orchestrator treats an unterminated stream end
    // as a failure when the agent is still working.
    if (!this.settled) {
      this.settled = true;
      this.queue.end();
    }
  }

  private handleMessage(msg: AcpMessage): void {
    // A JSON-RPC response frame carrying an error (e.g. a failed initialize)
    // has no method; surface it as a session error rather than ignoring it.
    if (msg.error) {
      const message =
        typeof msg.error.message === "string" ? msg.error.message : "ACP error response";
      this.fail(message);
      return;
    }

    // Real ACP engines namespace the permission request method. Accept both the
    // short and slash-namespaced forms so the approval is never silently dropped.
    if (msg.method === "requestPermission" || msg.method === "session/request_permission") {
      this.handlePermissionRequest(msg);
      return;
    }

    switch (msg.method) {
      case "session/update": {
        if (!this.statusEmitted) {
          this.queue.push({ kind: "status", state: "working" });
          this.statusEmitted = true;
        }
        const delta = msg.params?.["delta"] as { type?: string; text?: unknown } | undefined;
        if (typeof delta?.text === "string") {
          this.queue.push({ kind: "output", text: delta.text });
        }
        // Real ACP engines also stream tool-call progress through session/update,
        // discriminated by a `sessionUpdate` field. Surface it as a concise
        // output line so the user can see what the agent is doing (file writes,
        // shell commands, etc.). Unknown variants fall through and are ignored.
        const toolCallLine = formatToolCallUpdate(msg.params);
        if (toolCallLine !== undefined) {
          this.queue.push({ kind: "output", text: toolCallLine });
        }
        break;
      }

      case "turn/complete": {
        if (!this.statusEmitted) {
          this.queue.push({ kind: "status", state: "working" });
          this.statusEmitted = true;
        }
        const rawSummary = msg.params?.["summary"];
        const summary = typeof rawSummary === "string" ? rawSummary : "ACP run completed";
        this.settled = true;
        this.queue.push({ kind: "done", summary });
        this.queue.end();
        break;
      }

      case "error": {
        const rawMessage = msg.params?.["message"];
        const message = typeof rawMessage === "string" ? rawMessage : "Unknown ACP error";
        this.fail(message);
        break;
      }

      default:
        // Unknown ACP method; ignore.
        break;
    }
  }

  /** Handle a permission request frame (short or slash-namespaced form). */
  private handlePermissionRequest(msg: AcpMessage): void {
    // A permission request with no id cannot be correlated by the peer; treat it
    // as malformed and fail rather than fabricating an empty id and hanging.
    if (msg.id === undefined || msg.id === null) {
      this.fail("ACP requestPermission missing id");
      return;
    }
    const id = String(msg.id);

    const rawTool = msg.params?.["tool"];
    const tool = typeof rawTool === "string" ? rawTool : undefined;
    const rawDescription = msg.params?.["description"];
    const description = typeof rawDescription === "string" ? rawDescription : undefined;
    const rawArgs = msg.params?.["args"];
    const args =
      rawArgs !== null && typeof rawArgs === "object" && !Array.isArray(rawArgs)
        ? (rawArgs as Record<string, unknown>)
        : undefined;

    const autoApprove =
      this.opts.autonomy === "yolo" ||
      (this.opts.autonomy === "auto-approve-safe" && tool !== undefined && SAFE_TOOLS.has(tool));

    if (autoApprove) {
      this.transport.send(buildPermissionResponse(id, "allow"));
      return;
    }

    const detail: AcpApprovalDetail = {
      ...(description !== undefined ? { description } : {}),
      ...(tool !== undefined ? { tool } : {}),
      ...(args ? { args } : {}),
    };
    if (!this.statusEmitted) {
      this.queue.push({ kind: "status", state: "working" });
      this.statusEmitted = true;
    }
    this.queue.push({ kind: "status", state: "awaiting-approval" });
    this.queue.push({ kind: "approval", id, detail });
  }

  private fail(message: string): void {
    if (this.settled) return;
    this.settled = true;
    this.queue.push({ kind: "error", message });
    this.queue.end();
  }

  send(input: string): void {
    if (this.settled) return;
    this.transport.send(buildUserTurn(input));
  }

  respond(approvalId: string, decision: ApprovalDecision): void {
    if (this.settled) return;
    this.transport.send(buildPermissionResponse(approvalId, decision));
    this.queue.push({ kind: "status", state: "working" });
  }

  stop(): void {
    if (this.settled) return;
    this.settled = true;
    this.transport.terminate();
    this.queue.end();
  }
}

/** The `sessionUpdate` discriminator values that carry tool-call progress. */
const TOOL_CALL_VARIANTS = new Set(["tool_call", "tool_call_update"]);

/** Read a string field from an unvalidated params bag, else undefined. */
function readString(params: Record<string, unknown> | undefined, key: string): string | undefined {
  const raw = params?.[key];
  return typeof raw === "string" && raw.length > 0 ? raw : undefined;
}

/**
 * Format a tool-call `session/update` notification into a concise output line,
 * e.g. `▸ write_file: src/components/Roster.tsx` or `▸ write_file [completed]`.
 *
 * Defensive by design: returns undefined for non-tool-call variants (so they are
 * ignored) and formats from whatever recognizable fields are present rather than
 * asserting a strict schema. Never throws on malformed input.
 */
function formatToolCallUpdate(params: Record<string, unknown> | undefined): string | undefined {
  if (params === undefined) return undefined;
  const variant = params["sessionUpdate"];
  if (typeof variant !== "string" || !TOOL_CALL_VARIANTS.has(variant)) {
    return undefined;
  }

  // Prefer a human label: `title`, falling back to a tool `name`/`kind`. If none
  // is present, still acknowledge the tool call rather than emitting a blank line.
  const label =
    readString(params, "title") ??
    readString(params, "name") ??
    readString(params, "kind") ??
    "tool call";

  // A concrete detail (the path being written, the command being run) makes the
  // line actionable. Try the common rawInput shapes, then the status.
  const detail = readToolCallDetail(params);
  const status = readString(params, "status");

  let line = `▸ ${label}`;
  if (detail !== undefined) {
    line += `: ${detail}`;
  } else if (status !== undefined) {
    line += ` [${status}]`;
  }
  return `${line}\n`;
}

/**
 * Pull a single human-meaningful detail out of a tool call's input, if present.
 * Tolerant of unknown shapes: only reads a small set of well-known string fields.
 */
function readToolCallDetail(params: Record<string, unknown>): string | undefined {
  const raw = params["rawInput"] ?? params["input"] ?? params["args"];
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return undefined;
  }
  const obj = raw as Record<string, unknown>;
  for (const key of ["path", "file_path", "filePath", "command", "cmd", "pattern"]) {
    const value = obj[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return undefined;
}
