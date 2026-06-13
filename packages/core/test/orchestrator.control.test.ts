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
