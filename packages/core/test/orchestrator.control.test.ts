import { describe, expect, it } from "vitest";
import { Orchestrator } from "../src/orchestrator.js";
import { FakeEngineAdapter } from "../src/fake-adapter.js";
import { EventQueue } from "../src/event-queue.js";
import { FakeWorkspaceProvider } from "../src/workspace.js";
import type { AgentSession, EngineAdapter, HealthStatus } from "../src/adapter.js";
import type { AgentEvent, Capabilities, Role } from "../src/types.js";

const role: Role = {
  name: "Implementer",
  instructions: "build it",
  engine: { id: "fake" },
  autonomy: "manual",
};

function waitForState(orch: Orchestrator, agentId: string, target: string): Promise<void> {
  return new Promise((resolve) => {
    const check = () => {
      if (orch.getAgent(agentId)?.state === target) resolve();
    };
    orch.on(check);
    check();
  });
}

describe("Orchestrator control", () => {
  it("forwards steer() input to the live session", async () => {
    const workspaces = new FakeWorkspaceProvider();
    const orch = new Orchestrator({ maxParallelAgents: 1 }, workspaces);
    orch.registerRole(role);
    const adapter = new FakeEngineAdapter({
      script: [{ kind: "approval", id: "ap", detail: null }],
    });
    orch.registerAdapter(adapter);

    const agent = orch.spawn("Implementer", "task");
    await waitForState(orch, agent.id, "awaiting-approval");

    orch.steer(agent.id, "focus on the edge cases");
    expect(adapter.lastSession!.sent).toEqual(["focus on the edge cases"]);
  });

  it("stop() moves a running agent to stopped, not error", async () => {
    const workspaces = new FakeWorkspaceProvider();
    const orch = new Orchestrator({ maxParallelAgents: 1 }, workspaces);
    orch.registerRole(role);
    orch.registerAdapter(
      new FakeEngineAdapter({ script: [{ kind: "approval", id: "ap", detail: null }] }),
    );

    const agent = orch.spawn("Implementer", "task");
    await waitForState(orch, agent.id, "awaiting-approval");

    orch.stop(agent.id);
    await waitForState(orch, agent.id, "stopped");
    expect(orch.getAgent(agent.id)!.state).toBe("stopped");
  });

  it("steer() throws when there is no active session", () => {
    const orch = new Orchestrator({ maxParallelAgents: 1 }, new FakeWorkspaceProvider());
    expect(() => orch.steer("missing", "hi")).toThrow("No active session for missing");
  });
});

/**
 * A session that stays open (its queue never ends on its own) so the agent parks
 * in "working" and the session stays in the orchestrator's live-session map until
 * something calls stop(). Records stop() calls so a test can assert each live
 * session was signalled; can be told to THROW from stop() to model one engine's
 * kill failing.
 */
class SpySession implements AgentSession {
  readonly queue = new EventQueue();
  stopCalls = 0;
  throwOnStop = false;
  get events(): AsyncIterable<AgentEvent> {
    return this.queue;
  }
  send(): void {}
  respond(): void {}
  stop(): void {
    this.stopCalls++;
    if (this.throwOnStop) throw new Error("stop boom");
    this.queue.end();
  }
}

class SpyAdapter implements EngineAdapter {
  readonly id = "spy";
  readonly capabilities: Capabilities = {
    streaming: true,
    structuredEvents: true,
    approvals: true,
    steerable: true,
  };
  readonly sessions: SpySession[] = [];
  /** When set, the session at this index throws from stop(). */
  throwAtIndex?: number;
  health(): Promise<HealthStatus> {
    return Promise.resolve({ ok: true });
  }
  start(): SpySession {
    const s = new SpySession();
    if (this.throwAtIndex === this.sessions.length) s.throwOnStop = true;
    this.sessions.push(s);
    return s;
  }
}

describe("Orchestrator.stopAll (H3: no orphaned children on teardown)", () => {
  function spyRole(name: string): Role {
    return { name, instructions: `do ${name}`, engine: { id: "spy" }, autonomy: "manual" };
  }

  it("stops every live session", async () => {
    const adapter = new SpyAdapter();
    const orch = new Orchestrator({ maxParallelAgents: 3 }, new FakeWorkspaceProvider());
    orch.registerAdapter(adapter);
    orch.registerRole(spyRole("worker"));

    const a1 = orch.spawn("worker", "1");
    const a2 = orch.spawn("worker", "2");
    const a3 = orch.spawn("worker", "3");
    await waitForState(orch, a1.id, "working");
    await waitForState(orch, a2.id, "working");
    await waitForState(orch, a3.id, "working");

    orch.stopAll();

    expect(adapter.sessions.map((s) => s.stopCalls)).toEqual([1, 1, 1]);
  });

  it("a throwing session.stop() does not block stopping the others", async () => {
    const adapter = new SpyAdapter();
    adapter.throwAtIndex = 0; // the first live session's stop() throws
    const orch = new Orchestrator({ maxParallelAgents: 3 }, new FakeWorkspaceProvider());
    orch.registerAdapter(adapter);
    orch.registerRole(spyRole("worker"));

    const a1 = orch.spawn("worker", "1");
    const a2 = orch.spawn("worker", "2");
    const a3 = orch.spawn("worker", "3");
    await waitForState(orch, a1.id, "working");
    await waitForState(orch, a2.id, "working");
    await waitForState(orch, a3.id, "working");

    expect(() => orch.stopAll()).not.toThrow();
    // Every session, including the ones after the thrower, was still signalled.
    expect(adapter.sessions[0]!.stopCalls).toBe(1);
    expect(adapter.sessions[1]!.stopCalls).toBe(1);
    expect(adapter.sessions[2]!.stopCalls).toBe(1);
  });
});

describe("Orchestrator stop during launch preparation (M2)", () => {
  it("a stop() while launch is mid-preparation never starts the engine", async () => {
    const workspaces = new FakeWorkspaceProvider();
    const orch = new Orchestrator({ maxParallelAgents: 1 }, workspaces);
    orch.registerRole(role);
    const adapter = new FakeEngineAdapter({
      script: [{ kind: "approval", id: "ap", detail: null }],
    });
    orch.registerAdapter(adapter);

    // Park launch() inside the preamble resolver: this is AFTER the workspace was
    // created (the existing post-create stop check has already passed) but BEFORE
    // adapter.start(). A stop() arriving here can only record intent (no session
    // exists yet), reproducing the lost-Stop window.
    let releasePreamble!: () => void;
    let preambleEntered!: () => void;
    const entered = new Promise<void>((r) => {
      preambleEntered = r;
    });
    const gate = new Promise<void>((r) => {
      releasePreamble = r;
    });
    orch.setPreambleResolver(async () => {
      preambleEntered();
      await gate;
      return {};
    });

    const agent = orch.spawn("Implementer", "task");
    await entered; // launch() is now suspended in the preamble, before start()
    expect(orch.getAgent(agent.id)!.state).toBe("preparing");

    orch.stop(agent.id); // arrives mid-preparation: only records the intent
    releasePreamble(); // let launch() run on toward adapter.start()

    await waitForState(orch, agent.id, "stopped");
    expect(orch.getAgent(agent.id)!.state).toBe("stopped");
    // The user's Stop is honored: the engine was never started.
    expect(adapter.startedTasks.length).toBe(0);
    expect(adapter.lastSession).toBeUndefined();
  });
});
