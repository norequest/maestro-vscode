import { describe, expect, it } from "vitest";
import { Orchestrator } from "../src/orchestrator.js";
import { FakeEngineAdapter } from "../src/fake-adapter.js";
import {
  FakeWorkspaceProvider,
  FakeWorkspaceManager,
} from "../src/workspace.js";
import type { Diff, MergeResult, Role, Workspace } from "../src/types.js";

const role: Role = { name: "Impl", instructions: "", engine: { id: "fake" }, autonomy: "manual" };

function waitForState(orch: Orchestrator, agentId: string, target: string): Promise<void> {
  return new Promise((resolve) => {
    const unsub = orch.on(() => {
      if (orch.getAgent(agentId)?.state === target) { unsub(); resolve(); }
    });
    if (orch.getAgent(agentId)?.state === target) { unsub(); resolve(); }
  });
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (e: unknown) => void } {
  let resolve!: (value: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/** Let the microtask/macrotask queue drain so async chains settle. */
function tick(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

// ----------------------------------------------------------------------------
// Issue 4 (C2): merge mutex must be exception-safe (no permanent deadlock)
// ----------------------------------------------------------------------------
describe("Orchestrator merge mutex exception safety (C2)", () => {
  it("does not begin the second merge's workspace work until the first releases", async () => {
    const gateMerge = deferred<void>();
    const started: string[] = [];
    class GatedFirstManager extends FakeWorkspaceManager {
      override async merge(agentId: string): Promise<MergeResult> {
        started.push(agentId);
        if (agentId === "agent-1") {
          // First merge body is gated by a deferred promise.
          await gateMerge.promise;
        }
        return super.merge(agentId);
      }
    }
    const manager = new GatedFirstManager();
    const orch = new Orchestrator({ maxParallelAgents: 2 }, manager);
    orch.registerRole(role);
    orch.registerAdapter(new FakeEngineAdapter({ script: [{ kind: "done", summary: "ok" }] }));
    const a1 = orch.spawn("Impl", "task 1");
    const a2 = orch.spawn("Impl", "task 2");
    await waitForState(orch, a1.id, "done");
    await waitForState(orch, a2.id, "done");

    const m1 = orch.merge(a1.id);
    const m2 = orch.merge(a2.id);
    await tick();
    // First merge started and is gated; second has NOT begun its workspace work.
    expect(started).toEqual(["agent-1"]);

    gateMerge.resolve();
    await Promise.all([m1, m2]);
    expect(started).toEqual(["agent-1", "agent-2"]);
  });

  it("a SECOND merge still runs after the FIRST merge body throws (no deadlock)", async () => {
    class FirstThrowsManager extends FakeWorkspaceManager {
      override merge(agentId: string): Promise<MergeResult> {
        if (agentId === "agent-1") return Promise.reject(new Error("merge blew up"));
        return super.merge(agentId);
      }
    }
    const manager = new FirstThrowsManager();
    const orch = new Orchestrator({ maxParallelAgents: 2 }, manager);
    orch.registerRole(role);
    orch.registerAdapter(new FakeEngineAdapter({ script: [{ kind: "done", summary: "ok" }] }));
    const a1 = orch.spawn("Impl", "task 1");
    const a2 = orch.spawn("Impl", "task 2");
    await waitForState(orch, a1.id, "done");
    await waitForState(orch, a2.id, "done");

    await expect(orch.merge(a1.id)).rejects.toThrow("merge blew up");
    // The lock was released despite the throw; the second merge resolves.
    const result = await orch.merge(a2.id);
    expect(result).toEqual({ status: "clean" });
    expect(orch.getAgent(a2.id)!.state).toBe("merged");
  });
});

// ----------------------------------------------------------------------------
// Issue 5 (C6): stop() on a preparing/queued agent
// ----------------------------------------------------------------------------
describe("Orchestrator stop on preparing/queued agents (C6)", () => {
  it("stops a queued agent without starting its session, slot accounting intact", async () => {
    const orch = new Orchestrator({ maxParallelAgents: 1 }, new FakeWorkspaceProvider());
    orch.registerRole(role);
    // Agent a keeps the single slot busy by parking on an approval.
    const adapter = new FakeEngineAdapter({
      script: [
        { kind: "approval", id: "ap", detail: null },
        { kind: "done", summary: "a-done" },
      ],
    });
    orch.registerAdapter(adapter);

    const a = orch.spawn("Impl", "task A");
    const b = orch.spawn("Impl", "task B");
    await waitForState(orch, a.id, "awaiting-approval");
    expect(orch.getAgent(b.id)!.state).toBe("preparing"); // queued

    const startedBefore = adapter.startedTasks.length;
    orch.stop(b.id);
    expect(orch.getAgent(b.id)!.state).toBe("stopped");

    // First agent still runs and can complete; the queued stop did not perturb
    // slot accounting (b never consumed a slot).
    orch.approve(a.id, "ap", "allow");
    await waitForState(orch, a.id, "done");
    expect(orch.getAgent(a.id)!.state).toBe("done");
    // b's session was never started: only a started (twice across its run? no,
    // start() is called once per launch). b contributed no new start().
    expect(adapter.startedTasks.filter((t) => t.description === "task B")).toHaveLength(0);
    expect(adapter.startedTasks.length).toBeGreaterThanOrEqual(startedBefore);
  });

  it("stops a preparing agent whose workspace create() is in flight, no engine session", async () => {
    const gateCreate = deferred<Workspace>();
    class GatedCreateProvider extends FakeWorkspaceProvider {
      override create(agentId: string): Promise<Workspace> {
        super.create(agentId); // record it
        return gateCreate.promise;
      }
    }
    const provider = new GatedCreateProvider();
    const orch = new Orchestrator({ maxParallelAgents: 1 }, provider);
    orch.registerRole(role);
    const adapter = new FakeEngineAdapter({ script: [{ kind: "done", summary: "ok" }] });
    orch.registerAdapter(adapter);

    const agent = orch.spawn("Impl", "task");
    await tick();
    expect(orch.getAgent(agent.id)!.state).toBe("preparing"); // create() pending

    orch.stop(agent.id); // records stop intent
    gateCreate.resolve({ agentId: agent.id, path: "/wt/x", branch: "agent/x" });
    await waitForState(orch, agent.id, "stopped");

    expect(orch.getAgent(agent.id)!.state).toBe("stopped");
    expect(adapter.startedTasks).toHaveLength(0); // engine session never started

    // The slot was released: a new agent can run.
    const next = orch.spawn("Impl", "next");
    expect(next.state).toBe("preparing");
  });
});

// ----------------------------------------------------------------------------
// Issue 11 (C7): diff-on-done must not race sendBack and apply a stale diff
// ----------------------------------------------------------------------------
describe("Orchestrator diff-on-done vs sendBack race (C7)", () => {
  it("drops a late diff after sendBack relaunches the agent (now working, no stale diff)", async () => {
    // First run: done with no diff -> computeDiff kicks off a gated diff().
    // Second run (after sendBack): parks on an approval, so it stays awaiting-
    // approval (not done) with a bumped generation. When the gated first-run diff
    // finally resolves it is stale and must be dropped, leaving diff undefined.
    const gateDiff = deferred<Diff>();
    class GatedDiffManager extends FakeWorkspaceManager {
      override diff(agentId: string): Promise<Diff> {
        super.diff(agentId); // record it
        return gateDiff.promise; // first (and only) computeDiff is gated
      }
    }
    const manager = new GatedDiffManager();
    const orch = new Orchestrator({ maxParallelAgents: 1 }, manager);
    orch.registerRole(role);
    // First run emits done (no diff). After sendBack, the SAME script runs again,
    // but we want the relaunch to park, so use a script with an approval first.
    orch.registerAdapter(new FakeEngineAdapter({
      script: [
        { kind: "approval", id: "ap", detail: null },
        { kind: "done", summary: "ok" },
      ],
    }));

    const agent = orch.spawn("Impl", "task");
    // First run: approve so it reaches done (no diff) -> gated computeDiff.
    await waitForState(orch, agent.id, "awaiting-approval");
    orch.approve(agent.id, "ap", "allow");
    await waitForState(orch, agent.id, "done");
    expect(manager.diffed).toContain(agent.id); // first diff() in flight, gated

    // sendBack: relaunch. The new run parks on its approval (still awaiting,
    // generation bumped), so agent.diff stays undefined and state is not done.
    orch.sendBack(agent.id, "please also add tests");
    await waitForState(orch, agent.id, "awaiting-approval");
    expect(orch.getAgent(agent.id)!.state).toBe("awaiting-approval");
    expect(orch.getAgent(agent.id)!.diff).toBeUndefined();

    // Resolve the STALE first-run diff. It must be dropped: wrong generation and
    // the agent is no longer "done".
    gateDiff.resolve({ files: ["stale.ts"], patch: "stale" });
    await tick();

    expect(orch.getAgent(agent.id)!.diff).toBeUndefined();
    expect(orch.getAgent(agent.id)!.diffError).toBeUndefined();
    expect(orch.getAgent(agent.id)!.state).toBe("awaiting-approval"); // unperturbed
  });
});

// ----------------------------------------------------------------------------
// Issue 13-core (T2): non-string approval tool must not become "[object Object]"
// ----------------------------------------------------------------------------
describe("Orchestrator approval detail laundering (T2)", () => {
  it("leaves approvalDetail undefined when detail.tool is not a string", async () => {
    const orch = new Orchestrator({ maxParallelAgents: 1 }, new FakeWorkspaceProvider());
    orch.registerRole(role);
    orch.registerAdapter(new FakeEngineAdapter({
      script: [
        { kind: "approval", id: "req-1", detail: { tool: { nested: true }, description: "do it" } },
        { kind: "done", summary: "ok" },
      ],
    }));
    const agent = orch.spawn("Impl", "task");
    await waitForState(orch, agent.id, "awaiting-approval");

    expect(orch.getAgent(agent.id)!.approvalDetail).toBeUndefined();
    expect(orch.getAgent(agent.id)!.state).toBe("awaiting-approval"); // still parked

    orch.approve(agent.id, "req-1", "allow");
    await waitForState(orch, agent.id, "done");
  });

  it("leaves approvalDetail undefined when detail.description is not a string", async () => {
    const orch = new Orchestrator({ maxParallelAgents: 1 }, new FakeWorkspaceProvider());
    orch.registerRole(role);
    orch.registerAdapter(new FakeEngineAdapter({
      script: [
        { kind: "approval", id: "req-1", detail: { tool: "bash", description: 42 } },
        { kind: "done", summary: "ok" },
      ],
    }));
    const agent = orch.spawn("Impl", "task");
    await waitForState(orch, agent.id, "awaiting-approval");
    expect(orch.getAgent(agent.id)!.approvalDetail).toBeUndefined();
    orch.approve(agent.id, "req-1", "allow");
    await waitForState(orch, agent.id, "done");
  });
});

// ----------------------------------------------------------------------------
// Issue 16 (T4): hydrate must deep-copy the mutable log array
// ----------------------------------------------------------------------------
describe("Orchestrator hydrate log aliasing (T4)", () => {
  it("does not mutate the caller's original log array on later events", async () => {
    const originalLog = [{ kind: "output" as const, text: "hello" }];
    const record = {
      agent: {
        id: "a1",
        task: { id: "t1", description: "x", roleName: "Impl" },
        role,
        state: "detached" as const,
        log: originalLog,
        workspace: { agentId: "a1", path: "/wt/a1", branch: "agent/a1" },
      },
    };
    const orch = new Orchestrator({ maxParallelAgents: 1 }, new FakeWorkspaceProvider());
    orch.hydrate([record]);

    // The hydrated agent has its own log array.
    expect(orch.getAgent("a1")!.log).not.toBe(originalLog);
    expect(originalLog).toHaveLength(1);
  });

  it("hydrating the same record into two orchestrators yields independent log arrays", () => {
    const record = {
      agent: {
        id: "a1",
        task: { id: "t1", description: "x", roleName: "Impl" },
        role,
        state: "done" as const,
        log: [{ kind: "output" as const, text: "hi" }],
      },
    };
    const o1 = new Orchestrator({ maxParallelAgents: 1 }, new FakeWorkspaceProvider());
    const o2 = new Orchestrator({ maxParallelAgents: 1 }, new FakeWorkspaceProvider());
    o1.hydrate([record]);
    o2.hydrate([record]);
    const log1 = o1.getAgent("a1")!.log;
    const log2 = o2.getAgent("a1")!.log;
    expect(log1).not.toBe(log2);
    expect(log1).not.toBe(record.agent.log);
    expect(log2).not.toBe(record.agent.log);
  });

  it("defaults to [] when the persisted log is not an array", () => {
    const record = {
      // Simulate a corrupt/partial persisted record.
      agent: {
        id: "a1",
        task: { id: "t1", description: "x", roleName: "Impl" },
        role,
        state: "done" as const,
        log: undefined as unknown as [],
      },
    };
    const orch = new Orchestrator({ maxParallelAgents: 1 }, new FakeWorkspaceProvider());
    orch.hydrate([record]);
    expect(orch.getAgent("a1")!.log).toEqual([]);
  });
});

// ----------------------------------------------------------------------------
// Issue 20 (C3): discard() must serialize against merge()
// ----------------------------------------------------------------------------
describe("Orchestrator discard serialized against merge (C3)", () => {
  it("does not start the discard's workspace op until an in-flight merge releases", async () => {
    const gateMerge = deferred<void>();
    const order: string[] = [];
    class SerialManager extends FakeWorkspaceManager {
      override async merge(agentId: string): Promise<MergeResult> {
        order.push(`merge-start:${agentId}`);
        await gateMerge.promise;
        order.push(`merge-end:${agentId}`);
        return super.merge(agentId);
      }
      override async discard(agentId: string): Promise<void> {
        order.push(`discard-start:${agentId}`);
        return super.discard(agentId);
      }
    }
    const manager = new SerialManager();
    const orch = new Orchestrator({ maxParallelAgents: 2 }, manager);
    orch.registerRole(role);
    orch.registerAdapter(new FakeEngineAdapter({ script: [{ kind: "done", summary: "ok" }] }));
    const a1 = orch.spawn("Impl", "task 1");
    const a2 = orch.spawn("Impl", "task 2");
    await waitForState(orch, a1.id, "done");
    await waitForState(orch, a2.id, "done");

    const m = orch.merge(a1.id);
    const d = orch.discard(a2.id);
    await tick();
    // Discard's workspace op has NOT started while the merge is gated.
    expect(order).toEqual(["merge-start:agent-1"]);

    gateMerge.resolve();
    await Promise.all([m, d]);
    expect(order).toEqual([
      "merge-start:agent-1",
      "merge-end:agent-1",
      "discard-start:agent-2",
    ]);
    expect(orch.getAgent(a2.id)!.state).toBe("discarded");
  });
});
