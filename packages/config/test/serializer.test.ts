import { describe, it, expect } from "vitest";
import { serializeRole, serializeTeam, serializeSkill } from "../src/serializer.js";
import { parseRoleYaml, parseTeamYaml } from "../src/parser.js";
import { parseSkillMarkdown } from "../src/skill-parser.js";
import type { Role, Team } from "@maestro/core";

const implementer: Role = {
  name: "Implementer",
  instructions: "Make the requested change in this worktree.",
  engine: { id: "copilot" },
  autonomy: "auto-approve-safe",
};

const reviewer: Role = {
  name: "Reviewer",
  instructions: "Review the diff and leave comments.",
  engine: { id: "copilot", model: "gpt-4o" },
  autonomy: "manual",
};

const team: Team = {
  name: "Feature Team",
  roles: [implementer, reviewer],
};

describe("serializeRole", () => {
  it("produces YAML that round-trips back to an equivalent Role", () => {
    const yaml = serializeRole(implementer);
    const parsed = parseRoleYaml(yaml, "test");
    expect(parsed.role.ok).toBe(true);
    if (parsed.role.ok) {
      expect(parsed.role.value.name).toBe(implementer.name);
      expect(parsed.role.value.autonomy).toBe(implementer.autonomy);
      expect(parsed.role.value.engine.id).toBe(implementer.engine.id);
    }
  });

  it("includes the model field when present", () => {
    const yaml = serializeRole(reviewer);
    expect(yaml).toContain("model: gpt-4o");
    const parsed = parseRoleYaml(yaml, "test");
    expect(parsed.role.ok).toBe(true);
    if (parsed.role.ok) {
      expect(parsed.role.value.engine.model).toBe("gpt-4o");
    }
  });

  it("omits the model field when absent", () => {
    const yaml = serializeRole(implementer);
    expect(yaml).not.toContain("model:");
  });
});

describe("serializeRole skills round-trip", () => {
  it("includes skills when present and round-trips back through parseRoleYaml", () => {
    const withSkills: Role = { ...implementer, skills: ["run-tests"] };
    const yaml = serializeRole(withSkills);
    expect(yaml).toContain("skills:");
    const parsed = parseRoleYaml(yaml, "test");
    expect(parsed.role.ok).toBe(true);
    if (parsed.role.ok) {
      expect(parsed.role.value.skills).toEqual(["run-tests"]);
    }
  });

  it("omits skills when absent (existing role files unchanged)", () => {
    const yaml = serializeRole(implementer);
    expect(yaml).not.toContain("skills:");
  });
});

describe("serializeSkill", () => {
  it("round-trips name, description, allowedTools, and body through parseSkillMarkdown", () => {
    const manifest = {
      name: "run-tests",
      description: "Runs the test suite.",
      allowedTools: ["Run", "Git"],
    };
    const body = "Run all tests and report failures.";
    const md = serializeSkill(manifest, body);
    const parsed = parseSkillMarkdown(md, "test/SKILL.md");
    expect(parsed.manifest.ok).toBe(true);
    if (parsed.manifest.ok) {
      expect(parsed.manifest.value.name).toBe("run-tests");
      expect(parsed.manifest.value.description).toBe("Runs the test suite.");
      expect(parsed.manifest.value.allowedTools).toEqual(["Run", "Git"]);
    }
    expect(parsed.body).toBe(body);
  });

  it("omits allowed-tools when absent and still round-trips", () => {
    const manifest = { name: "run-tests", description: "Runs the test suite." };
    const body = "Run all tests.";
    const md = serializeSkill(manifest, body);
    const parsed = parseSkillMarkdown(md, "test/SKILL.md");
    expect(parsed.manifest.ok).toBe(true);
    if (parsed.manifest.ok) {
      expect(parsed.manifest.value.allowedTools).toBeUndefined();
    }
    expect(parsed.body).toBe(body);
  });
});

describe("serializeTeam", () => {
  it("produces YAML that round-trips back to an equivalent Team", () => {
    const yaml = serializeTeam(team);
    const knownRoles = new Map<string, Role>([
      [implementer.name, implementer],
      [reviewer.name, reviewer],
    ]);
    const parsed = parseTeamYaml(yaml, "test", knownRoles);
    expect(parsed.team.ok).toBe(true);
    if (parsed.team.ok) {
      expect(parsed.team.value.name).toBe(team.name);
      expect(parsed.team.value.roles.map((r) => r.name)).toEqual([
        implementer.name,
        reviewer.name,
      ]);
    }
  });
});
