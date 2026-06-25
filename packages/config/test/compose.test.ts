import { describe, it, expect } from "vitest";
import { composeSkillPreamble, composeSpawnDescription } from "../src/compose.js";
import type { Role } from "@maestro/core";

function makeRole(name: string, skills?: string[]): Role {
  return {
    name,
    instructions: `${name} instructions.`,
    engine: { id: "copilot" },
    autonomy: "manual",
    ...(skills !== undefined ? { skills } : {}),
  };
}

const BODIES = new Map<string, string>([
  ["run-tests", "Run pnpm test in the repo root.\nReport failing test names."],
  ["openapi", "Generate the OpenAPI spec from the route types."],
]);

describe("composeSkillPreamble", () => {
  it("returns empty string when role has no skills", () => {
    const role = makeRole("Plain");
    expect(composeSkillPreamble(role, BODIES)).toBe("");
  });

  it("returns empty string when role.skills is an empty array", () => {
    const role = makeRole("Empty", []);
    expect(composeSkillPreamble(role, BODIES)).toBe("");
  });

  it("inlines a single skill body under the ## Skills header", () => {
    const role = makeRole("Tester", ["run-tests"]);
    const preamble = composeSkillPreamble(role, BODIES);
    expect(preamble).toContain("## Skills");
    expect(preamble).toContain("### run-tests");
    expect(preamble).toContain("Run pnpm test");
  });

  it("inlines multiple skill bodies in role.skills order", () => {
    const role = makeRole("Full", ["run-tests", "openapi"]);
    const preamble = composeSkillPreamble(role, BODIES);
    const runIdx = preamble.indexOf("### run-tests");
    const oaIdx = preamble.indexOf("### openapi");
    expect(runIdx).toBeLessThan(oaIdx);
    expect(preamble).toContain("Run pnpm test");
    expect(preamble).toContain("Generate the OpenAPI spec");
  });

  it("skips dangling skill names (not in bodies map) without throwing", () => {
    const role = makeRole("Partial", ["run-tests", "ghost-skill"]);
    expect(() => composeSkillPreamble(role, BODIES)).not.toThrow();
    const preamble = composeSkillPreamble(role, BODIES);
    expect(preamble).toContain("### run-tests");
    expect(preamble).not.toContain("ghost-skill");
  });
});

describe("composeSpawnDescription", () => {
  it("returns the task unchanged when the role has no skills", () => {
    const role = makeRole("Plain");
    const task = "Implement the login feature.";
    expect(composeSpawnDescription(role, BODIES, task)).toBe(task);
  });

  it("returns the task unchanged when all skill names are dangling", () => {
    const role = makeRole("Ghost", ["ghost-skill"]);
    const task = "Do something.";
    expect(composeSpawnDescription(role, BODIES, task)).toBe(task);
  });

  it("prepends preamble and ends with the verbatim task when skills are present", () => {
    const role = makeRole("Tester", ["run-tests"]);
    const task = "Fix the failing test.";
    const result = composeSpawnDescription(role, BODIES, task);
    expect(result.endsWith(task)).toBe(true);
    expect(result).toContain("## Skills");
    expect(result).toContain("### run-tests");
  });

  it("the composed description ends with the verbatim task for multiple skills", () => {
    const role = makeRole("Full", ["run-tests", "openapi"]);
    const task = "Add the user endpoint.";
    const result = composeSpawnDescription(role, BODIES, task);
    expect(result.endsWith(task)).toBe(true);
  });
});
