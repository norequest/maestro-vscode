import { describe, it, expect } from "vitest";
import { loadConductorDir, DEFAULT_CONFIG, type FsReader } from "../src/loader.js";

function makeFakeFs(files: Record<string, string>): FsReader {
  return {
    async readFile(p: string): Promise<string> {
      const content = files[p];
      if (content === undefined) throw new Error(`File not found: ${p}`);
      return content;
    },
    async listFiles(dir: string, ext: string): Promise<string[]> {
      return Object.keys(files)
        .filter((p) => p.startsWith(dir + "/") && p.endsWith(ext))
        .map((p) => p.slice(dir.length + 1))
        .sort();
    },
    async listDirs(dir: string): Promise<string[]> {
      const result = new Set<string>();
      for (const p of Object.keys(files)) {
        if (p.startsWith(dir + "/")) {
          const rest = p.slice(dir.length + 1);
          const slash = rest.indexOf("/");
          if (slash !== -1) {
            result.add(rest.slice(0, slash));
          }
        }
      }
      return [...result].sort();
    },
    async exists(p: string): Promise<boolean> {
      if (Object.keys(files).some((f) => f === p || f.startsWith(p + "/"))) {
        return true;
      }
      return false;
    },
  };
}

const ROOT = "/repo";
const ROLES_DIR = `${ROOT}/.conductor/roles`;
const TEAMS_DIR = `${ROOT}/.conductor/teams`;
const CONFIG_PATH = `${ROOT}/.conductor/config.yaml`;

const IMPLEMENTER_YAML = `
name: Implementer
instructions: Make the requested change.
engine:
  id: copilot
autonomy: auto-approve-safe
`.trim();

const TEAM_YAML = `
name: Feature Team
roles:
  - Implementer
`.trim();

const CONFIG_YAML = `
maxParallelAgents: 5
`.trim();

