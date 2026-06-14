import { describe, it, expect } from "vitest";
import { serializeRole, serializeTeam } from "../src/serializer.js";
import { parseRoleYaml, parseTeamYaml } from "../src/parser.js";
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
