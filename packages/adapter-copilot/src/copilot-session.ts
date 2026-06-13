import type { AgentEvent, AgentSession, ApprovalDecision } from "@maestro/core";
import { EventQueue } from "@maestro/core";
import { cleanOutput } from "./args.js";
import type { ChildHandle } from "./types.js";

export class CopilotSession implements AgentSession {
  private readonly queue = new EventQueue();
  private lastText = "";
  private settled = false;

  constructor(private readonly child: ChildHandle) {}

  get events(): AsyncIterable<AgentEvent> {
    return this.queue;
  }

  /** Begin consuming the child's streams. Call once, right after construction. */
  start(): void {
    this.child.stdout.on("data", (chunk) => {
      const text = cleanOutput(chunk.toString());
      if (text.trim().length === 0) return;
      this.lastText = text;
      this.queue.push({ kind: "output", text });
    });
    this.child.on("error", (err) => this.fail(`Failed to run copilot: ${err.message}`));
    this.child.on("close", (code) => {
      if (this.settled) return;
      this.settled = true;
      if (code === 0) {
        this.queue.push({ kind: "done", summary: this.summary() });
      } else {
        this.queue.push({ kind: "error", message: `copilot exited with code ${code ?? "unknown"}` });
      }
      this.queue.end();
    });
  }

  private summary(): string {
    const tail = this.lastText.trim().split("\n").filter(Boolean).pop();
    return tail && tail.length > 0 ? tail.slice(0, 200) : "Copilot run completed";
  }

  private fail(message: string): void {
    if (this.settled) return;
    this.settled = true;
    this.queue.push({ kind: "error", message });
    this.queue.end();
  }

  send(_input: string): void {
    /* v1: `copilot -p` is one-shot; mid-run steering awaits the ACP upgrade. */
  }

  respond(_approvalId: string, _decision: ApprovalDecision): void {
    /* v1: no interactive approvals (the agent runs --allow-all in its worktree). */
  }

  stop(): void {
    if (this.settled) return;
    this.settled = true;
    try {
      this.child.kill("SIGTERM");
    } catch {
      /* already exited */
    }
    this.queue.end();
  }
}
