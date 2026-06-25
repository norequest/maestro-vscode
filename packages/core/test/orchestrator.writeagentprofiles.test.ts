import { describe, it, expect } from "vitest";
import { Orchestrator } from "../src/orchestrator.js";
import { FakeEngineAdapter } from "../src/fake-adapter.js";
import { FakeWorkspaceProvider, FakeWorkspaceManager } from "../src/workspace.js";
import type { AgentProfile } from "../src/types.js";

function waitForState(orch: Orchestrator, agentId: string, target: string): Promise<void> {
  return new Promise((resolve) => {
    let unsub: (() => void) | undefined;
    const check = (): void => {
      if (orch.getAgent(agentId)?.state === target) {
        unsub?.();
        resolve();
      }
    };
    unsub = orch.on(check);
    check();
  });
}

describe("Orchestrator agent profile materialization (writeAgentProfiles)", () => {
  it("materializes the task's agent profiles into the agent's worktree before the engine starts", async () => {
    const profile: AgentProfile = { name: "scribe", content: "---\nname: scribe\n---\nBe a scribe." };

    const adapter = new FakeEngineAdapter({ script: [{ kind: "done", summary: "ok" }] });
    const manager = new FakeWorkspaceManager();
    const orch = new Orchestrator({ maxParallelAgents: 1 }, manager);
    orch.registerAdapter(adapter);
    orch.registerRole({ name: "R", instructions: "do it", engine: { id: "fake" }, autonomy: "yolo" });

    const agent = orch.spawn("R", "my task", { agentProfiles: [profile] });
    await waitForState(orch, agent.id, "done");

    expect(manager.wroteAgentProfiles).toHaveLength(1);
    expect(manager.wroteAgentProfiles[0]!.agentId).toBe(agent.id);
    expect(manager.wroteAgentProfiles[0]!.profiles).toEqual([profile]);
    // The worktree is created before profiles are written.
    expect(manager.created).toContain(agent.id);
  });

  it("spawn() with agentProfiles puts them on the agent's task", () => {
    const profile: AgentProfile = { name: "scribe", content: "## scribe\nbody" };

    const adapter = new FakeEngineAdapter({ script: [{ kind: "done", summary: "ok" }] });
    const orch = new Orchestrator({ maxParallelAgents: 1 }, new FakeWorkspaceManager());
    orch.registerAdapter(adapter);
    orch.registerRole({ name: "R", instructions: "do it", engine: { id: "fake" }, autonomy: "yolo" });

    const agent = orch.spawn("R", "my task", { agentProfiles: [profile] });

    expect(agent.task.agentProfiles).toEqual([profile]);
  });

  it("skips materialization when the task carries no agent profiles", async () => {
    const adapter = new FakeEngineAdapter({ script: [{ kind: "done", summary: "ok" }] });
    const manager = new FakeWorkspaceManager();
    const orch = new Orchestrator({ maxParallelAgents: 1 }, manager);
    orch.registerAdapter(adapter);
    orch.registerRole({ name: "R", instructions: "do it", engine: { id: "fake" }, autonomy: "yolo" });

    const agent = orch.spawn("R", "my task");
    await waitForState(orch, agent.id, "done");

    expect(manager.wroteAgentProfiles).toHaveLength(0);
  });

  it("is a no-op (no crash) when the provider does not support writeAgentProfiles", async () => {
    const profile: AgentProfile = { name: "scribe", content: "## scribe\nbody" };

    const adapter = new FakeEngineAdapter({ script: [{ kind: "done", summary: "ok" }] });
    const orch = new Orchestrator({ maxParallelAgents: 1 }, new FakeWorkspaceProvider());
    orch.registerAdapter(adapter);
    orch.registerRole({ name: "R", instructions: "do it", engine: { id: "fake" }, autonomy: "yolo" });

    const agent = orch.spawn("R", "my task", { agentProfiles: [profile] });
    await waitForState(orch, agent.id, "done");

    // No manager API to assert against; reaching "done" without throwing is the contract.
    expect(orch.getAgent(agent.id)?.state).toBe("done");
  });
});
