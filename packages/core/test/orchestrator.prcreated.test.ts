import { describe, expect, it } from "vitest";
import { FakeEngineAdapter, FakeWorkspaceManager, Orchestrator } from "../src/index.js";
import type { Role } from "../src/index.js";

const role: Role = { name: "Impl", instructions: "", engine: { id: "fake" }, autonomy: "manual" };

function build(script: { manager?: FakeWorkspaceManager } = {}) {
  const manager = script.manager ?? new FakeWorkspaceManager();
  const orch = new Orchestrator({ maxParallelAgents: 1 }, manager);
  orch.registerRole(role);
  orch.registerAdapter(new FakeEngineAdapter({ script: [{ kind: "done", summary: "ok" }] }));
  return { orch, manager };
}

function waitFor(orch: Orchestrator, agentId: string, state: string): Promise<void> {
  return new Promise((resolve) => {
    const unsub = orch.on(() => {
      if (orch.getAgent(agentId)?.state === state) {
        unsub();
        resolve();
      }
    });
    if (orch.getAgent(agentId)?.state === state) {
      unsub();
      resolve();
    }
  });
}

describe("Orchestrator.markPrCreated", () => {
  it("transitions a done agent to pr-created and emits the terminal event", async () => {
    const { orch } = build();
    const agent = orch.spawn("Impl", "task");
    await waitFor(orch, agent.id, "done");

    const updates: string[] = [];
    orch.on((event) => {
      if (event.kind === "agent-updated" && event.agent.id === agent.id) {
        updates.push(event.agent.state);
      }
    });

    await orch.markPrCreated(agent.id);

    expect(orch.getAgent(agent.id)!.state).toBe("pr-created");
    expect(updates).toContain("pr-created");
  });

  it("calls releaseWorktree exactly once with the agent id", async () => {
    const { orch, manager } = build();
    const agent = orch.spawn("Impl", "task");
    await waitFor(orch, agent.id, "done");

    await orch.markPrCreated(agent.id);

    expect(manager.released).toEqual([agent.id]);
  });

  it("follows the same guard convention as merge() when the agent is not done", async () => {
    const { orch } = build();
    const agent = orch.spawn("Impl", "task");
    await waitFor(orch, agent.id, "done");
    await orch.markPrCreated(agent.id); // -> pr-created

    // merge() throws when the agent is not ready; markPrCreated mirrors that.
    await expect(orch.markPrCreated(agent.id)).rejects.toThrow();
  });

  it("throws for an unknown agent (same requireAgent convention as merge)", async () => {
    const { orch } = build();
    await expect(orch.markPrCreated("no-such-id")).rejects.toThrow(/unknown agent/i);
  });

  it("does not break when the provider lacks releaseWorktree (optional call is guarded)", async () => {
    const { Orchestrator, FakeEngineAdapter } = await import("../src/index.js");
    // FakeWorkspaceManager has releaseWorktree; a subclass that deletes it
    // simulates an impl that never added the optional method.
    const manager = new FakeWorkspaceManager();
    (manager as { releaseWorktree?: unknown }).releaseWorktree = undefined;
    const orch = new Orchestrator({ maxParallelAgents: 1 }, manager);
    orch.registerRole(role);
    orch.registerAdapter(new FakeEngineAdapter({ script: [{ kind: "done", summary: "ok" }] }));
    const agent = orch.spawn("Impl", "task");
    await waitFor(orch, agent.id, "done");

    await expect(orch.markPrCreated(agent.id)).resolves.toBeUndefined();
    expect(orch.getAgent(agent.id)!.state).toBe("pr-created");
  });

  it("stop() on a pr-created agent is a no-op and leaves it terminal", async () => {
    const { orch } = build();
    const agent = orch.spawn("Impl", "task");
    await waitFor(orch, agent.id, "done");
    await orch.markPrCreated(agent.id);
    expect(orch.getAgent(agent.id)!.state).toBe("pr-created");

    orch.stop(agent.id);
    expect(orch.getAgent(agent.id)!.state).toBe("pr-created");
  });

  it("cannot be sent back (pr-created is terminal-but-non-resumable, like merged/discarded)", async () => {
    const { orch } = build();
    const agent = orch.spawn("Impl", "task");
    await waitFor(orch, agent.id, "done");
    await orch.markPrCreated(agent.id);

    expect(() => orch.sendBack(agent.id, "more please")).toThrow(/cannot resume/i);
  });
});

// A pr-created agent that occupied a running slot must not corrupt the
// concurrency counter: the next queued agent still gets to start.
describe("Orchestrator.markPrCreated concurrency", () => {
  it("does not double-decrement the running counter (queued agent still starts)", async () => {
    const manager = new FakeWorkspaceManager();
    const orch = new Orchestrator({ maxParallelAgents: 1 }, manager);
    orch.registerRole(role);
    orch.registerAdapter(new FakeEngineAdapter({ script: [{ kind: "done", summary: "ok" }] }));
    const a1 = orch.spawn("Impl", "task 1");
    const a2 = orch.spawn("Impl", "task 2");
    // a1 runs first (max 1); a2 queues, then runs once a1 finishes its session.
    await waitFor(orch, a1.id, "done");
    await waitFor(orch, a2.id, "done");
    await orch.markPrCreated(a1.id);
    // Both should have completed; nothing stuck in preparing/queued.
    expect(orch.getAgent(a1.id)!.state).toBe("pr-created");
    expect(orch.getAgent(a2.id)!.state).toBe("done");
  });
});
