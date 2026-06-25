import { describe, expect, it } from "vitest";
import type { Role, Team } from "@hallucinate/core";
import { buildLeadTeam, launchLeadTeam } from "../src/default-team.js";

const role = (name: string): Role => ({
  name,
  instructions: `You are ${name}.`,
  engine: { id: "copilot" },
  autonomy: "auto-approve-safe",
});

const lead: Role = {
  name: "Lead",
  instructions: "You are the lead.",
  engine: { id: "copilot" },
  autonomy: "auto-approve-safe",
  skills: ["task-coordination-strategies"],
};

describe("buildLeadTeam", () => {
  it("makes the lead first and the team's lead", () => {
    const team = buildLeadTeam("Backend", [role("Reviewer")], lead);
    expect(team.name).toBe("Backend");
    expect(team.lead).toBe(lead.name);
    expect(team.roles[0]).toBe(lead);
  });

  it("lists the lead first, then the roster in input order", () => {
    const team = buildLeadTeam("T", [role("Reviewer"), role("Builder")], lead);
    expect(team.roles.map((r) => r.name)).toEqual(["Lead", "Reviewer", "Builder"]);
    // The first role IS the lead definition (not a look-alike).
    expect(team.roles[0]).toBe(lead);
  });

  it("includes every roster role", () => {
    const roster = [role("Reviewer"), role("Builder"), role("Tester")];
    const team = buildLeadTeam("T", roster, lead);
    for (const r of roster) {
      expect(team.roles.map((x) => x.name)).toContain(r.name);
    }
  });

  it("dedupes a roster role sharing the lead's name (lead wins, listed once, stays first)", () => {
    const lookAlike = role("Lead"); // same name as lead, different instructions
    const team = buildLeadTeam("T", [lookAlike, role("Reviewer")], lead);
    expect(team.roles.map((r) => r.name)).toEqual(["Lead", "Reviewer"]);
    // The retained "Lead" is the authoritative lead, not the dup.
    expect(team.roles[0]).toBe(lead);
    expect(team.roles[0]).not.toBe(lookAlike);
    expect(team.roles.filter((r) => r.name === "Lead")).toHaveLength(1);
  });

  it("works with an empty roster (team = [lead])", () => {
    const team = buildLeadTeam("T", [], lead);
    expect(team.roles).toEqual([lead]);
    expect(team.lead).toBe(lead.name);
  });
});

describe("launchLeadTeam", () => {
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

  it("builds a lead-headed team: lead is first and the team's lead, the team's roles follow, autoApprove on", () => {
    const orch = spyOrch();
    const team: Team = { name: "Backend", roles: [role("ApiDev"), role("DbDev")] };
    launchLeadTeam(team, "wire the endpoint", lead, orch.deps);

    expect(orch.launches).toHaveLength(1);
    const [call] = orch.launches;
    expect(call!.opts).toEqual({ autoApprove: true });
    expect(call!.task).toBe("wire the endpoint");
    // Lead heads the team.
    expect(call!.team.lead).toBe(lead.name);
    // Roles START with the lead and INCLUDE the team's resolved roles.
    expect(call!.team.roles[0]).toBe(lead);
    expect(call!.team.roles.map((r) => r.name)).toEqual(["Lead", "ApiDev", "DbDev"]);
    // Keeps the team's own name.
    expect(call!.team.name).toBe("Backend");
  });

  it("IGNORES the team's own lead field (a specialist), the lead still heads the run", () => {
    const orch = spyOrch();
    // The team hand-declares a specialist as its lead. It must be ignored.
    const team: Team = { name: "Backend", roles: [role("ApiDev"), role("DbDev")], lead: "DbDev" };
    launchLeadTeam(team, "task", lead, orch.deps);

    const [call] = orch.launches;
    expect(call!.team.lead).toBe(lead.name);
    expect(call!.team.lead).not.toBe("DbDev");
    expect(call!.team.roles[0]).toBe(lead);
  });

  it("registers the lead and every team role before launching", () => {
    const orch = spyOrch();
    const team: Team = { name: "Backend", roles: [role("ApiDev"), role("DbDev")] };
    launchLeadTeam(team, "task", lead, orch.deps);
    expect(orch.registered).toEqual(["Lead", "ApiDev", "DbDev"]);
  });
});
