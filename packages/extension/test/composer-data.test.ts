import { describe, expect, it } from "vitest";
import type { FsReader } from "@maestro/config";
import { loadComposerData, isKnownEngineId } from "../src/composer-data.js";

// Mirrors the makeFakeFs pattern used in @maestro/config/test/loader.test.ts.
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

const IMPLEMENTER_YAML = `
name: Implementer
instructions: Make the requested change.
engine:
  id: copilot
autonomy: auto-approve-safe
`.trim();

const TEAM_YAML = `
name: Alpha Team
roles:
  - Implementer
`.trim();

// A structurally invalid role (missing name field).
const BAD_ROLE_YAML = `
instructions: no name here
engine:
  id: copilot
autonomy: manual
`.trim();

describe("loadComposerData", () => {
  it("maps loaded roles and teams through", async () => {
    const fs = makeFakeFs({
      [`${ROOT}/.conductor`]: "",
      [`${ROLES_DIR}/implementer.yaml`]: IMPLEMENTER_YAML,
      [`${TEAMS_DIR}/alpha.yaml`]: TEAM_YAML,
    });
    const data = await loadComposerData(ROOT, fs);
    expect(data.roles.map((r) => r.name)).toContain("Implementer");
    expect(data.teams.length).toBe(1);
    expect(data.errors).toEqual([]);
  });

  it("returns empty roles/teams with no errors when .conductor/ does not exist", async () => {
    const fs = makeFakeFs({});
    const data = await loadComposerData(ROOT, fs);
    expect(data.roles).toHaveLength(0);
    expect(data.teams).toHaveLength(0);
    expect(data.errors).toEqual([]);
  });

  it("surfaces config errors for a structurally invalid role", async () => {
    const fs = makeFakeFs({
      [`${ROOT}/.conductor`]: "",
      [`${ROLES_DIR}/bad-role.yaml`]: BAD_ROLE_YAML,
    });
    const data = await loadComposerData(ROOT, fs);
    expect(data.errors.length).toBeGreaterThan(0);
  });
});

describe("isKnownEngineId", () => {
  it("returns true for known engine ids", () => {
    expect(isKnownEngineId("copilot")).toBe(true);
    expect(isKnownEngineId("acp")).toBe(true);
  });

  it("returns false for unknown engine ids", () => {
    expect(isKnownEngineId("evil")).toBe(false);
    expect(isKnownEngineId("gpt4")).toBe(false);
    expect(isKnownEngineId("")).toBe(false);
  });
});
