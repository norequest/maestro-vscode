import { describe, it, expect } from "vitest";
import { validateRole, validateTeam, validateOrchestratorConfig } from "../src/validator.js";
import type { Role } from "@maestro/core";

const validRoleRaw = {
  name: "Implementer",
  instructions: "Make the change.",
  engine: { id: "copilot" },
  autonomy: "auto-approve-safe",
};

describe("validateRole", () => {
  it("accepts a valid role", () => {
    const result = validateRole(validRoleRaw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.name).toBe("Implementer");
      expect(result.warnings).toHaveLength(0);
    }
  });

  it("accepts a role with an optional model field", () => {
    const result = validateRole({ ...validRoleRaw, engine: { id: "copilot", model: "gpt-4o" } });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.engine.model).toBe("gpt-4o");
    }
  });

  it("errors on an unknown engine id (Issue 28: unknown engine is rejected, not warned)", () => {
    const result = validateRole({ ...validRoleRaw, engine: { id: "totally-unknown" } });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("engine.id"))).toBe(true);
      expect(result.errors.some((e) => e.includes("totally-unknown"))).toBe(true);
    }
  });

  it("accepts the known engine ids copilot and acp", () => {
    const copilot = validateRole({ ...validRoleRaw, engine: { id: "copilot" } });
    expect(copilot.ok).toBe(true);
    const acp = validateRole({ ...validRoleRaw, engine: { id: "acp" } });
    expect(acp.ok).toBe(true);
  });

  it("accepts a well-formed model value (Issue 29)", () => {
    const result = validateRole({ ...validRoleRaw, engine: { id: "copilot", model: "gpt-4" } });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.engine.model).toBe("gpt-4");
    }
  });

  it("errors on a model containing a space (Issue 29)", () => {
    const result = validateRole({ ...validRoleRaw, engine: { id: "copilot", model: "gpt 4" } });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("model"))).toBe(true);
    }
  });

  it("errors on a model that starts with a dash (Issue 29: argument-injection guard)", () => {
    const result = validateRole({ ...validRoleRaw, engine: { id: "copilot", model: "--evil" } });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("model"))).toBe(true);
    }
  });

  it("accepts a non-ASCII role.name (Issue 29: Georgian names are allowed)", () => {
    const result = validateRole({ ...validRoleRaw, name: "Georgian რედაქტორი" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.name).toBe("Georgian რედაქტორი");
    }
  });

  it("errors on a role.name that starts with a dash (Issue 29: argument-injection guard)", () => {
    const result = validateRole({ ...validRoleRaw, name: "-rf" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("name"))).toBe(true);
    }
  });

  it("errors on a role.name containing a control character (Issue 29)", () => {
    const result = validateRole({ ...validRoleRaw, name: "evil\x00name" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("name"))).toBe(true);
    }
  });

  it("errors on missing name", () => {
    const result = validateRole({ ...validRoleRaw, name: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("name"))).toBe(true);
    }
  });

  it("errors on missing instructions", () => {
    const result = validateRole({ ...validRoleRaw, instructions: "" });
    expect(result.ok).toBe(false);
  });

  it("errors on invalid autonomy", () => {
    const result = validateRole({ ...validRoleRaw, autonomy: "full-auto" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("autonomy"))).toBe(true);
    }
  });

  it("errors when engine is missing", () => {
    const { engine: _e, ...rest } = validRoleRaw;
    const result = validateRole(rest);
    expect(result.ok).toBe(false);
  });

  it("errors on non-object input", () => {
    const result = validateRole("not an object");
    expect(result.ok).toBe(false);
  });
});

