import { describe, expect, it } from "vitest";
import { Orchestrator } from "../src/orchestrator.js";
import { EventQueue } from "../src/event-queue.js";
import { FakeWorkspaceProvider } from "../src/workspace.js";
import type { AgentSession, EngineAdapter, HealthStatus } from "../src/adapter.js";
import type { AgentEvent, Capabilities, Role } from "../src/types.js";

function role(name: string, engineId = "manual"): Role {
  return { name, instructions: `do ${name}`, engine: { id: engineId }, autonomy: "manual" };
}

function waitForState(orch: Orchestrator, agentId: string, target: string): Promise<void> {
  return new Promise((resolve) => {
    const check = (): void => {
      if (orch.getAgent(agentId)?.state === target) resolve();
    };
    orch.on(check);
    check();
  });
}

/**
 * A session whose stop() is a NO-OP: it does NOT end the stream. This models a
 * real engine (e.g. the Copilot CLI) whose killed process can still flush a final
 * `done`/`error` event after stop() was requested. The test then pushes that late
 * event manually to reproduce the stop-vs-done race.
 */
class ManualSession implements AgentSession {
  readonly queue = new EventQueue();
  get events(): AsyncIterable<AgentEvent> {
    return this.queue;
  }
  send(): void {}
  respond(): void {}
  stop(): void {
    /* deliberately does not end the stream */
  }
  emit(event: AgentEvent): void {
    this.queue.push(event);
  }
  end(): void {
    this.queue.end();
  }
}

class ManualAdapter implements EngineAdapter {
  readonly id = "manual";
  readonly capabilities: Capabilities = {
    streaming: true,
    structuredEvents: true,
    approvals: true,
    steerable: true,
  };
  session = new ManualSession();
  health(): Promise<HealthStatus> {
    return Promise.resolve({ ok: true });
  }
  start(): ManualSession {
    this.session = new ManualSession();
    return this.session;
  }
}

describe("Orchestrator stop wins over a late terminal event", () => {
  it("a `done` flushed AFTER stop() lands the agent in stopped, not done", async () => {
    const adapter = new ManualAdapter();
    const orch = new Orchestrator({ maxParallelAgents: 2 }, new FakeWorkspaceProvider());
    orch.registerAdapter(adapter);
    orch.registerRole(role("worker"));

    const agent = orch.spawn("worker", "build it");
    await waitForState(orch, agent.id, "working");

    orch.stop(agent.id); // stop() is a no-op on ManualSession: the stream stays open
    // The dying engine flushes one last "done" with a summary + diff.
    adapter.session.emit({ kind: "done", summary: "finished anyway", diff: { files: ["a.ts"], patch: "P" } });
    adapter.session.end();

    await waitForState(orch, agent.id, "stopped");
    const a = orch.getAgent(agent.id)!;
    expect(a.state).toBe("stopped");
    // The late result must NOT be adopted: no summary, no diff to "merge".
    expect(a.summary).toBeUndefined();
    expect(a.diff).toBeUndefined();
  });

  it("an `error` flushed AFTER stop() also lands in stopped (stop intent wins)", async () => {
    const adapter = new ManualAdapter();
    const orch = new Orchestrator({ maxParallelAgents: 2 }, new FakeWorkspaceProvider());
    orch.registerAdapter(adapter);
    orch.registerRole(role("worker"));

    const agent = orch.spawn("worker", "build it");
    await waitForState(orch, agent.id, "working");

    orch.stop(agent.id);
    adapter.session.emit({ kind: "error", message: "killed" });
    adapter.session.end();

    await waitForState(orch, agent.id, "stopped");
    const a = orch.getAgent(agent.id)!;
    expect(a.state).toBe("stopped");
    expect(a.error).toBeUndefined();
  });
});

describe("Orchestrator resume (sendBack) for a stopped agent", () => {
  async function makeStoppedAgent(): Promise<{ orch: Orchestrator; id: string }> {
    const adapter = new ManualAdapter();
    const orch = new Orchestrator({ maxParallelAgents: 2 }, new FakeWorkspaceProvider());
    orch.registerAdapter(adapter);
    orch.registerRole(role("worker"));
    const agent = orch.spawn("worker", "build it");
    await waitForState(orch, agent.id, "working");
    orch.stop(agent.id);
    adapter.session.emit({ kind: "done", summary: "x" });
    adapter.session.end();
    await waitForState(orch, agent.id, "stopped");
    return { orch, id: agent.id };
  }

  it("resumes a stopped agent (empty feedback keeps the task intact)", async () => {
    const { orch, id } = await makeStoppedAgent();
    const before = orch.getAgent(id)!.task.description;

    const resumed = orch.sendBack(id, "");
    expect(["preparing", "working"]).toContain(resumed.state);
    // A bare resume must NOT append a "Lead feedback:" line.
    expect(resumed.task.description).toBe(before);
    expect(resumed.task.description).not.toContain("Lead feedback");
  });

  it("send-back with feedback on a stopped agent appends the note", async () => {
    const { orch, id } = await makeStoppedAgent();
    const resumed = orch.sendBack(id, "try the other API");
    expect(resumed.task.description).toContain("Lead feedback: try the other API");
  });
});
