import { describe, it, expect } from "vitest";
import { EventQueue } from "@maestro/core";
import type {
  AgentEvent,
  AgentSession,
  Capabilities,
  EngineAdapter,
  HealthStatus,
  Role,
  Task,
  Workspace,
} from "@maestro/core";
import type { AdapterFactory } from "../src/index.js";
import { runConformanceSuite } from "../src/index.js";

/** A session that emits only when the test driver pushes into it. */
class ControllableSession implements AgentSession {
  private readonly queue = new EventQueue();
  get events(): AsyncIterable<AgentEvent> {
    return this.queue;
  }
  push(event: AgentEvent): void {
    this.queue.push(event);
  }
  end(): void {
    this.queue.end();
  }
  send(): void {
    /* no-op for the self-test */
  }
  respond(): void {
    /* no-op for the self-test */
  }
  stop(): void {
    this.queue.end();
  }
}

/** A minimal real EngineAdapter that hands back a controllable session. */
class ControllableAdapter implements EngineAdapter {
  readonly id = "selftest";
  readonly capabilities: Capabilities = {
    streaming: true,
    structuredEvents: true,
    approvals: false,
    steerable: false,
  };
  session?: ControllableSession;
  health(): Promise<HealthStatus> {
    return Promise.resolve({ ok: true });
  }
  start(_task: Task, _workspace: Workspace, _role: Role): AgentSession {
    this.session = new ControllableSession();
    return this.session;
  }
}

const factory: AdapterFactory = () => {
  const adapter = new ControllableAdapter();
  return {
    adapter,
    completeSuccessfully: () => {
      adapter.session?.push({ kind: "status", state: "working" });
      adapter.session?.push({ kind: "done", summary: "ok" });
      adapter.session?.end();
    },
    failWithError: () => {
      adapter.session?.push({ kind: "status", state: "working" });
      adapter.session?.push({ kind: "error", message: "boom" });
      adapter.session?.end();
    },
    emitOutput: (text: string) => {
      adapter.session?.push({ kind: "output", text });
    },
  };
};

describe("conformance self-test", () => {
  it("a correct controllable adapter passes the shared suite", () => {
    expect(typeof runConformanceSuite).toBe("function");
  });
});

// Registering the suite against a known-good adapter is itself the smoke test:
// if any contract assertion is wrong, these registered tests fail.
runConformanceSuite("ControllableAdapter", factory);
