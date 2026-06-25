import { describe, it, expect } from "vitest";
import { parseRoleYaml, parseTeamYaml, parseConfigYaml } from "../src/parser.js";
import type { Role } from "@maestro/core";

const VALID_ROLE_YAML = `
name: Implementer
instructions: Make the requested change in this worktree.
engine:
  id: copilot
autonomy: auto-approve-safe
`;

const VALID_TEAM_YAML = `
name: Feature Team
roles:
  - Implementer
`;

const VALID_CONFIG_YAML = `
maxParallelAgents: 4
`;

const MISSING_FIELD_YAML = `
instructions: Something
engine:
  id: copilot
autonomy: manual
`;

const UNKNOWN_ENGINE_YAML = `
name: Made-up Reviewer
instructions: Review via a made-up engine.
engine:
  id: made-up-engine
autonomy: manual
`;

const BAD_YAML = `
name: [unclosed bracket
`;

describe("parseRoleYaml", () => {
  it("parses a valid role YAML string", () => {
    const result = parseRoleYaml(VALID_ROLE_YAML, "roles/implementer.yaml");
    expect(result.role.ok).toBe(true);
    if (result.role.ok) {
      expect(result.role.value.name).toBe("Implementer");
      expect(result.role.value.autonomy).toBe("auto-approve-safe");
    }
  });

  it("returns errors for missing name field", () => {
    const result = parseRoleYaml(MISSING_FIELD_YAML, "roles/bad.yaml");
    expect(result.role.ok).toBe(false);
    if (!result.role.ok) {
      expect(result.role.errors.some((e) => e.includes("name"))).toBe(true);
    }
  });

  it("returns an error for an unknown engine id (Issue 28: unknown engine is rejected)", () => {
    const result = parseRoleYaml(UNKNOWN_ENGINE_YAML, "roles/made-up-reviewer.yaml");
    expect(result.role.ok).toBe(false);
    if (!result.role.ok) {
      expect(result.role.errors.some((e) => e.includes("engine.id"))).toBe(true);
      expect(result.role.errors.some((e) => e.includes("made-up-engine"))).toBe(true);
    }
  });

  it("returns a parse error for malformed YAML", () => {
    const result = parseRoleYaml(BAD_YAML, "roles/broken.yaml");
    expect(result.role.ok).toBe(false);
    if (!result.role.ok) {
      expect(result.role.errors[0]).toContain("YAML parse error");
    }
  });
});

describe("parseTeamYaml", () => {
  const knownRoles = new Map<string, Role>([
    [
      "Implementer",
      {
        name: "Implementer",
        instructions: "Make the change.",
        engine: { id: "copilot" },
        autonomy: "auto-approve-safe",
      },
    ],
  ]);

  it("parses a valid team YAML string", () => {
    const result = parseTeamYaml(VALID_TEAM_YAML, "teams/feature.yaml", knownRoles);
    expect(result.team.ok).toBe(true);
    if (result.team.ok) {
      expect(result.team.value.name).toBe("Feature Team");
      expect(result.team.value.roles).toHaveLength(1);
    }
  });

  it("warns on an unknown role reference", () => {
    const yaml = `name: Team\nroles:\n  - Reviewer\n`;
    const result = parseTeamYaml(yaml, "teams/team.yaml", knownRoles);
    expect(result.team.ok).toBe(true);
    if (result.team.ok) {
      expect(result.team.warnings.length).toBeGreaterThan(0);
    }
  });

  it("returns a parse error for malformed YAML without throwing (TG10)", () => {
    let result: ReturnType<typeof parseTeamYaml>;
    expect(() => {
      result = parseTeamYaml("{ unclosed: [bracket", "teams/broken.yaml", knownRoles);
    }).not.toThrow();
    expect(result!.team.ok).toBe(false);
    if (!result!.team.ok) {
      expect(result!.team.errors[0]).toContain("YAML parse error");
      expect(result!.team.errors[0]).toContain("teams/broken.yaml");
    }
  });

  it("rejects a non-object top-level YAML document (TG10)", () => {
    const result = parseTeamYaml("- just\n- a list\n", "teams/list.yaml", knownRoles);
    expect(result.team.ok).toBe(false);
    if (!result.team.ok) {
      expect(result.team.errors.some((e) => e.includes("team must be an object"))).toBe(true);
    }
  });
});

