import { describe, it, expect } from "vitest";
import { serializeRole, serializeTeam, serializeSkill, serializeConfig } from "../src/serializer.js";
import { parseRoleYaml, parseTeamYaml, parseConfigYaml } from "../src/parser.js";
import { parseSkillMarkdown } from "../src/skill-parser.js";
import type { Role, Team } from "@maestro/core";
import type { MaestroConfig } from "../src/types.js";

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

describe("serializeRole tools and soul round-trip", () => {
  it("preserves read list, write list, mcp array, and soul name through serialize then parseRoleYaml", () => {
    const withTools: Role = {
      ...implementer,
      soul: "reviewer",
      tools: {
        builtins: { read: ["Read", "Search"], write: ["Git"] },
        mcp: [{ server: "sec-kit", read: true }],
      },
    };
    const yaml = serializeRole(withTools);
    const parsed = parseRoleYaml(yaml, "test");
    expect(parsed.role.ok).toBe(true);
    if (parsed.role.ok) {
      expect(parsed.role.value.soul).toBe("reviewer");
      expect(parsed.role.value.tools?.builtins?.read).toContain("Read");
      expect(parsed.role.value.tools?.builtins?.write).toContain("Git");
      expect(parsed.role.value.tools?.mcp?.[0]?.server).toBe("sec-kit");
    }
  });

  it("produces no tools: or soul: key for a bare role (byte-identical to before)", () => {
    const yaml = serializeRole(implementer);
    expect(yaml).not.toContain("tools:");
    expect(yaml).not.toContain("soul:");
  });
});

describe("serializeRole provenance round-trip (P5)", () => {
  it("round-trips provenance with sha through parseRoleYaml", () => {
    const withProv: Role = {
      ...implementer,
      provenance: { source: ".claude/agents/x.md", sha: "abc123", adoptedAt: "2026-06-17" },
    };
    const yaml = serializeRole(withProv);
    expect(yaml).toContain("provenance:");
    const parsed = parseRoleYaml(yaml, "test");
    expect(parsed.role.ok).toBe(true);
    if (parsed.role.ok) {
      expect(parsed.role.value.provenance?.source).toBe(".claude/agents/x.md");
      expect(parsed.role.value.provenance?.sha).toBe("abc123");
      expect(parsed.role.value.provenance?.adoptedAt).toBe("2026-06-17");
    }
  });

  it("round-trips provenance without sha through parseRoleYaml", () => {
    const withProv: Role = {
      ...implementer,
      provenance: { source: ".claude/agents/y.md", adoptedAt: "2026-06-17" },
    };
    const yaml = serializeRole(withProv);
    const parsed = parseRoleYaml(yaml, "test");
    expect(parsed.role.ok).toBe(true);
    if (parsed.role.ok) {
      expect(parsed.role.value.provenance?.sha).toBeUndefined();
      expect(parsed.role.value.provenance?.source).toBe(".claude/agents/y.md");
    }
  });

  it("a bare role has no provenance: key in serialized YAML", () => {
    const yaml = serializeRole(implementer);
    expect(yaml).not.toContain("provenance:");
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
  const knownRoles = new Map<string, Role>([
    [implementer.name, implementer],
    [reviewer.name, reviewer],
  ]);

  it("produces YAML that round-trips back to an equivalent Team", () => {
    const yaml = serializeTeam(team);
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

  it("includes lead when set and round-trips it through parseTeamYaml", () => {
    const withLead: Team = { ...team, lead: reviewer.name };
    const yaml = serializeTeam(withLead);
    expect(yaml).toContain(`lead: ${reviewer.name}`);
    const parsed = parseTeamYaml(yaml, "test", knownRoles);
    expect(parsed.team.ok).toBe(true);
    if (parsed.team.ok) {
      expect(parsed.team.value.lead).toBe(reviewer.name);
    }
  });

  it("omits lead when absent (existing team files unchanged)", () => {
    const yaml = serializeTeam(team);
    expect(yaml).not.toContain("lead:");
    const parsed = parseTeamYaml(yaml, "test", knownRoles);
    expect(parsed.team.ok).toBe(true);
    if (parsed.team.ok) {
      expect(parsed.team.value.lead).toBeUndefined();
    }
  });
});

describe("serializeConfig defaults round-trip", () => {
  it("round-trips a populated defaults block through parseConfigYaml (deep-equals)", () => {
    const config: MaestroConfig = {
      maxParallelAgents: 4,
      defaults: {
        instructions: "Always run the linter.",
        skills: ["run-tests"],
        leadSkills: ["task-coordination-strategies"],
      },
    };
    const yaml = serializeConfig(config);
    expect(yaml).toContain("defaults:");
    const parsed = parseConfigYaml(yaml, "test");
    expect(parsed.config.ok).toBe(true);
    if (parsed.config.ok) {
      expect(parsed.config.value).toEqual(config);
    }
  });

  it("round-trips an empty-string instructions and empty skills array", () => {
    const config: MaestroConfig = {
      maxParallelAgents: 3,
      defaults: { instructions: "", skills: [], leadSkills: ["task-coordination-strategies"] },
    };
    const yaml = serializeConfig(config);
    const parsed = parseConfigYaml(yaml, "test");
    expect(parsed.config.ok).toBe(true);
    if (parsed.config.ok) {
      expect(parsed.config.value).toEqual(config);
    }
  });

  it("omits the defaults block when absent (existing config files unchanged)", () => {
    const yaml = serializeConfig({ maxParallelAgents: 3 });
    expect(yaml).not.toContain("defaults:");
    const parsed = parseConfigYaml(yaml, "test");
    expect(parsed.config.ok).toBe(true);
    if (parsed.config.ok) {
      expect(parsed.config.value.defaults).toBeUndefined();
    }
  });
});
