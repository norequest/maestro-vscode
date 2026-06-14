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
    switch (msg.method) {
      case "session/update": {
        if (!this.statusEmitted) {
          this.queue.push({ kind: "status", state: "working" });
          this.statusEmitted = true;
        }
        const delta = msg.params?.["delta"] as { type?: string; text?: string } | undefined;
        if (delta?.text) {
          this.queue.push({ kind: "output", text: delta.text });
        }
        break;
      }

      case "requestPermission": {
        const tool = String(msg.params?.["tool"] ?? "unknown");
        const description = String(msg.params?.["description"] ?? "");
        const args = msg.params?.["args"] as Record<string, unknown> | undefined;
        const id = String(msg.id ?? "");

        const autoApprove =
          this.opts.autonomy === "yolo" ||
          (this.opts.autonomy === "auto-approve-safe" && SAFE_TOOLS.has(tool));

        if (autoApprove) {
          this.transport.send(buildPermissionResponse(id, "allow"));
        } else {
          const detail: AcpApprovalDetail = { description, tool, ...(args ? { args } : {}) };
          if (!this.statusEmitted) {
            this.queue.push({ kind: "status", state: "working" });
            this.statusEmitted = true;
          }
          this.queue.push({ kind: "status", state: "awaiting-approval" });
          this.queue.push({ kind: "approval", id, detail });
        }
        break;
      }

      case "turn/complete": {
        if (!this.statusEmitted) {
          this.queue.push({ kind: "status", state: "working" });
          this.statusEmitted = true;
        }
        const summary = String(msg.params?.["summary"] ?? "ACP run completed");
        this.settled = true;
        this.queue.push({ kind: "done", summary });
        this.queue.end();
        break;
      }

      case "error": {
        const message = String(msg.params?.["message"] ?? "Unknown ACP error");
        this.fail(message);
        break;
      }

      default:
        // Unknown ACP method; ignore.
        break;
    }
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
