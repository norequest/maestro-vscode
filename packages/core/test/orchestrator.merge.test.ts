import { describe, expect, it } from "vitest";
import { FakeEngineAdapter, FakeWorkspaceManager, Orchestrator } from "../src/index.js";
import type { MergeResult, Role } from "../src/index.js";

const role: Role = { name: "Impl", instructions: "", engine: { id: "fake" }, autonomy: "manual" };

function build(script: { manager?: FakeWorkspaceManager } = {}) {
  const manager = script.manager ?? new FakeWorkspaceManager();
  const orch = new Orchestrator({ maxParallelAgents: 1 }, manager);
  orch.registerRole(role);
  orch.registerAdapter(
    new FakeEngineAdapter({ script: [{ kind: "done", summary: "ok" }] }),
  );
  return { orch, manager };
}

function waitFor(orch: Orchestrator, agentId: string, state: string): Promise<void> {
  return new Promise((resolve) => {
    const unsub = orch.on(() => {
      if (orch.getAgent(agentId)?.state === state) { unsub(); resolve(); }
    });
    if (orch.getAgent(agentId)?.state === state) { unsub(); resolve(); }
  });
}

describe("Orchestrator merge/discard", () => {
  it("clean merge -> merged + cleanup", async () => {
    const { orch, manager } = build();
    const agent = orch.spawn("Impl", "task");
    await waitFor(orch, agent.id, "done");

    const result = await orch.merge(agent.id);
    expect(result).toEqual({ status: "clean" });
    expect(orch.getAgent(agent.id)!.state).toBe("merged");
    expect(manager.merged).toContain(agent.id);
    expect(manager.cleaned).toContain(agent.id);
  });

  it("conflict merge -> conflict state, no cleanup, files recorded", async () => {
    const manager = new FakeWorkspaceManager();
    const { orch } = build({ manager });
    const agent = orch.spawn("Impl", "task");
    await waitFor(orch, agent.id, "done");
    manager.setMergeResult(agent.id, { status: "conflict", files: ["x.ts"] });

    const result = await orch.merge(agent.id);
    expect(result).toEqual({ status: "conflict", files: ["x.ts"] });
    expect(orch.getAgent(agent.id)!.state).toBe("conflict");
    expect(orch.getAgent(agent.id)!.conflict).toEqual({ files: ["x.ts"] });
    expect(manager.cleaned).not.toContain(agent.id); // preserved for resolution
  });

  it("merge throws unless the agent is done", async () => {
    const { orch } = build();
    const agent = orch.spawn("Impl", "task");
    await waitFor(orch, agent.id, "done");
    await orch.merge(agent.id); // -> merged
    await expect(orch.merge(agent.id)).rejects.toThrow("not ready to merge");
  });

  it("discard -> discarded + cleanup, allowed from done", async () => {
    const { orch, manager } = build();
    const agent = orch.spawn("Impl", "task");
    await waitFor(orch, agent.id, "done");

    await orch.discard(agent.id);
    expect(orch.getAgent(agent.id)!.state).toBe("discarded");
    expect(manager.discarded).toContain(agent.id);
  });

  it("discard is allowed from a conflict state (the merge-failed-throw-it-away path)", async () => {
    const manager = new FakeWorkspaceManager();
    const { orch } = build({ manager });
    const agent = orch.spawn("Impl", "task");
    await waitFor(orch, agent.id, "done");
    manager.setMergeResult(agent.id, { status: "conflict", files: ["x.ts"] });
    await orch.merge(agent.id);
    expect(orch.getAgent(agent.id)!.state).toBe("conflict");

    await orch.discard(agent.id);
    expect(orch.getAgent(agent.id)!.state).toBe("discarded");
    expect(manager.discarded).toContain(agent.id);
  });

  it("merge throws when the provider is not a WorkspaceManager", async () => {
    const { Orchestrator, FakeWorkspaceProvider, FakeEngineAdapter } = await import("../src/index.js");
    const orch = new Orchestrator({ maxParallelAgents: 1 }, new FakeWorkspaceProvider());
    orch.registerRole(role);
    orch.registerAdapter(new FakeEngineAdapter({ script: [{ kind: "done", summary: "ok" }] }));
    const agent = orch.spawn("Impl", "task");
    await waitFor(orch, agent.id, "done");
    await expect(orch.merge(agent.id)).rejects.toThrow("does not support merge");
  });
});