describe("parseConfigYaml", () => {
  it("parses a valid config YAML", () => {
    const result = parseConfigYaml(VALID_CONFIG_YAML, "config.yaml");
    expect(result.config.ok).toBe(true);
    if (result.config.ok) {
      expect(result.config.value.maxParallelAgents).toBe(4);
    }
  });

  it("defaults maxParallelAgents to 3 when not specified", () => {
    const result = parseConfigYaml("{}", "config.yaml");
    expect(result.config.ok).toBe(true);
    if (result.config.ok) {
      expect(result.config.value.maxParallelAgents).toBe(3);
    }
  });

  it("returns a parse error for malformed YAML without throwing (TG10)", () => {
    let result: ReturnType<typeof parseConfigYaml>;
    expect(() => {
      result = parseConfigYaml("{ unclosed: [bracket", "config.yaml");
    }).not.toThrow();
    expect(result!.config.ok).toBe(false);
    if (!result!.config.ok) {
      expect(result!.config.errors[0]).toContain("YAML parse error");
      expect(result!.config.errors[0]).toContain("config.yaml");
    }
  });

  it("rejects a non-object top-level YAML document (TG10)", () => {
    const result = parseConfigYaml("- just\n- a list\n", "config.yaml");
    expect(result.config.ok).toBe(false);
    if (!result.config.ok) {
      expect(result.config.errors.some((e) => e.includes("config must be an object"))).toBe(true);
    }
  });
});

describe("parseConfigYaml defaults block", () => {
  const DEFAULTS_YAML = `
maxParallelAgents: 3
defaults:
  instructions: Always run the linter.
  skills:
    - run-tests
  leadSkills:
    - task-coordination-strategies
`;

  it("parses a defaults block into instructions, skills, and leadSkills", () => {
    const result = parseConfigYaml(DEFAULTS_YAML, "config.yaml");
    expect(result.config.ok).toBe(true);
    if (result.config.ok) {
      expect(result.config.value.defaults).toEqual({
        instructions: "Always run the linter.",
        skills: ["run-tests"],
        leadSkills: ["task-coordination-strategies"],
      });
    }
  });

  it("leaves defaults undefined when the block is absent (unchanged from today)", () => {
    const result = parseConfigYaml("maxParallelAgents: 3\n", "config.yaml");
    expect(result.config.ok).toBe(true);
    if (result.config.ok) {
      expect(result.config.value.defaults).toBeUndefined();
    }
  });

  it("degrades gracefully when defaults.skills is not an array (no throw, warning emitted)", () => {
    const yaml = `
maxParallelAgents: 3
defaults:
  skills: run-tests
`;
    let result: ReturnType<typeof parseConfigYaml>;
    expect(() => {
      result = parseConfigYaml(yaml, "config.yaml");
    }).not.toThrow();
    expect(result!.config.ok).toBe(true);
    if (result!.config.ok) {
      // The malformed skills key is dropped; nothing else parsed, so defaults is undefined.
      expect(result!.config.value.defaults).toBeUndefined();
      expect(result!.config.warnings.some((w) => w.field === "defaults.skills")).toBe(true);
    }
  });

  it("skips non-string entries inside defaults.skills and warns", () => {
    const yaml = `
maxParallelAgents: 3
defaults:
  skills:
    - run-tests
    - 7
`;
    const result = parseConfigYaml(yaml, "config.yaml");
    expect(result.config.ok).toBe(true);
    if (result.config.ok) {
      expect(result.config.value.defaults?.skills).toEqual(["run-tests"]);
      expect(result.config.warnings.some((w) => w.field === "defaults.skills")).toBe(true);
    }
  });

  it("ignores a non-string defaults.instructions and warns", () => {
    const yaml = `
maxParallelAgents: 3
defaults:
  instructions: 42
`;
    const result = parseConfigYaml(yaml, "config.yaml");
    expect(result.config.ok).toBe(true);
    if (result.config.ok) {
      expect(result.config.value.defaults).toBeUndefined();
      expect(result.config.warnings.some((w) => w.field === "defaults.instructions")).toBe(true);
    }
  });

  it("warns on an unknown default skill name when a known-skill set is provided", () => {
    const yaml = `
maxParallelAgents: 3
defaults:
  skills:
    - nonexistent-skill
`;
    const result = parseConfigYaml(yaml, "config.yaml", new Set<string>(["run-tests"]));
    expect(result.config.ok).toBe(true);
    if (result.config.ok) {
      expect(
        result.config.warnings.some(
          (w) => w.field === "defaults.skills" && w.message.includes("nonexistent-skill"),
        ),
      ).toBe(true);
    }
  });
});
