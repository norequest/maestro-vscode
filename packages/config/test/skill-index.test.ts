import { describe, it, expect } from "vitest";
import { buildSkillIndex } from "../src/skill-index.js";
import type { Role } from "@maestro/core";
import type { SkillManifest } from "../src/skill-types.js";

function makeRole(name: string, skills?: string[]): Role {
  return {
    name,
    instructions: `${name} instructions.`,
    engine: { id: "copilot" },
    autonomy: "manual",
    ...(skills !== undefined ? { skills } : {}),
  };
}

function makeManifest(name: string): SkillManifest {
  return { name, description: `${name} description.` };
}

describe("buildSkillIndex", () => {
  it("usedBy returns the roles that reference a given skill", () => {
    const tester = makeRole("Tester", ["run-tests"]);
    const impl = makeRole("Impl", ["run-tests", "openapi"]);
    const plain = makeRole("Plain");
    const runTests = makeManifest("run-tests");
    const openapi = makeManifest("openapi");

    const index = buildSkillIndex([tester, impl, plain], [runTests, openapi]);
    const users = index.usedBy("run-tests");
    expect(users.map((r) => r.name).sort()).toEqual(["Impl", "Tester"]);
  });

  it("usedByCount returns the number of roles referencing a skill", () => {
    const tester = makeRole("Tester", ["run-tests"]);
    const impl = makeRole("Impl", ["run-tests", "openapi"]);
    const plain = makeRole("Plain");
    const runTests = makeManifest("run-tests");
    const openapi = makeManifest("openapi");

    const index = buildSkillIndex([tester, impl, plain], [runTests, openapi]);
    expect(index.usedByCount("openapi")).toBe(1);
    expect(index.usedByCount("run-tests")).toBe(2);
    expect(index.usedByCount("plain")).toBe(0);
  });

  it("an unreferenced manifest has count 0", () => {
    const role = makeRole("Solo", ["run-tests"]);
    const runTests = makeManifest("run-tests");
    const unused = makeManifest("unused-skill");

    const index = buildSkillIndex([role], [runTests, unused]);
    expect(index.usedByCount("unused-skill")).toBe(0);
    expect(index.usedBy("unused-skill")).toHaveLength(0);
  });

  it("a dangling role.skills name (no matching manifest) still shows its blast radius", () => {
    const role = makeRole("Dangler", ["ghost-skill"]);
    const index = buildSkillIndex([role], []);
    // ghost-skill has no manifest but 1 role depends on it.
    expect(index.usedByCount("ghost-skill")).toBe(1);
    expect(index.usedBy("ghost-skill").map((r) => r.name)).toEqual(["Dangler"]);
  });

  it("all() returns the complete map keyed by skill name", () => {
    const tester = makeRole("Tester", ["run-tests"]);
    const impl = makeRole("Impl", ["openapi"]);
    const runTests = makeManifest("run-tests");
    const openapi = makeManifest("openapi");

    const index = buildSkillIndex([tester, impl], [runTests, openapi]);
    const map = index.all();
    expect(map.has("run-tests")).toBe(true);
    expect(map.has("openapi")).toBe(true);
    expect(map.get("run-tests")?.map((r) => r.name)).toEqual(["Tester"]);
  });

  it("a role with no skills field does not contribute to any skill count", () => {
    const noSkillsRole = makeRole("NoSkills");
    const index = buildSkillIndex([noSkillsRole], [makeManifest("run-tests")]);
    expect(index.usedByCount("run-tests")).toBe(0);
  });

  it("handles empty roles and manifests without error", () => {
    const index = buildSkillIndex([], []);
    expect(index.usedBy("anything")).toHaveLength(0);
    expect(index.usedByCount("anything")).toBe(0);
    expect(index.all().size).toBe(0);
  });
});
