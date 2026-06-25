import { describe, expect, it } from "vitest";
import type { Role, Team } from "@maestro/core";
import { buildConductorTeam, launchConductorTeam } from "../src/default-team.js";

const role = (name: string): Role => ({
  name,
  instructions: `You are ${name}.`,
  engine: { id: "copilot" },
  autonomy: "auto-approve-safe",
});

const conductor: Role = {
  name: "Conductor",
  instructions: "You are the conductor.",
  engine: { id: "copilot" },
  autonomy: "auto-approve-safe",
  skills: ["task-coordination-strategies"],
};

describe("buildConductorTeam", () => {
  it("makes the conductor the lead and lists it first", () => {
    const team = buildConductorTeam("Backend", [role("Reviewer")], conductor);
    expect(team.name).toBe("Backend");
    expect(team.lead).toBe(conductor.name);
    expect(team.roles[0]).toBe(conductor);
  });

  it("lists the conductor first, then the roster in input order", () => {
    const team = buildConductorTeam("T", [role("Reviewer"), role("Builder")], conductor);
    expect(team.roles.map((r) => r.name)).toEqual(["Conductor", "Reviewer", "Builder"]);
    // The first role IS the conductor definition (not a look-alike).
    expect(team.roles[0]).toBe(conductor);
  });

  it("includes every roster role", () => {
    const roster = [role("Reviewer"), role("Builder"), role("Tester")];
    const team = buildConductorTeam("T", roster, conductor);
    for (const r of roster) {
      expect(team.roles.map((x) => x.name)).toContain(r.name);
    }
  });

  it("dedupes a roster role sharing the conductor's name (conductor wins, listed once, stays first)", () => {
    const lookAlike = role("Conductor"); // same name as conductor, different instructions
    const team = buildConductorTeam("T", [lookAlike, role("Reviewer")], conductor);
    expect(team.roles.map((r) => r.name)).toEqual(["Conductor", "Reviewer"]);
    // The retained "Conductor" is the authoritative conductor, not the dup.
    expect(team.roles[0]).toBe(conductor);
    expect(team.roles[0]).not.toBe(lookAlike);
    expect(team.roles.filter((r) => r.name === "Conductor")).toHaveLength(1);
  });

  it("works with an empty roster (team = [conductor])", () => {
    const team = buildConductorTeam("T", [], conductor);
    expect(team.roles).toEqual([conductor]);
    expect(team.lead).toBe(conductor.name);
  });
});

describe("launchConductorTeam", () => {
  /** A spy orchestrator seam mirroring the real Orchestrator's relevant methods. */
  function spyOrch() {
    const registered: string[] = [];
    const launches: Array<{ team: Team; task: string; opts: { autoApprove: boolean } }> = [];
    return {
      registered,
      launches,
      deps: {
        registerRole: (r: Role) => registered.push(r.name),
        launchTeam: (team: Team, task: string, opts: { autoApprove: boolean }) =>
          launches.push({ team, task, opts }),
      },
    };
  }

  it("builds a conductor-led team: conductor is lead and first, the team's roles follow, autoApprove on", () => {
    const orch = spyOrch();
    const team: Team = { name: "Backend", roles: [role("ApiDev"), role("DbDev")] };
    launchConductorTeam(team, "wire the endpoint", conductor, orch.deps);

    expect(orch.launches).toHaveLength(1);
    const [call] = orch.launches;
    expect(call!.opts).toEqual({ autoApprove: true });
    expect(call!.task).toBe("wire the endpoint");
    // Lead is the conductor.
    expect(call!.team.lead).toBe(conductor.name);
    // Roles START with the conductor and INCLUDE the team's resolved roles.
    expect(call!.team.roles[0]).toBe(conductor);
    expect(call!.team.roles.map((r) => r.name)).toEqual(["Conductor", "ApiDev", "DbDev"]);
    // Keeps the team's own name.
    expect(call!.team.name).toBe("Backend");
  });

  it("IGNORES the team's own lead field (a specialist), the conductor still leads", () => {
    const orch = spyOrch();
    // The team hand-declares a specialist as its lead. It must be ignored.
    const team: Team = { name: "Backend", roles: [role("ApiDev"), role("DbDev")], lead: "DbDev" };
    launchConductorTeam(team, "task", conductor, orch.deps);

    const [call] = orch.launches;
    expect(call!.team.lead).toBe(conductor.name);
    expect(call!.team.lead).not.toBe("DbDev");
    expect(call!.team.roles[0]).toBe(conductor);
  });

  it("registers the conductor and every team role before launching", () => {
    const orch = spyOrch();
    const team: Team = { name: "Backend", roles: [role("ApiDev"), role("DbDev")] };
    launchConductorTeam(team, "task", conductor, orch.deps);
    expect(orch.registered).toEqual(["Conductor", "ApiDev", "DbDev"]);
  });
});