describe("validateTeam", () => {
  const implementerRole: Role = {
    name: "Implementer",
    instructions: "Make the change.",
    engine: { id: "copilot" },
    autonomy: "auto-approve-safe",
  };
  const knownRoles = new Map<string, Role>([["Implementer", implementerRole]]);

  it("accepts a valid team", () => {
    const result = validateTeam({ name: "Feature Team", roles: ["Implementer"] }, knownRoles);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.roles).toHaveLength(1);
    }
  });

  it("warns when a referenced role is not yet loaded", () => {
    const result = validateTeam({ name: "Team", roles: ["Reviewer"] }, knownRoles);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warnings.length).toBeGreaterThan(0);
    }
  });

  it("errors when roles is not an array", () => {
    const result = validateTeam({ name: "Team", roles: "Implementer" }, knownRoles);
    expect(result.ok).toBe(false);
  });

  it("accepts a valid lead that names one of the team's roles", () => {
    const result = validateTeam(
      { name: "Feature Team", roles: ["Implementer"], lead: "Implementer" },
      knownRoles,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.lead).toBe("Implementer");
    }
  });

  it("accepts a lead naming a declared role that is not yet loaded", () => {
    // lead matches the raw roles array, not the loaded knownRoles map.
    const result = validateTeam(
      { name: "Team", roles: ["Reviewer"], lead: "Reviewer" },
      knownRoles,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.lead).toBe("Reviewer");
    }
  });

  it("leaves lead undefined when absent (regression: existing behavior unchanged)", () => {
    const result = validateTeam({ name: "Feature Team", roles: ["Implementer"] }, knownRoles);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.lead).toBeUndefined();
      expect(result.warnings).toHaveLength(0);
    }
  });

  it("errors when lead names a role not in the team", () => {
    const result = validateTeam(
      { name: "Feature Team", roles: ["Implementer"], lead: "Reviewer" },
      knownRoles,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("lead") && e.includes("Reviewer"))).toBe(true);
    }
  });

  it("errors when lead is not a string", () => {
    const result = validateTeam(
      { name: "Feature Team", roles: ["Implementer"], lead: 1 },
      knownRoles,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("lead"))).toBe(true);
    }
  });
});

describe("validateRole skills field", () => {
  it("carries a well-formed skills array onto value.skills", () => {
    const result = validateRole({ ...validRoleRaw, skills: ["run-tests", "openapi"] });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.skills).toEqual(["run-tests", "openapi"]);
    }
  });

  it("leaves value.skills undefined when skills is absent", () => {
    const result = validateRole(validRoleRaw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.skills).toBeUndefined();
    }
  });

  it("errors when skills is a string (not an array)", () => {
    const result = validateRole({ ...validRoleRaw, skills: "run-tests" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("skills"))).toBe(true);
    }
  });

  it("errors when skills is an array with non-string entries", () => {
    const result = validateRole({ ...validRoleRaw, skills: [1, 2] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("skills"))).toBe(true);
    }
  });

  it("unknown engine id is still a hard error (regression guard for engine-id path)", () => {
    const result = validateRole({ ...validRoleRaw, skills: ["run-tests"], engine: { id: "totally-unknown" } });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("engine.id"))).toBe(true);
    }
  });
});

describe("validateRole tools and soul fields", () => {
  it("accepts a tools grant with only a read list (no write block means read-only)", () => {
    const result = validateRole({
      ...validRoleRaw,
      tools: { builtins: { read: ["Read", "Search"] } },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      // write must be absent or empty when not specified
      const writeList = result.value.tools?.builtins?.write ?? [];
      expect(writeList).toHaveLength(0);
    }
  });

  it("errors when tools.builtins.write contains an unknown tool name", () => {
    const result = validateRole({
      ...validRoleRaw,
      tools: { builtins: { write: ["Deploy"] } },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.toLowerCase().includes("deploy") || e.includes("tool"))).toBe(true);
    }
  });

  it("accepts an optional soul: name without resolving it (loader resolves later)", () => {
    const result = validateRole({ ...validRoleRaw, soul: "reviewer" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.soul).toBe("reviewer");
    }
  });

  it("omits tools from value when tools is absent (omit-when-absent)", () => {
    const result = validateRole(validRoleRaw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.tools).toBeUndefined();
    }
  });

  it("omits soul from value when soul is absent", () => {
    const result = validateRole(validRoleRaw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.soul).toBeUndefined();
    }
  });

  it("does NOT error on unknown soul name (that is a loader warning, not validator error)", () => {
    const result = validateRole({ ...validRoleRaw, soul: "nonexistent-soul" });
    expect(result.ok).toBe(true);
  });

  it("engine-id hard ERROR path is untouched (regression guard)", () => {
    const result = validateRole({ ...validRoleRaw, soul: "reviewer", tools: { builtins: { read: ["Read"] } }, engine: { id: "totally-unknown" } });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes("engine.id"))).toBe(true);
    }
  });
});

