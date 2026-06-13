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

function build() {
  const workspaces = new FakeWorkspaceProvider();
  const orch = new Orchestrator({ maxParallelAgents: 1 }, workspaces);
  orch.registerRole(role);
  const adapter = new FakeEngineAdapter({
    script: [
      { kind: "approval", id: "ap1", detail: "run npm test" },
      { kind: "done", summary: "done", diff: { files: [], patch: "" } },
    ],
  });
  orch.registerAdapter(adapter);
  return { orch, adapter };
}

describe("Orchestrator approvals", () => {
  it("parks on approval, then resumes and completes when approved", async () => {
    const { orch, adapter } = build();
    const agent = orch.spawn("Implementer", "task");

    await waitForState(orch, agent.id, "awaiting-approval");
    expect(orch.getAgent(agent.id)!.pendingApprovalId).toBe("ap1");

    orch.approve(agent.id, "ap1", "allow");
    await waitForState(orch, agent.id, "done");

    expect(adapter.lastSession!.decisions).toEqual([{ id: "ap1", decision: "allow" }]);
    expect(orch.getAgent(agent.id)!.pendingApprovalId).toBeUndefined();
  });

  it("throws if approving an agent that is not awaiting approval", async () => {
    const { orch } = build();
    const agent = orch.spawn("Implementer", "task");
    await waitForState(orch, agent.id, "awaiting-approval");
    orch.approve(agent.id, "ap1", "allow");
    expect(() => orch.approve(agent.id, "ap1", "allow")).toThrow("is not awaiting approval");
  });
});
