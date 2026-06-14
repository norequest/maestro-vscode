import { describe, expect, it } from "vitest";
import { FakeEngineAdapter, FakeWorkspaceManager, Orchestrator } from "../src/index.js";
import type { Role } from "../src/index.js";

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
