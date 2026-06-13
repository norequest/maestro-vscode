import { describe, expect, it } from "vitest";
import { Orchestrator } from "../src/orchestrator.js";
import { FakeEngineAdapter } from "../src/fake-adapter.js";
import { FakeWorkspaceProvider } from "../src/workspace.js";
import type { Role } from "../src/types.js";

const role: Role = {
  name: "Implementer",
  instructions: "build it",
  engine: { id: "fake" },
  autonomy: "manual",
};

const missingEngineRole: Role = { ...role, name: "Ghost", engine: { id: "nope" } };

function waitForState(orch: Orchestrator, agentId: string, target: string): Promise<void> {
  return new Promise((resolve) => {
    const check = () => {
      if (orch.getAgent(agentId)?.state === target) resolve();
    };
    orch.on(check);
    check();
  });
}

describe("Orchestrator error handling", () => {
  it("goes to error on an explicit error event", async () => {
    const workspaces = new FakeWorkspaceProvider();
    const orch = new Orchestrator({ maxParallelAgents: 1 }, workspaces);
    orch.registerRole(role);
    orch.registerAdapter(
      new FakeEngineAdapter({ script: [{ kind: "error", message: "boom" }] }),
    );
    const agent = orch.spawn("Implementer", "task");
    await waitForState(orch, agent.id, "error");
    expect(orch.getAgent(agent.id)!.error).toBe("boom");
  });

  it("errors when the stream ends without a terminal event", async () => {
    const workspaces = new FakeWorkspaceProvider();
    const orch = new Orchestrator({ maxParallelAgents: 1 }, workspaces);
    orch.registerRole(role);
    orch.registerAdapter(
      new FakeEngineAdapter({ script: [{ kind: "output", text: "partial" }] }),
    );
    const agent = orch.spawn("Implementer", "task");
    await waitForState(orch, agent.id, "error");
    expect(orch.getAgent(agent.id)!.error).toContain("without a terminal event");
  });

  it("errors when no adapter is registered for the role's engine", async () => {
    const workspaces = new FakeWorkspaceProvider();
    const orch = new Orchestrator({ maxParallelAgents: 1 }, workspaces);
    orch.registerRole(missingEngineRole);
    const agent = orch.spawn("Ghost", "task");
    await waitForState(orch, agent.id, "error");
    expect(orch.getAgent(agent.id)!.error).toContain("No adapter for engine nope");
  });

  it("errors when workspace creation fails", async () => {
    const workspaces = new FakeWorkspaceProvider();
    const orch = new Orchestrator({ maxParallelAgents: 1 }, workspaces);
    orch.registerRole(role);
    orch.registerAdapter(new FakeEngineAdapter({ script: [] }));
    workspaces.failCreateFor("agent-1");
    const agent = orch.spawn("Implementer", "task");
    await waitForState(orch, agent.id, "error");
    expect(orch.getAgent(agent.id)!.error).toContain("Workspace creation failed");
  });
});
