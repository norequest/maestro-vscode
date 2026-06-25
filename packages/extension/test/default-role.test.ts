import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as path from "node:path";

/**
 * CONDUCTOR_ROLE and DEFAULT_ROLE live in extension.ts, which imports `vscode` at
 * the module top level and so cannot be imported into a Vitest (node) test. We
 * assert on the source instead.
 *
 * Model: the CONDUCTOR is the single "default agent" that ALWAYS leads (over every
 * specialist for a no-team run, or a team's scoped roster for a team run). It is a
 * THIN lead persona: it must NOT hardcode the coordination skills, because the
 * playbook now rides in via the config-driven default layer (`defaults.leadSkills`,
 * with the three vendored coordination skills as the fallback for legacy dirs),
 * composed into the lead ONLY by the orchestrator. DEFAULT_ROLE is the bare
 * single-dispatch fallback ("Implementer"); it never leads, so it also must NOT
 * carry the playbook.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const extensionSrc = readFileSync(path.join(here, "..", "src", "extension.ts"), "utf8");

/** Slice the `const <name>: Role = { ... };` declaration block out of the source. */
function roleBlock(name: string): string {
  const start = extensionSrc.indexOf(`const ${name}`);
  expect(start, `${name} declaration not found`).toBeGreaterThanOrEqual(0);
  const end = extensionSrc.indexOf("};", start);
  expect(end, `${name} closing brace not found`).toBeGreaterThan(start);
  return extensionSrc.slice(start, end);
}

describe("CONDUCTOR_ROLE", () => {
  it("does NOT hardcode the coordination skills (they now come from config defaults.leadSkills)", () => {
    expect(roleBlock("CONDUCTOR_ROLE")).not.toMatch(/skills:\s*\[\s*"task-coordination-strategies"/);
    expect(roleBlock("CONDUCTOR_ROLE")).not.toMatch(/delegation-playbook/);
  });
});

describe("DEFAULT_ROLE", () => {
  it("does NOT declare the coordination skills (it never leads)", () => {
    expect(roleBlock("DEFAULT_ROLE")).not.toMatch(/skills:\s*\[\s*"task-coordination-strategies"/);
    expect(roleBlock("DEFAULT_ROLE")).not.toMatch(/delegation-playbook/);
  });
});
