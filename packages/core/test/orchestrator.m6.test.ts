import { describe, expect, it } from "vitest";
import { Orchestrator } from "../src/orchestrator.js";
import { FakeEngineAdapter } from "../src/fake-adapter.js";
import { FakeWorkspaceProvider, FakeWorkspaceManager } from "../src/workspace.js";
import type { Role, WorkspaceProvider } from "../src/index.js";

const role: Role = { name: "Dev", instructions: "", engine: { id: "acp" }, autonomy: "manual" };

function waitForState(orch: Orchestrator, agentId: string, target: string): Promise<void> {
  return new Promise((resolve) => {
    const unsub = orch.on(() => {
      if (orch.getAgent(agentId)?.state === target) { unsub(); resolve(); }
    });
    if (orch.getAgent(agentId)?.state === target) { unsub(); resolve(); }
  });
}

describe("orchestrator M6: approvalDetail", () => {
  it("sets approvalDetail (tool + description) while awaiting approval, clears on approve", async () => {
    const orch = new Orchestrator({ maxParallelAgents: 1 }, new FakeWorkspaceProvider());
    orch.registerRole(role);
    orch.registerAdapter(new FakeEngineAdapter({
      id: "acp",
      script: [
        { kind: "approval", id: "req-1", detail: { tool: "bash", description: "Run: npm test" } },
        { kind: "done", summary: "done" },
      ],
    }));
    const agent = orch.spawn("Dev", "task");
    await waitForState(orch, agent.id, "awaiting-approval");
    expect(orch.getAgent(agent.id)!.approvalDetail).toEqual({ tool: "bash", description: "Run: npm test" });
    orch.approve(agent.id, "req-1", "allow");
    await waitForState(orch, agent.id, "done");
    expect(orch.getAgent(agent.id)!.approvalDetail).toBeUndefined();
  });

  it("ignores a non-structured approval detail (e.g. a bare string)", async () => {
    const orch = new Orchestrator({ maxParallelAgents: 1 }, new FakeWorkspaceProvider());
    orch.registerRole(role);
    orch.registerAdapter(new FakeEngineAdapter({
      id: "acp",
      script: [
        { kind: "approval", id: "req-1", detail: "just a string" },
        { kind: "done", summary: "done" },
      ],
    }));
    const agent = orch.spawn("Dev", "task");
    await waitForState(orch, agent.id, "awaiting-approval");
    expect(orch.getAgent(agent.id)!.approvalDetail).toBeUndefined();
    orch.approve(agent.id, "req-1", "allow");
    await waitForState(orch, agent.id, "done");
  });

  it("sets engineCapabilities on the agent at launch", async () => {
    const orch = new Orchestrator({ maxParallelAgents: 1 }, new FakeWorkspaceProvider());
    orch.registerRole(role);
    orch.registerAdapter(new FakeEngineAdapter({
      id: "acp",
      capabilities: { approvals: true, steerable: true },
      script: [{ kind: "done", summary: "done" }],
    }));
    const agent = orch.spawn("Dev", "task");
    await waitForState(orch, agent.id, "done");
    expect(orch.getAgent(agent.id)!.engineCapabilities).toEqual({ approvals: true, steerable: true });
  });
});

describe("orchestrator M6: sendBack", () => {
  function build(workspaces: WorkspaceProvider) {
    const orch = new Orchestrator({ maxParallelAgents: 1 }, workspaces);
    orch.registerRole(role);
    const adapter = new FakeEngineAdapter({ id: "acp", script: [{ kind: "done", summary: "attempt" }] });
    orch.registerAdapter(adapter);
    return { orch, adapter };
  }

  it("re-launches a done agent in its existing worktree with feedback appended", async () => {
    const workspaces = new FakeWorkspaceProvider();
    const { orch, adapter } = build(workspaces);
    const agent = orch.spawn("Dev", "implement feature X");
    await waitForState(orch, agent.id, "done");

    const states: string[] = [];
    orch.on((e) => { if (e.kind === "agent-updated") states.push(e.agent.state); });

    orch.sendBack(agent.id, "Please also add tests");
    await waitForState(orch, agent.id, "done");

    expect(states).toContain("preparing");
    expect(states).toContain("working");
    expect(workspaces.created).toHaveLength(1); // reused, not re-created
    expect(adapter.startedTasks).toHaveLength(2);
    expect(adapter.startedTasks[1]!.description).toContain("implement feature X");
    expect(adapter.startedTasks[1]!.description).toContain("Please also add tests");
  });

  it("re-launches a conflict agent and reuses the workspace", async () => {
    const manager = new FakeWorkspaceManager();
    const { orch } = build(manager);
    const agent = orch.spawn("Dev", "implement");
    await waitForState(orch, agent.id, "done");
    manager.setMergeResult(agent.id, { status: "conflict", files: ["src/foo.ts"] });
    await orch.merge(agent.id);
    expect(orch.getAgent(agent.id)!.state).toBe("conflict");

    orch.sendBack(agent.id, "Resolve the conflict in src/foo.ts");
    await waitForState(orch, agent.id, "done");
    expect(orch.getAgent(agent.id)!.state).toBe("done");
    expect(manager.created).toHaveLength(1);
    expect(orch.getAgent(agent.id)!.conflict).toBeUndefined();
  });

  it("throws if the agent is not done, conflict, or stopped", () => {
    const orch = new Orchestrator({ maxParallelAgents: 1 }, new FakeWorkspaceProvider());
    orch.registerRole(role);
    orch.registerAdapter(new FakeEngineAdapter({ id: "acp", script: [{ kind: "done", summary: "x" }] }));
    const agent = orch.spawn("Dev", "task");
    // Still "preparing" (synchronous): not a resumable state.
    expect(() => orch.sendBack(agent.id, "feedback")).toThrow(/cannot resume/i);
  });

  it("throws for an unknown agent", () => {
    const orch = new Orchestrator({ maxParallelAgents: 1 }, new FakeWorkspaceProvider());
    expect(() => orch.sendBack("no-such-id", "feedback")).toThrow(/unknown agent/i);
  });
});