describe("loadConductorDir", () => {
  it("returns defaults when .conductor/ does not exist", async () => {
    const fs = makeFakeFs({});
    const result = await loadConductorDir(ROOT, fs);
    expect(result.roles).toHaveLength(0);
    expect(result.teams).toHaveLength(0);
    expect(result.config).toEqual(DEFAULT_CONFIG);
    expect(result.errors).toHaveLength(0);
  });

  it("loads a valid role file", async () => {
    const fs = makeFakeFs({
      [`${ROLES_DIR}/implementer.yaml`]: IMPLEMENTER_YAML,
      [`${ROOT}/.conductor`]: "",
    });
    const result = await loadConductorDir(ROOT, fs);
    expect(result.roles).toHaveLength(1);
    expect(result.roles[0]?.name).toBe("Implementer");
    expect(result.errors).toHaveLength(0);
  });

  it("loads a valid team file after roles", async () => {
    const fs = makeFakeFs({
      [`${ROLES_DIR}/implementer.yaml`]: IMPLEMENTER_YAML,
      [`${TEAMS_DIR}/feature.yaml`]: TEAM_YAML,
      [`${ROOT}/.conductor`]: "",
    });
    const result = await loadConductorDir(ROOT, fs);
    expect(result.teams).toHaveLength(1);
    expect(result.teams[0]?.name).toBe("Feature Team");
    expect(result.teams[0]?.roles).toHaveLength(1);
  });

  it("loads orchestrator config", async () => {
    const fs = makeFakeFs({
      [`${CONFIG_PATH}`]: CONFIG_YAML,
      [`${ROOT}/.conductor`]: "",
    });
    const result = await loadConductorDir(ROOT, fs);
    expect(result.config.maxParallelAgents).toBe(5);
  });

  it("loads a config defaults block onto config.defaults", async () => {
    const configWithDefaults = `
maxParallelAgents: 3
defaults:
  instructions: Standing rule.
  skills: []
  leadSkills:
    - task-coordination-strategies
`.trim();
    const fs = makeFakeFs({
      [`${CONFIG_PATH}`]: configWithDefaults,
      [`${ROOT}/.conductor`]: "",
    });
    const result = await loadConductorDir(ROOT, fs);
    expect(result.config.defaults).toEqual({
      instructions: "Standing rule.",
      skills: [],
      leadSkills: ["task-coordination-strategies"],
    });
  });

  it("warns when a default skill name does not resolve against loaded skills", async () => {
    const configWithDefaults = `
maxParallelAgents: 3
defaults:
  leadSkills:
    - ghost-skill
`.trim();
    const fs = makeFakeFs({
      [`${CONFIG_PATH}`]: configWithDefaults,
      [`${ROOT}/.conductor`]: "",
    });
    const result = await loadConductorDir(ROOT, fs);
    const allWarnings = result.warnings.flatMap((w) => w.warnings);
    expect(allWarnings.some((w) => w.field === "defaults.leadSkills" && w.message.includes("ghost-skill"))).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("does not warn when a default skill name resolves to a loaded skill", async () => {
    const configWithDefaults = `
maxParallelAgents: 3
defaults:
  leadSkills:
    - task-coordination-strategies
`.trim();
    const skillMd = `---
name: task-coordination-strategies
description: How to delegate.
---
Body.
`;
    const fs = makeFakeFs({
      [`${CONFIG_PATH}`]: configWithDefaults,
      [`${ROOT}/.conductor/skills/task-coordination-strategies/SKILL.md`]: skillMd,
      [`${ROOT}/.conductor`]: "",
    });
    const result = await loadConductorDir(ROOT, fs);
    const skillWarnings = result.warnings
      .flatMap((w) => w.warnings)
      .filter((w) => w.field === "defaults.skills" || w.field === "defaults.leadSkills");
    expect(skillWarnings).toHaveLength(0);
  });

  it("collects errors on invalid YAML without throwing", async () => {
    const fs = makeFakeFs({
      [`${ROLES_DIR}/broken.yaml`]: "name: [unclosed",
      [`${ROOT}/.conductor`]: "",
    });
    const result = await loadConductorDir(ROOT, fs);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.source).toContain("broken.yaml");
    expect(result.roles).toHaveLength(0);
  });

  it("collects errors on structurally invalid role without throwing", async () => {
    const fs = makeFakeFs({
      [`${ROLES_DIR}/bad-role.yaml`]: "instructions: no name\nengine:\n  id: copilot\nautonomomy: manual",
      [`${ROOT}/.conductor`]: "",
    });
    const result = await loadConductorDir(ROOT, fs);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.roles).toHaveLength(0);
  });

  it("resolves soul when souls/reviewer.md is present and emits no soul-related warning", async () => {
    const roleWithSoulYaml = `
name: Reviewer
instructions: Review the diff.
engine:
  id: copilot
autonomy: manual
soul: reviewer
`.trim();

    const fs = makeFakeFs({
      [`${ROLES_DIR}/reviewer.yaml`]: roleWithSoulYaml,
      [`${ROOT}/.conductor/souls/reviewer.md`]: "## Identity\nI am a reviewer.\n",
      [`${ROOT}/.conductor`]: "",
    });
    const result = await loadConductorDir(ROOT, fs);
    expect(result.roles).toHaveLength(1);
    // No soul-related warning when file is present
    const soulWarnings = result.warnings.flatMap((w) => w.warnings).filter((w) => w.field === "soul");
    expect(soulWarnings).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  it("warns (not errors) when soul file is referenced but missing, and still loads the role", async () => {
    const roleWithSoulYaml = `
name: Reviewer
instructions: Review the diff.
engine:
  id: copilot
autonomy: manual
soul: missing-soul
`.trim();

    const fs = makeFakeFs({
      [`${ROLES_DIR}/reviewer.yaml`]: roleWithSoulYaml,
      [`${ROOT}/.conductor`]: "",
    });
    const result = await loadConductorDir(ROOT, fs);
    // The role should still be loaded
    expect(result.roles).toHaveLength(1);
    // A warning about the missing soul should exist
    const allWarnings = result.warnings.flatMap((w) => w.warnings);
    expect(allWarnings.some((w) => w.field === "soul")).toBe(true);
    // No hard errors
    expect(result.errors).toHaveLength(0);
  });

  it("collects multiple role files in alphabetical order", async () => {
    const reviewerYaml = `
name: Reviewer
instructions: Review the diff.
engine:
  id: copilot
autonomy: manual
`.trim();

    const fs = makeFakeFs({
      [`${ROLES_DIR}/implementer.yaml`]: IMPLEMENTER_YAML,
      [`${ROLES_DIR}/reviewer.yaml`]: reviewerYaml,
      [`${ROOT}/.conductor`]: "",
    });
    const result = await loadConductorDir(ROOT, fs);
    expect(result.roles).toHaveLength(2);
    expect(result.roles.map((r) => r.name)).toContain("Implementer");
    expect(result.roles.map((r) => r.name)).toContain("Reviewer");
  });
});
