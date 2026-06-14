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

  it("warns on an unknown engine id (does not hard-fail)", () => {
    const result = validateRole({ ...validRoleRaw, engine: { id: "made-up-engine" } });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]?.message).toContain("made-up-engine");
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
});
