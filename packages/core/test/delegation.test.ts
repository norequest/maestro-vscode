import { describe, expect, it } from "vitest";
import { parseDelegateDirectives, buildLeadBrief, DELEGATE_FENCE } from "../src/delegation.js";
import type { Role, Team } from "../src/types.js";

function role(name: string, instructions = `do ${name}`): Role {
  return { name, instructions, engine: { id: "copilot" }, autonomy: "manual" };
}

describe("parseDelegateDirectives", () => {
  it("parses a single role + task block", () => {
    const text = "Sure, I'll start a coder.\n```delegate\nrole: coder\ntask: build the parser\n```\nDone.";
    expect(parseDelegateDirectives(text)).toEqual([{ role: "coder", task: "build the parser" }]);
  });

  it("captures a multiline task to the end of the block", () => {
    const text = ["```delegate", "role: coder", "task: line one", "line two", "line three", "```"].join("\n");
    expect(parseDelegateDirectives(text)).toEqual([
      { role: "coder", task: "line one\nline two\nline three" },
    ]);
  });

  it("parses several blocks in one buffer", () => {
    const text = [
      "```delegate",
      "role: coder",
      "task: implement",
      "```",
      "and also",
      "```delegate",
      "role: tester",
      "task: write tests",
      "```",
    ].join("\n");
    expect(parseDelegateDirectives(text)).toEqual([
      { role: "coder", task: "implement" },
      { role: "tester", task: "write tests" },
    ]);
  });

  it("ignores an incomplete trailing block (no closing fence)", () => {
    const text = "```delegate\nrole: coder\ntask: building...";
    expect(parseDelegateDirectives(text)).toEqual([]);
  });

  it("yields the directive only once the closing fence streams in", () => {
    const partial = "```delegate\nrole: coder\ntask: build";
    expect(parseDelegateDirectives(partial)).toEqual([]);
    const complete = partial + "\n```";
    expect(parseDelegateDirectives(complete)).toEqual([{ role: "coder", task: "build" }]);
  });

  it("skips a block missing role or task", () => {
    expect(parseDelegateDirectives("```delegate\nrole: coder\n```")).toEqual([]);
    expect(parseDelegateDirectives("```delegate\ntask: orphan\n```")).toEqual([]);
  });

  it("tolerates indentation around the closing fence", () => {
    const text = "```delegate\nrole: coder\ntask: go\n  ```";
    expect(parseDelegateDirectives(text)).toEqual([{ role: "coder", task: "go" }]);
  });
});

describe("buildLeadBrief", () => {
  const team: Team = {
    name: "Feature Team",
    roles: [role("Lead"), role("Coder", "Coder: writes the implementation"), role("Reviewer")],
    lead: "Lead",
  };

  it("frames the lead as the default agent that loads specialists as sub-agents", () => {
    const brief = buildLeadBrief(team, team.roles[0]!);
    // Conductor / default-agent framing, not hinging on the team name.
    expect(brief).toContain("You are the default agent.");
    expect(brief).toContain("Specialists you can load as sub-agents:");
    // It no longer opens with the old "LEAD of the team" phrasing.
    expect(brief).not.toContain("LEAD of the team");
  });

  it("lists the specialists but not the lead itself", () => {
    const brief = buildLeadBrief(team, team.roles[0]!);
    expect(brief).toContain("Coder");
    expect(brief).toContain("Reviewer");
    // The lead is not listed as one of its own loadable specialists.
    expect(brief).not.toMatch(/- Lead:/);
  });

  it("teaches the exact delegate fence the parser expects", () => {
    const brief = buildLeadBrief(team, team.roles[0]!);
    expect(brief).toContain("```" + DELEGATE_FENCE);
    expect(brief).toContain("role:");
    expect(brief).toContain("task:");
  });

  it("handles a lead with no teammates", () => {
    const solo: Team = { name: "Solo", roles: [role("Lead")] };
    const brief = buildLeadBrief(solo, solo.roles[0]!);
    expect(brief).toContain("complete the task yourself");
  });

  it("uses no em dashes (house style)", () => {
    const brief = buildLeadBrief(team, team.roles[0]!);
    expect(brief).not.toContain("—");
  });

  it("points to the delegation playbook instead of inlining the prose", () => {
    const brief = buildLeadBrief(team, team.roles[0]!);
    // The long playbook prose moved out to the delegation-playbook skill (applied
    // via config defaults.leadSkills); the brief now just points to it.
    expect(brief).toMatch(/delegation playbook/i);
    // The inlined hard-rules block and its distinctive phrasing are gone.
    expect(brief).not.toContain("Delegation playbook (hard rules)");
    expect(brief).not.toMatch(/wide and shallow/i);
    expect(brief).not.toMatch(/file ownership/i);
  });
});
