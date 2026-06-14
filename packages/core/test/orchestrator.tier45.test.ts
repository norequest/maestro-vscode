import { describe, expect, it } from "vitest";
import { Orchestrator } from "../src/orchestrator.js";
import { FakeEngineAdapter } from "../src/fake-adapter.js";
import { FakeWorkspaceProvider, FakeWorkspaceManager } from "../src/workspace.js";
import type { Agent, Diff, OrchestratorEvent, Role } from "../src/types.js";

const role: Role = { name: "Impl", instructions: "", engine: { id: "fake" }, autonomy: "manual" };

function waitForState(orch: Orchestrator, agentId: string, target: string): Promise<void> {
  return new Promise((resolve) => {
    const unsub = orch.on(() => {
      if (orch.getAgent(agentId)?.state === target) { unsub(); resolve(); }
    });
    if (orch.getAgent(agentId)?.state === target) { unsub(); resolve(); }
  });
}

/** Let the microtask/macrotask queue drain so async chains settle. */
function tick(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

function mkAgent(over: Partial<Agent> = {}): Agent {
  return {
    id: "a1",
    task: { id: "t1", description: "fix tests", roleName: "Impl" },
    role,
    state: "done",
    log: [],
    ...over,
  };
}

// ----------------------------------------------------------------------------
// TG4: computeDiff failure path sets diffError (and leaves diff undefined)
// ----------------------------------------------------------------------------
describe("Orchestrator computeDiff failure (TG4)", () => {
  it("sets diffError and leaves diff undefined when diff() rejects after done", async () => {
    class RejectingDiffManager extends FakeWorkspaceManager {
      override diff(agentId: string): Promise<Diff> {
        super.diff(agentId); // record the attempt
        return Promise.reject(new Error("git diff failed"));
      }
    }
    const manager = new RejectingDiffManager();
    const orch = new Orchestrator({ maxParallelAgents: 1 }, manager);
    orch.registerRole(role);
    // done with NO diff -> computeDiff fires and rejects.
    orch.registerAdapter(new FakeEngineAdapter({ script: [{ kind: "done", summary: "ok" }] }));

    const agent = orch.spawn("Impl", "task");
    await waitForState(orch, agent.id, "done");
    // Wait for the agent-updated emitted by the .catch path (diffError set).
    await new Promise<void>((resolve) => {
      const unsub = orch.on(() => {
        if (orch.getAgent(agent.id)?.diffError !== undefined) { unsub(); resolve(); }
      });
      if (orch.getAgent(agent.id)?.diffError !== undefined) { unsub(); resolve(); }
    });

    const final = orch.getAgent(agent.id)!;
    expect(final.state).toBe("done"); // still done; the failure does not error the agent
    expect(final.diffError).toBe("git diff failed");
    expect(final.diff).toBeUndefined();
    expect(manager.diffed).toContain(agent.id);
  });
});

// ----------------------------------------------------------------------------
// TG9: discard from each discardable non-done state (error, stopped,
// merge-cleanup-failed). done + conflict are covered in orchestrator.merge.test.ts.
// ----------------------------------------------------------------------------
describe("Orchestrator discard from non-done discardable states (TG9)", () => {
  it("discards an agent in error state", async () => {
    const manager = new FakeWorkspaceManager();
    const orch = new Orchestrator({ maxParallelAgents: 1 }, manager);
    orch.registerRole(role);
    orch.registerAdapter(new FakeEngineAdapter({ script: [{ kind: "error", message: "boom" }] }));
    const agent = orch.spawn("Impl", "task");
    await waitForState(orch, agent.id, "error");

    await orch.discard(agent.id);
    expect(orch.getAgent(agent.id)!.state).toBe("discarded");
    expect(manager.discarded).toContain(agent.id);
  });

  it("discards an agent in stopped state", async () => {
    const manager = new FakeWorkspaceManager();
    const orch = new Orchestrator({ maxParallelAgents: 1 }, manager);
    orch.registerRole(role);
    // Park on an approval so stop() can move it to stopped (not error).
    orch.registerAdapter(new FakeEngineAdapter({
      script: [{ kind: "approval", id: "ap", detail: null }],
    }));
    const agent = orch.spawn("Impl", "task");
    await waitForState(orch, agent.id, "awaiting-approval");
    orch.stop(agent.id);
    await waitForState(orch, agent.id, "stopped");

    await orch.discard(agent.id);
    expect(orch.getAgent(agent.id)!.state).toBe("discarded");
    expect(manager.discarded).toContain(agent.id);
  });

  it("discards an agent in merge-cleanup-failed state", async () => {
    // A manager whose cleanup() rejects drives merge() into merge-cleanup-failed,
    // then discard() (which calls discard(), not cleanup()) still succeeds.
    class FailingCleanupManager extends FakeWorkspaceManager {
      override cleanup(): Promise<void> {
        return Promise.reject(new Error("cleanup disk full"));
      }
    }
    const manager = new FailingCleanupManager();
    manager.setMergeResult("agent-1", { status: "clean" });
    const orch = new Orchestrator({ maxParallelAgents: 1 }, manager);
    orch.registerRole(role);
    orch.registerAdapter(new FakeEngineAdapter({ script: [{ kind: "done", summary: "ok" }] }));
    const agent = orch.spawn("Impl", "task");
    await waitForState(orch, agent.id, "done");
    await orch.merge(agent.id);
    expect(orch.getAgent(agent.id)!.state).toBe("merge-cleanup-failed");

    await orch.discard(agent.id);
    expect(orch.getAgent(agent.id)!.state).toBe("discarded");
    expect(manager.discarded).toContain(agent.id);
  });
});

// ----------------------------------------------------------------------------
// TG11: hydrate a preparing agent with no workspace -> detached, no crash
// ----------------------------------------------------------------------------
describe("Orchestrator hydrate preparing agent without workspace (TG11)", () => {
  it("detaches a preparing agent that has no workspace, without throwing or reconstructing one", () => {
    const orch = new Orchestrator({ maxParallelAgents: 1 }, new FakeWorkspaceProvider());
    const events: OrchestratorEvent[] = [];
    orch.on((e) => events.push(e));

    // preparing, workspace undefined, and no workspacePath on the record.
    expect(() =>
      orch.hydrate([{ agent: mkAgent({ id: "p1", state: "preparing" }) }]),
    ).not.toThrow();

    const agent = orch.getAgent("p1")!;
    expect(agent.state).toBe("detached");
    expect(agent.workspace).toBeUndefined(); // no reconstruction attempted
    expect(events.map((e) => e.kind)).toEqual(["agent-added", "agent-updated"]);
  });
});

// ----------------------------------------------------------------------------
// TG18: an `action` event does not change agent state (documented no-op)
// ----------------------------------------------------------------------------
describe("Orchestrator action event is a no-op (TG18)", () => {
  it("ignores an action event and still reaches done, surfacing it in the log", async () => {
    const orch = new Orchestrator({ maxParallelAgents: 1 }, new FakeWorkspaceProvider());
    orch.registerRole(role);
    const events: OrchestratorEvent[] = [];
    orch.on((e) => events.push(e));
    orch.registerAdapter(new FakeEngineAdapter({
      script: [
        { kind: "action", tool: "bash", detail: { cmd: "ls" } },
        { kind: "done", summary: "ok" },
      ],
    }));

    const agent = orch.spawn("Impl", "task");
    await waitForState(orch, agent.id, "done");
    await tick(); // let any trailing emissions settle

    const final = orch.getAgent(agent.id)!;
    expect(final.state).toBe("done"); // not error; action did not perturb state
    // The action surfaces as an agent-event in the orchestrator stream and in the log.
    const actionEvents = events.filter(
      (e) => e.kind === "agent-event" && e.event.kind === "action",
    );
    expect(actionEvents).toHaveLength(1);
    expect(final.log.some((e) => e.kind === "action")).toBe(true);
  });
});
