import { describe, expect, it } from "vitest";
import { Orchestrator } from "../src/orchestrator.js";
import { FakeEngineAdapter } from "../src/fake-adapter.js";
import { FakeWorkspaceProvider } from "../src/workspace.js";
import type { Role } from "../src/types.js";

function role(engineId: string): Role {
  return { name: engineId, instructions: "x", engine: { id: engineId }, autonomy: "manual" };
}

function waitForState(orch: Orchestrator, agentId: string, target: string): Promise<void> {
  return new Promise((resolve) => {
    const check = () => {
      if (orch.getAgent(agentId)?.state === target) resolve();
    };
    orch.on(check);
    check();
  });
}

describe("Orchestrator concurrency", () => {
  it("queues a second agent until the first completes (max 1)", async () => {
    const workspaces = new FakeWorkspaceProvider();
    const orch = new Orchestrator({ maxParallelAgents: 1 }, workspaces);

    orch.registerRole(role("a"));
    orch.registerAdapter(
      new FakeEngineAdapter({
        id: "a",
        script: [
          { kind: "approval", id: "apA", detail: null },
          { kind: "done", summary: "A", diff: { files: [], patch: "" } },
        ],
      }),
    );
    orch.registerRole(role("b"));
    orch.registerAdapter(
      new FakeEngineAdapter({
        id: "b",
        script: [{ kind: "done", summary: "B", diff: { files: [], patch: "" } }],
      }),
    );

    const a = orch.spawn("a", "task A");
    const b = orch.spawn("b", "task B");

    await waitForState(orch, a.id, "awaiting-approval");

    expect(orch.getAgent(b.id)!.state).toBe("preparing");
    expect(workspaces.created).toEqual([a.id]);

    orch.approve(a.id, "apA", "allow");
    await waitForState(orch, a.id, "done");
    await waitForState(orch, b.id, "done");

    expect(workspaces.created).toEqual([a.id, b.id]);
  });

  it("runs two agents in parallel when max is 2", async () => {
    const workspaces = new FakeWorkspaceProvider();
    const orch = new Orchestrator({ maxParallelAgents: 2 }, workspaces);
    orch.registerRole(role("a"));
    orch.registerAdapter(
      new FakeEngineAdapter({ id: "a", script: [{ kind: "approval", id: "x", detail: null }] }),
    );
    orch.registerRole(role("b"));
    orch.registerAdapter(
      new FakeEngineAdapter({ id: "b", script: [{ kind: "approval", id: "y", detail: null }] }),
    );

    const a = orch.spawn("a", "A");
    const b = orch.spawn("b", "B");
    await waitForState(orch, a.id, "awaiting-approval");
    await waitForState(orch, b.id, "awaiting-approval");

    expect(new Set(workspaces.created)).toEqual(new Set([a.id, b.id]));
  });
});
