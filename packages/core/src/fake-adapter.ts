import type {
  AgentSession,
  ApprovalDecision,
  EngineAdapter,
  HealthStatus,
} from "./adapter.js";
import { EventQueue } from "./event-queue.js";
import type { AgentEvent, Capabilities, Role, Task, Workspace } from "./types.js";

export interface FakeAdapterOptions {
  id?: string;
  capabilities?: Partial<Capabilities>;
  /** Events emitted in order; the session pauses after each `approval` until respond(). */
  script: AgentEvent[];
  healthy?: boolean;
}

const DEFAULT_CAPABILITIES: Capabilities = {
  streaming: true,
  structuredEvents: true,
  approvals: true,
  steerable: true,
};

export class FakeEngineAdapter implements EngineAdapter {
  readonly id: string;
  readonly capabilities: Capabilities;
  private readonly script: AgentEvent[];
  private readonly healthy: boolean;
  /** The most recently started session, for test assertions. */
  lastSession?: FakeSession;
  /** The role passed to the most recent start(), for test assertions. */
  lastRole?: Role;

  constructor(options: FakeAdapterOptions) {
    this.id = options.id ?? "fake";
    this.capabilities = { ...DEFAULT_CAPABILITIES, ...options.capabilities };
    this.script = options.script;
    this.healthy = options.healthy ?? true;
  }

  health(): Promise<HealthStatus> {
    return Promise.resolve(
      this.healthy ? { ok: true } : { ok: false, detail: "fake unhealthy" },
    );
  }

  start(_task: Task, _workspace: Workspace, role?: Role): FakeSession {
    const session = new FakeSession(this.script);
    this.lastSession = session;
    this.lastRole = role;
    void session.run();
    return session;
  }
}

export class FakeSession implements AgentSession {
  private readonly queue = new EventQueue();
  private readonly approvalWaiters = new Map<string, () => void>();
  readonly sent: string[] = [];
  readonly decisions: Array<{ id: string; decision: ApprovalDecision }> = [];
  stopped = false;

  constructor(private readonly script: AgentEvent[]) {}

  get events(): AsyncIterable<AgentEvent> {
    return this.queue;
  }

  async run(): Promise<void> {
    for (const event of this.script) {
      if (this.stopped) break;
      this.queue.push(event);
      if (event.kind === "approval") {
        await new Promise<void>((resolve) => {
          this.approvalWaiters.set(event.id, resolve);
        });
      }
    }
    this.queue.end();
  }

  send(input: string): void {
    this.sent.push(input);
  }

  respond(approvalId: string, decision: ApprovalDecision): void {
    this.decisions.push({ id: approvalId, decision });
    const waiter = this.approvalWaiters.get(approvalId);
    if (waiter) {
      this.approvalWaiters.delete(approvalId);
      waiter();
    }
  }

  stop(): void {
    this.stopped = true;
    for (const waiter of this.approvalWaiters.values()) waiter();
    this.approvalWaiters.clear();
    this.queue.end();
  }
}
