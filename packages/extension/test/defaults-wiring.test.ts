import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as path from "node:path";
import { applyDefaults } from "../src/config-defaults.js";
import type { AgentDefaults } from "@maestro/core";

/**
 * extension.ts imports `vscode` at the module top level, so it cannot be imported
 * into a Vitest (node) test. We assert the wiring two ways:
 *  1. Source-text: extension.ts routes BOTH the activate-time and the per-launch
 *     defaults push through the pure `applyDefaults(orch, <config>)` seam.
 *  2. Behavioral: that seam (unit-tested directly here) calls `setDefaults` on a
 *     fake/spy orchestrator with the resolved defaults. Together these prove the
 *     orchestrator's default layer is wired from the loaded config.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const extensionSrc = readFileSync(path.join(here, "..", "src", "extension.ts"), "utf8");

describe("defaults wiring in extension.ts (source)", () => {
  it("imports applyDefaults from the pure config-defaults seam", () => {
    expect(extensionSrc).toMatch(/import\s*\{\s*applyDefaults\s*\}\s*from\s*"\.\/config-defaults\.js"/);
  });

  it("pushes defaults onto the orchestrator at activate from the resolved orchConfig", () => {
    expect(extensionSrc).toMatch(/applyDefaults\(orch,\s*orchConfig\)/);
  });

  it("refreshes defaults on the team-launch path from the freshly loaded config", () => {
    expect(extensionSrc).toMatch(/applyDefaults\(orch,\s*loaded\.config\)/);
  });

  it("scaffolds .conductor on the team-launch path so the lead's playbook lands on disk", () => {
    // launchTeamByName must best-effort scaffold before loading, so a fresh repo
    // gets config.yaml (with defaults) + the vendored coordination SKILL.md files.
    const launchStart = extensionSrc.indexOf("const launchTeamByName");
    expect(launchStart).toBeGreaterThanOrEqual(0);
    const launchEnd = extensionSrc.indexOf("// ── Discover controller", launchStart);
    const launchBody = extensionSrc.slice(launchStart, launchEnd);
    expect(launchBody).toMatch(/scaffoldIfMissing\(repoRoot,\s*fsWriter\)/);
  });

  it("imports ensureVendoredSkills from @maestro/config", () => {
    expect(extensionSrc).toMatch(/ensureVendoredSkills/);
    // It must come from the config package import line, alongside scaffoldIfMissing.
    expect(extensionSrc).toMatch(
      /import\s*\{[^}]*ensureVendoredSkills[^}]*\}\s*from\s*"@maestro\/config"/s,
    );
  });

  it("ensures the vendored skills on the team-launch path even when .conductor already exists", () => {
    // After the best-effort scaffold (which no-ops on an existing .conductor),
    // launchTeamByName must still ensure the three coordination skills land on
    // disk so the lead's playbook resolves to real SKILL.md files, not prompt text.
    const launchStart = extensionSrc.indexOf("const launchTeamByName");
    expect(launchStart).toBeGreaterThanOrEqual(0);
    const launchEnd = extensionSrc.indexOf("// ── Discover controller", launchStart);
    const launchBody = extensionSrc.slice(launchStart, launchEnd);
    expect(launchBody).toMatch(/ensureVendoredSkills\(repoRoot,\s*fsWriter\)/);
  });

  it("ensures the vendored skills at activation (setupConducting) so they appear without a launch", () => {
    // The user's workspace already has a .conductor, so scaffoldIfMissing never
    // writes the skills. setupConducting must ensure them at activation time so the
    // three coordination SKILL.md files exist on disk before any team is launched.
    const setupStart = extensionSrc.indexOf("async function setupConducting");
    expect(setupStart).toBeGreaterThanOrEqual(0);
    const setupEnd = extensionSrc.indexOf("// ── Library controller", setupStart);
    expect(setupEnd).toBeGreaterThan(setupStart);
    const setupBody = extensionSrc.slice(setupStart, setupEnd);
    expect(setupBody).toMatch(/ensureVendoredSkills\(repoRoot,\s*fsWriter\)/);
  });
});

describe("the applyDefaults seam calls setDefaults on a fake orchestrator", () => {
  /**
   * The same fake/spy orchestrator shape the wiring uses: only the setDefaults
   * seam, recording every push. Mirrors the real Orchestrator.setDefaults.
   */
  function fakeOrch() {
    const calls: AgentDefaults[] = [];
    return { calls, orch: { setDefaults: (d: AgentDefaults) => calls.push(d) } };
  }

  it("activate path: a config with no defaults pushes the fallback lead playbook", () => {
    const { calls, orch } = fakeOrch();
    // orchConfig === DEFAULT_CONFIG-shaped (no defaults) in a fresh repo.
    applyDefaults(orch, { defaults: undefined });
    expect(calls).toEqual([{
      leadSkills: ["task-coordination-strategies", "team-composition-patterns", "team-communication-protocols"],
    }]);
  });

  it("launch path: a config WITH defaults pushes those defaults verbatim", () => {
    const { calls, orch } = fakeOrch();
    const defaults: AgentDefaults = { instructions: "House.", leadSkills: ["task-coordination-strategies", "x"] };
    applyDefaults(orch, { defaults });
    expect(calls[0]).toBe(defaults);
  });
});
