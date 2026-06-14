import { describe, expect, it } from "vitest";
import type { Role, Team } from "@maestro/core";
import { teamQuickPickItems } from "../src/team-picker.js";

const role = (name: string): Role => ({
  name,
  instructions: `You are ${name}.`,
  engine: { id: "copilot" },
  autonomy: "auto-approve-safe",
});

describe("teamQuickPickItems", () => {
  it("formats N teams into N items with the team name as the label", () => {
    const teams: Team[] = [
      { name: "Frontend", roles: [role("Implementer"), role("Reviewer")] },
      { name: "Backend", roles: [role("Builder")] },
    ];
    const items = teamQuickPickItems(teams);
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.label)).toEqual(["Frontend", "Backend"]);
    // The picked item carries the team so the caller can dispatch it.
    expect(items[0]!.team).toBe(teams[0]);
    expect(items[1]!.team).toBe(teams[1]);
  });

  it("describes a multi-role team with the role count and role names", () => {
    const team: Team = { name: "Squad", roles: [role("Implementer"), role("Reviewer")] };
    const [item] = teamQuickPickItems([team]);
    expect(item!.description).toContain("2 roles");
    expect(item!.description).toContain("Implementer");
    expect(item!.description).toContain("Reviewer");
  });

  it("uses the singular 'role' for a single-role team", () => {
    const team: Team = { name: "Solo", roles: [role("Implementer")] };
    const [item] = teamQuickPickItems([team]);
    expect(item!.description).toContain("1 role");
    expect(item!.description).not.toContain("1 roles");
    expect(item!.description).toContain("Implementer");
  });

  it("describes an empty-roster team with a zero count and no trailing names", () => {
    const team: Team = { name: "Empty", roles: [] };
    const [item] = teamQuickPickItems([team]);
    expect(item!.description).toContain("0 roles");
    expect(item!.description).not.toContain(":");
  });

  it("returns an empty array for an empty team list", () => {
    expect(teamQuickPickItems([])).toEqual([]);
  });
});
