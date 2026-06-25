import { describe, it, expect } from "vitest";
import { loadSkills } from "../src/skill-loader.js";
import { serializeSkill } from "../src/serializer.js";
import { TASK_COORDINATION_STRATEGIES_SKILL } from "../src/vendored-skills.js";
import type { FsReader } from "../src/loader.js";

/**
 * Extended in-memory FsReader that also supports listDirs.
 *
 * We track files AND directories so that listDirs can return the correct
 * subdir names. The makeFakeFs factory accepts both a flat file map
 * and an optional explicit directory list.
 */
function makeFakeFs(
  files: Record<string, string>,
  dirs: Record<string, string[]> = {},
): FsReader {
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
    async exists(p: string): Promise<boolean> {
      if (Object.keys(files).some((f) => f === p || f.startsWith(p + "/"))) {
        return true;
      }
      if (Object.keys(dirs).some((d) => d === p)) {
        return true;
      }
      return false;
    },
    async listDirs(dir: string): Promise<string[]> {
      // If an explicit dirs map entry exists, return it.
      if (dirs[dir] !== undefined) {
        return dirs[dir]!;
      }
      // Fall back to inferring dirs from file paths.
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
  };
}

const ROOT = "/repo";
// PRIMARY skills home: the folder VS Code and Copilot read.
const SKILLS_DIR = `${ROOT}/.github/skills`;
// LEGACY skills home: still READ for back-compat (never written anymore).
const LEGACY_SKILLS_DIR = `${ROOT}/.conductor/skills`;

const RUN_TESTS_MD = `---
name: run-tests
description: Runs the project test suite.
allowed-tools:
  - Run
  - Git
---

## Procedure

Run pnpm test and report failures.
`;

const MALFORMED_MD = `no frontmatter at all, just text`;