// ---- M9: merge mutex ----
describe("Orchestrator merge mutex (serialization)", () => {
  it("serializes two near-simultaneous merge calls", async () => {
    const order: string[] = [];
    class OrderedFakeManager extends FakeWorkspaceManager {
      override async merge(agentId: string): Promise<MergeResult> {
        order.push(`start:${agentId}`);
        await new Promise<void>((r) => setTimeout(r, 0));
        order.push(`end:${agentId}`);
        return super.merge(agentId);
      }
    }
    const manager = new OrderedFakeManager();
    manager.setMergeResult("agent-1", { status: "clean" });
    manager.setMergeResult("agent-2", { status: "clean" });
    const orch = new Orchestrator({ maxParallelAgents: 2 }, manager);
    orch.registerRole(role);
    orch.registerAdapter(new FakeEngineAdapter({ script: [{ kind: "done", summary: "ok" }] }));
    const a1 = orch.spawn("Impl", "task 1");
    const a2 = orch.spawn("Impl", "task 2");
    await waitFor(orch, a1.id, "done");
    await waitFor(orch, a2.id, "done");
    await Promise.all([orch.merge(a1.id), orch.merge(a2.id)]);
    // No overlap: the first end precedes the second start.
    const firstEnd = Math.min(order.indexOf(`end:${a1.id}`), order.indexOf(`end:${a2.id}`));
    const lastStart = Math.max(order.indexOf(`start:${a1.id}`), order.indexOf(`start:${a2.id}`));
    expect(lastStart).toBeGreaterThan(firstEnd);
  });
});

describe("Orchestrator merge -> cleanup failure recovery", () => {
  it("enters merge-cleanup-failed when cleanup rejects after a clean merge", async () => {
    class FailingCleanupManager extends FakeWorkspaceManager {
      override cleanup(): Promise<void> { return Promise.reject(new Error("cleanup disk full")); }
    }
    const manager = new FailingCleanupManager();
    manager.setMergeResult("agent-1", { status: "clean" });
    const orch = new Orchestrator({ maxParallelAgents: 1 }, manager);
    orch.registerRole(role);
    orch.registerAdapter(new FakeEngineAdapter({ script: [{ kind: "done", summary: "ok" }] }));
    const agent = orch.spawn("Impl", "task");
    await waitFor(orch, agent.id, "done");
    const result = await orch.merge(agent.id);
    expect(result).toEqual({ status: "clean" });
    expect(orch.getAgent(agent.id)!.state).toBe("merge-cleanup-failed");
    expect(orch.getAgent(agent.id)!.error).toContain("cleanup disk full");
  });

  it("retryCleanup transitions merge-cleanup-failed -> merged", async () => {
    class FailThenSucceedManager extends FakeWorkspaceManager {
      private attempt = 0;
      override cleanup(): Promise<void> {
        this.attempt++;
        return this.attempt === 1 ? Promise.reject(new Error("disk full")) : Promise.resolve();
      }
    }
    const manager = new FailThenSucceedManager();
    manager.setMergeResult("agent-1", { status: "clean" });
    const orch = new Orchestrator({ maxParallelAgents: 1 }, manager);
    orch.registerRole(role);
    orch.registerAdapter(new FakeEngineAdapter({ script: [{ kind: "done", summary: "ok" }] }));
    const agent = orch.spawn("Impl", "task");
    await waitFor(orch, agent.id, "done");
    await orch.merge(agent.id);
    expect(orch.getAgent(agent.id)!.state).toBe("merge-cleanup-failed");
    await orch.retryCleanup(agent.id);
    expect(orch.getAgent(agent.id)!.state).toBe("merged");
    expect(orch.getAgent(agent.id)!.error).toBeUndefined();
  });

  it("retryCleanup throws if not in merge-cleanup-failed state", async () => {
    const { orch } = build();
    const agent = orch.spawn("Impl", "task");
    await waitFor(orch, agent.id, "done");
    await expect(orch.retryCleanup(agent.id)).rejects.toThrow(/merge-cleanup-failed/i);
  });
});

describe("Orchestrator.finishConflictResolution", () => {
  it("transitions conflict -> merged and clears the conflict field", async () => {
    const manager = new FakeWorkspaceManager();
    manager.setMergeResult("agent-1", { status: "conflict", files: ["a.ts"] });
    const orch = new Orchestrator({ maxParallelAgents: 1 }, manager);
    orch.registerRole(role);
    orch.registerAdapter(new FakeEngineAdapter({ script: [{ kind: "done", summary: "ok" }] }));
    const agent = orch.spawn("Impl", "task");
    await waitFor(orch, agent.id, "done");
    await orch.merge(agent.id);
    expect(orch.getAgent(agent.id)!.state).toBe("conflict");
    orch.finishConflictResolution(agent.id);
    expect(orch.getAgent(agent.id)!.state).toBe("merged");
    expect(orch.getAgent(agent.id)!.conflict).toBeUndefined();
  });

  it("throws if the agent is not in conflict state", async () => {
    const { orch } = build();
    const agent = orch.spawn("Impl", "task");
    await waitFor(orch, agent.id, "done");
    expect(() => orch.finishConflictResolution(agent.id)).toThrow(/not in conflict state/i);
  });
});
