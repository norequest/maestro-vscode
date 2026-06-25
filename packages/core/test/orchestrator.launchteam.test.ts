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
  // slot-holding state for the duration of the test.
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

describe("Orchestrator.launchTeam (lead-driven)", () => {
  it("spawns ONLY the lead (first role by default), not the whole roster", async () => {
    const workspaces = new FakeWorkspaceProvider();
    const orch = new Orchestrator({ maxParallelAgents: 3 }, workspaces);

    const team: Team = { name: "build-team", roles: [role("planner"), role("coder"), role("reviewer")] };
    for (const r of team.roles) orch.registerAdapter(pendingAdapter(r.name));

    const agents = orch.launchTeam(team, "ship the feature");

    // One agent only: the lead. The teammates are not spawned up front.
    expect(agents).toHaveLength(1);
    expect(agents[0]!.role.name).toBe("planner");
    expect(agents[0]!.task.description).toBe("ship the feature");
    expect(orch.getAgents()).toHaveLength(1);
  });

  it("prefixes the lead with a brief that names the teammates and the delegate fence", () => {
    const workspaces = new FakeWorkspaceProvider();
    const orch = new Orchestrator({ maxParallelAgents: 3 }, workspaces);

    const team: Team = { name: "build-team", roles: [role("planner"), role("coder"), role("reviewer")] };
    for (const r of team.roles) orch.registerAdapter(pendingAdapter(r.name));

    const [lead] = orch.launchTeam(team, "ship it");

    expect(lead!.role.instructions).toContain("coder");
    expect(lead!.role.instructions).toContain("reviewer");
    expect(lead!.role.instructions).toContain("```delegate");
    // The brief is per-agent: the lead's own original instructions are preserved.
    expect(lead!.role.instructions).toContain("do planner");
  });

  it("honors team.lead when set", () => {
    const workspaces = new FakeWorkspaceProvider();
    const orch = new Orchestrator({ maxParallelAgents: 3 }, workspaces);

    const team: Team = {
      name: "t",
      roles: [role("planner"), role("coder"), role("reviewer")],
      lead: "coder",
    };
    for (const r of team.roles) orch.registerAdapter(pendingAdapter(r.name));

    const agents = orch.launchTeam(team, "task");
    expect(agents).toHaveLength(1);
    expect(agents[0]!.role.name).toBe("coder");
  });

  it("registers every role so a later spawn / delegation resolves by name", async () => {
    const workspaces = new FakeWorkspaceProvider();
    const orch = new Orchestrator({ maxParallelAgents: 4 }, workspaces);

    const team: Team = { name: "t", roles: [role("alpha"), role("beta")] };
    for (const r of team.roles) orch.registerAdapter(pendingAdapter(r.name));

    orch.launchTeam(team, "task");

    // Roles are registered even though only the lead was spawned: spawning the
    // non-lead role by name must NOT throw "Unknown role".
    const extra = orch.spawn("beta", "follow-up");
    expect(extra.role.name).toBe("beta");
    await waitForState(orch, extra.id, "working");
    expect(extra.state).toBe("working");
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