describe("loadSkills", () => {
  it("returns empty skills and no errors when neither skills directory exists", async () => {
    const fs = makeFakeFs({});
    const result = await loadSkills(ROOT, fs);
    expect(result.skills).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  it("loads one valid SKILL.md and returns its manifest", async () => {
    const fs = makeFakeFs({
      [`${SKILLS_DIR}/run-tests/SKILL.md`]: RUN_TESTS_MD,
    });
    const result = await loadSkills(ROOT, fs);
    expect(result.skills).toHaveLength(1);
    expect(result.skills[0]?.name).toBe("run-tests");
    expect(result.skills[0]?.allowedTools).toEqual(["Run", "Git"]);
    expect(result.errors).toHaveLength(0);
  });

  it("stores the body in the bodies map keyed by name", async () => {
    const fs = makeFakeFs({
      [`${SKILLS_DIR}/run-tests/SKILL.md`]: RUN_TESTS_MD,
    });
    const result = await loadSkills(ROOT, fs);
    expect(result.bodies.has("run-tests")).toBe(true);
    expect(result.bodies.get("run-tests")).toContain("pnpm test");
  });

  it("stores details with the verbatim raw SKILL.md text and the frontmatter description", async () => {
    const fs = makeFakeFs({
      [`${SKILLS_DIR}/run-tests/SKILL.md`]: RUN_TESTS_MD,
    });
    const result = await loadSkills(ROOT, fs);

    const detail = result.details.get("run-tests");
    expect(detail).toBeDefined();
    // raw must be the exact on-disk bytes, frontmatter and body included.
    expect(detail!.raw).toBe(RUN_TESTS_MD);
    expect(detail!.description).toBe("Runs the project test suite.");
  });

  it("round-trips a scaffolded vendored skill: details.raw equals the written file and details.description matches", async () => {
    // The scaffolder writes serializeSkill(manifest, body) to disk; load that
    // exact text back and confirm details exposes it verbatim.
    const written = serializeSkill(
      TASK_COORDINATION_STRATEGIES_SKILL.manifest,
      TASK_COORDINATION_STRATEGIES_SKILL.body,
    );
    const fs = makeFakeFs({
      [`${SKILLS_DIR}/task-coordination-strategies/SKILL.md`]: written,
    });
    const result = await loadSkills(ROOT, fs);

    const detail = result.details.get("task-coordination-strategies");
    expect(detail).toBeDefined();
    expect(detail!.raw).toBe(written);
    expect(detail!.description).toBe(TASK_COORDINATION_STRATEGIES_SKILL.manifest.description);
  });

  it("keys details the same as bodies (only successfully parsed skills appear)", async () => {
    const fs = makeFakeFs({
      [`${SKILLS_DIR}/run-tests/SKILL.md`]: RUN_TESTS_MD,
      [`${SKILLS_DIR}/bad-skill/SKILL.md`]: MALFORMED_MD,
    });
    const result = await loadSkills(ROOT, fs);

    expect([...result.details.keys()].sort()).toEqual([...result.bodies.keys()].sort());
    expect(result.details.has("run-tests")).toBe(true);
    expect(result.details.has("bad-skill")).toBe(false);
  });

  it("collects an error for a malformed SKILL.md and does not throw", async () => {
    const fs = makeFakeFs({
      [`${SKILLS_DIR}/bad-skill/SKILL.md`]: MALFORMED_MD,
    });
    const result = await loadSkills(ROOT, fs);
    expect(result.skills).toHaveLength(0);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("loads multiple valid skills from separate subdirs", async () => {
    const openapi_md = `---
name: openapi
description: Generates an OpenAPI spec.
---

Generate the spec.
`;
    const fs = makeFakeFs({
      [`${SKILLS_DIR}/run-tests/SKILL.md`]: RUN_TESTS_MD,
      [`${SKILLS_DIR}/openapi/SKILL.md`]: openapi_md,
    });
    const result = await loadSkills(ROOT, fs);
    expect(result.skills).toHaveLength(2);
    const names = result.skills.map((s) => s.name).sort();
    expect(names).toEqual(["openapi", "run-tests"]);
  });

  it("collects errors from a bad skill but still loads valid sibling skills", async () => {
    const openapi_md = `---
name: openapi
description: Generates an OpenAPI spec.
---

Generate the spec.
`;
    const fs = makeFakeFs({
      [`${SKILLS_DIR}/run-tests/SKILL.md`]: RUN_TESTS_MD,
      [`${SKILLS_DIR}/bad-skill/SKILL.md`]: MALFORMED_MD,
      [`${SKILLS_DIR}/openapi/SKILL.md`]: openapi_md,
    });
    const result = await loadSkills(ROOT, fs);
    expect(result.skills).toHaveLength(2);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("reads a skill placed in the primary .github/skills home", async () => {
    const fs = makeFakeFs({
      [`${SKILLS_DIR}/run-tests/SKILL.md`]: RUN_TESTS_MD,
    });
    const result = await loadSkills(ROOT, fs);
    expect(result.skills.map((s) => s.name)).toEqual(["run-tests"]);
    expect(result.errors).toHaveLength(0);
  });

  it("reads a skill placed only in legacy .conductor/skills (back-compat)", async () => {
    const fs = makeFakeFs({
      [`${LEGACY_SKILLS_DIR}/legacy-only/SKILL.md`]: `---
name: legacy-only
description: Lives only in the old home.
---

Legacy body.
`,
    });
    const result = await loadSkills(ROOT, fs);
    expect(result.skills.map((s) => s.name)).toEqual(["legacy-only"]);
    expect(result.bodies.get("legacy-only")).toContain("Legacy body.");
    expect(result.errors).toHaveLength(0);
  });

  it("merges skills from both homes by name", async () => {
    const openapi_md = `---
name: openapi
description: Generates an OpenAPI spec.
---

Generate the spec.
`;
    const fs = makeFakeFs({
      [`${SKILLS_DIR}/run-tests/SKILL.md`]: RUN_TESTS_MD,
      [`${LEGACY_SKILLS_DIR}/openapi/SKILL.md`]: openapi_md,
    });
    const result = await loadSkills(ROOT, fs);
    expect(result.skills.map((s) => s.name).sort()).toEqual(["openapi", "run-tests"]);
    expect(result.errors).toHaveLength(0);
  });

  it("when the SAME name exists in both homes, the .github version wins", async () => {
    const githubVersion = `---
name: shared
description: GitHub home wins.
allowed-tools:
  - Run
---

GITHUB BODY
`;
    const legacyVersion = `---
name: shared
description: Conductor home loses.
allowed-tools:
  - Git
---

LEGACY BODY
`;
    const fs = makeFakeFs({
      [`${SKILLS_DIR}/shared/SKILL.md`]: githubVersion,
      [`${LEGACY_SKILLS_DIR}/shared/SKILL.md`]: legacyVersion,
    });
    const result = await loadSkills(ROOT, fs);

    // Exactly one "shared" skill survives, and it is the .github one.
    expect(result.skills.filter((s) => s.name === "shared")).toHaveLength(1);
    const shared = result.skills.find((s) => s.name === "shared");
    expect(shared?.description).toBe("GitHub home wins.");
    expect(shared?.allowedTools).toEqual(["Run"]);
    expect(result.bodies.get("shared")).toContain("GITHUB BODY");
    expect(result.bodies.get("shared")).not.toContain("LEGACY BODY");
    const detail = result.details.get("shared");
    expect(detail?.description).toBe("GitHub home wins.");
    expect(detail?.raw).toBe(githubVersion);
  });

  it("accumulates warnings and errors from both homes", async () => {
    const fs = makeFakeFs({
      [`${SKILLS_DIR}/good/SKILL.md`]: RUN_TESTS_MD.replace("name: run-tests", "name: good"),
      [`${SKILLS_DIR}/bad-github/SKILL.md`]: MALFORMED_MD,
      [`${LEGACY_SKILLS_DIR}/bad-legacy/SKILL.md`]: MALFORMED_MD,
    });
    const result = await loadSkills(ROOT, fs);
    expect(result.skills.map((s) => s.name)).toEqual(["good"]);
    // One error from each home.
    expect(result.errors.length).toBe(2);
    const sources = result.errors.map((e) => e.source);
    expect(sources.some((s) => s.includes(".github/skills/bad-github"))).toBe(true);
    expect(sources.some((s) => s.includes(".conductor/skills/bad-legacy"))).toBe(true);
  });
});
