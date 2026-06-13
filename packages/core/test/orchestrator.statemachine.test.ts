import { describe, expect, it } from "vitest";
import { Orchestrator } from "../src/orchestrator.js";
import { FakeEngineAdapter } from "../src/fake-adapter.js";
import { FakeWorkspaceProvider } from "../src/workspace.js";
import type { AgentSession, EngineAdapter, HealthStatus } from "../src/adapter.js";
import type { Capabilities, Task, Workspace } from "../src/types.js";

/** An adapter whose start() throws synchronously, like a real CLI failing to spawn. */
class ThrowingStartAdapter implements EngineAdapter {
  readonly id: string;
  readonly capabilities: Capabilities = {
    streaming: true,
    structuredEvents: true,
    approvals: true,
    steerable: true,
  };
  constructor(id: string) {
    this.id = id;
  }
  health(): Promise<HealthStatus> {
    return Promise.resolve({ ok: true });
  }
  start(_task: Task, _workspace: Workspace): AgentSession {
    throw new Error("spawn failed");
  }
}

function waitForState(orch: Orchestrator, agentId: string, target: string): Promise<void> {
  return new Promise((resolve) => {
    const check = () => {
      if (orch.getAgent(agentId)?.state === target) resolve();
    };
    orch.on(check);
    check();
  });
}

describe("Orchestrator state-machine integrity", () => {
  it("does not leak a concurrency slot when adapter.start() throws synchronously (C1)", async () => {
    const orch = new Orchestrator({ maxParallelAgents: 1 }, new FakeWorkspaceProvider());
    orch.registerRole({ name: "Bad", instructions: "", engine: { id: "boom" }, autonomy: "manual" });
    orch.registerAdapter(new ThrowingStartAdapter("boom"));
    orch.registerRole({ name: "Good", instructions: "", engine: { id: "fake" }, autonomy: "manual" });
    orch.registerAdapter(
      new FakeEngineAdapter({
        id: "fake",
        script: [{ kind: "done", summary: "ok", diff: { files: [], patch: "" } }],
      }),
    );

    const bad = orch.spawn("Bad", "task");
    await waitForState(orch, bad.id, "error");
    expect(orch.getAgent(bad.id)!.error).toContain("Engine failed to start");

    // With maxParallelAgents=1, a leaked slot would leave this agent queued forever.
    const good = orch.spawn("Good", "task");
    await waitForState(orch, good.id, "done");
    expect(orch.getAgent(good.id)!.state).toBe("done");
  });

  it("ignores events emitted after a terminal state (terminal is absorbing) (I1)", async () => {
    const orch = new Orchestrator({ maxParallelAgents: 1 }, new FakeWorkspaceProvider());
    orch.registerRole({ name: "Impl", instructions: "", engine: { id: "fake" }, autonomy: "manual" });
    orch.registerAdapter(
      new FakeEngineAdapter({
        id: "fake",
        script: [
          { kind: "done", summary: "final", diff: { files: [], patch: "" } },
          { kind: "status", state: "working" }, // stray event after done
        ],
      }),
    );

    const agent = orch.spawn("Impl", "task");
    await waitForState(orch, agent.id, "done");
    // Let the consume loop process the stray post-done event and end the stream.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(orch.getAgent(agent.id)!.state).toBe("done");
    expect(orch.getAgent(agent.id)!.summary).toBe("final");
  });
});