describe("validateOrchestratorConfig", () => {
  it("accepts an empty object and defaults maxParallelAgents to 3", () => {
    const result = validateOrchestratorConfig({});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.maxParallelAgents).toBe(3);
    }
  });

  it("accepts a valid config", () => {
    const result = validateOrchestratorConfig({ maxParallelAgents: 5 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.maxParallelAgents).toBe(5);
    }
  });

  it("errors on non-integer maxParallelAgents", () => {
    const result = validateOrchestratorConfig({ maxParallelAgents: 0 });
    expect(result.ok).toBe(false);
  });

  it("leaves defaults undefined when the block is absent (back-compat)", () => {
    const result = validateOrchestratorConfig({ maxParallelAgents: 3 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.defaults).toBeUndefined();
    }
  });

  it("carries a well-formed defaults block onto value.defaults", () => {
    const result = validateOrchestratorConfig({
      maxParallelAgents: 3,
      defaults: {
        instructions: "Standing rule.",
        skills: ["run-tests"],
        leadSkills: ["task-coordination-strategies"],
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.defaults).toEqual({
        instructions: "Standing rule.",
        skills: ["run-tests"],
        leadSkills: ["task-coordination-strategies"],
      });
    }
  });

  it("does not throw on a malformed defaults block and warns instead", () => {
    let result: ReturnType<typeof validateOrchestratorConfig>;
    expect(() => {
      result = validateOrchestratorConfig({ maxParallelAgents: 3, defaults: "not an object" });
    }).not.toThrow();
    expect(result!.ok).toBe(true);
    if (result!.ok) {
      expect(result!.value.defaults).toBeUndefined();
      expect(result!.warnings.some((w) => w.field === "defaults")).toBe(true);
    }
  });
});

describe("validateOrchestratorConfig default-skill warnings", () => {
  it("warns when a default skill name is not in the known-skills set", () => {
    const result = validateOrchestratorConfig(
      { maxParallelAgents: 3, defaults: { skills: ["ghost-skill"] } },
      new Set<string>(["run-tests"]),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(
        result.warnings.some((w) => w.field === "defaults.skills" && w.message.includes("ghost-skill")),
      ).toBe(true);
    }
  });

  it("warns when a default LEAD skill name is not in the known-skills set", () => {
    const result = validateOrchestratorConfig(
      { maxParallelAgents: 3, defaults: { leadSkills: ["ghost-lead-skill"] } },
      new Set<string>(["task-coordination-strategies"]),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(
        result.warnings.some(
          (w) => w.field === "defaults.leadSkills" && w.message.includes("ghost-lead-skill"),
        ),
      ).toBe(true);
    }
  });

  it("does NOT warn when every default skill name resolves", () => {
    const result = validateOrchestratorConfig(
      {
        maxParallelAgents: 3,
        defaults: { skills: ["run-tests"], leadSkills: ["task-coordination-strategies"] },
      },
      new Set<string>(["run-tests", "task-coordination-strategies"]),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const skillWarnings = result.warnings.filter(
        (w) => w.field === "defaults.skills" || w.field === "defaults.leadSkills",
      );
      expect(skillWarnings).toHaveLength(0);
    }
  });

  it("skips the unknown-skill check entirely when no known-skills set is provided (best-effort)", () => {
    const result = validateOrchestratorConfig({
      maxParallelAgents: 3,
      defaults: { skills: ["whatever"] },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const skillWarnings = result.warnings.filter((w) => w.field === "defaults.skills");
      expect(skillWarnings).toHaveLength(0);
    }
  });
});
