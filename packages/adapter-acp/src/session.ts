import type { AgentEvent, AgentSession, ApprovalDecision, Task } from "@maestro/core";
import { EventQueue } from "@maestro/core";
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
  autonomy: "manual" | "auto-approve-safe" | "yolo";
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
    const initMsg = buildInitialize({
      instructions: this.opts.instructions,
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
