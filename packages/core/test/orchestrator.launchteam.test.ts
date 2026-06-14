import { describe, expect, it } from "vitest";
import { Orchestrator } from "../src/orchestrator.js";
import { FakeEngineAdapter } from "../src/fake-adapter.js";
import { FakeWorkspaceProvider } from "../src/workspace.js";
import type { Role, Team } from "../src/types.js";

function role(name: string): Role {
  // One adapter is registered per engine id; give each role its own engine so a
  // team member resolves to a distinct adapter.
  return { name, instructions: `do ${name}`, engine: { id: name }, autonomy: "manual" };
}

function pendingAdapter(name: string): FakeEngineAdapter {
  // Parks the session on an approval so the agent settles in a non-terminal,
  // slot-holding state. This keeps a started agent "running" for the duration of
  // the test so the concurrency assertion is meaningful.
  return new FakeEngineAdapter({ id: name, script: [{ kind: "approval", id: `ap-${name}`, detail: null }] });
}

function waitForState(orch: Orchestrator, agentId: string, target: string): Promise<void> {
  return new Promise((resolve) => {
    const check = (): void => {
      if (orch.getAgent(agentId)?.state === target) resolve();
    };
    orch.on(check);
    check();
  });
}

describe("Orchestrator.launchTeam", () => {
  it("launches one agent per role, in order, each with the shared description", async () => {
    const workspaces = new FakeWorkspaceProvider();
    const orch = new Orchestrator({ maxParallelAgents: 3 }, workspaces);

    const team: Team = { name: "build-team", roles: [role("planner"), role("coder"), role("reviewer")] };
    for (const r of team.roles) {
      orch.registerAdapter(pendingAdapter(r.name));
    }

    const agents = orch.launchTeam(team, "ship the feature");

    expect(agents).toHaveLength(3);
    // Order preserved, role bound by name, shared description threaded through.
    expect(agents.map((a) => a.role.name)).toEqual(["planner", "coder", "reviewer"]);
    for (const a of agents) {
      expect(a.task.description).toBe("ship the feature");
      // Each returned agent is the live, tracked instance.
      expect(orch.getAgent(a.id)).toBe(a);
    }
  });

  it("registers each role so a later spawn(role.name, ...) resolves", async () => {
    const workspaces = new FakeWorkspaceProvider();
    const orch = new Orchestrator({ maxParallelAgents: 4 }, workspaces);

    const team: Team = { name: "t", roles: [role("alpha"), role("beta")] };
    for (const r of team.roles) {
      orch.registerAdapter(pendingAdapter(r.name));
    }

    orch.launchTeam(team, "task");

    // Roles are now registered: spawning by name must NOT throw "Unknown role".
    const extra = orch.spawn("alpha", "follow-up");
    expect(extra.role.name).toBe("alpha");
    await waitForState(orch, extra.id, "working");
    expect(extra.state).toBe("working");
  });

  it("inherits the concurrency queue: a team larger than the limit spawns N and queues the rest", async () => {
    const workspaces = new FakeWorkspaceProvider();
    const orch = new Orchestrator({ maxParallelAgents: 2 }, workspaces);

    const team: Team = { name: "t", roles: [role("one"), role("two"), role("three")] };
    for (const r of team.roles) {
      orch.registerAdapter(pendingAdapter(r.name));
    }

    const agents = orch.launchTeam(team, "task");
    expect(agents).toHaveLength(3);

    // First two reach the engine; the third is queued (never created a workspace).
    await waitForState(orch, agents[0]!.id, "awaiting-approval");
    await waitForState(orch, agents[1]!.id, "awaiting-approval");

    // Same observable the spawn/queue tests use: create() only fires at launch, so
    // exactly the first two have workspaces and the surplus stays "preparing".
    expect(new Set(workspaces.created)).toEqual(new Set([agents[0]!.id, agents[1]!.id]));
    expect(workspaces.created).toHaveLength(2);
    expect(orch.getAgent(agents[2]!.id)!.state).toBe("preparing");
  });

  it("returns an empty array and spawns nothing for an empty team", () => {
    const workspaces = new FakeWorkspaceProvider();
    const orch = new Orchestrator({ maxParallelAgents: 2 }, workspaces);

    const team: Team = { name: "empty", roles: [] };
    const agents = orch.launchTeam(team, "task");

    expect(agents).toEqual([]);
    expect(orch.getAgents()).toEqual([]);
    expect(workspaces.created).toEqual([]);
  });
});
