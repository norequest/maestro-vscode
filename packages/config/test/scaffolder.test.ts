import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  scaffoldIfMissing,
  ensureVendoredSkills,
  STARTER_ROLE,
  makeNodeFsWriter,
  writeSkillIfMissing,
} from "../src/scaffolder.js";
import type { FsWriter } from "../src/scaffolder.js";
import { parseRoleYaml, parseConfigYaml } from "../src/parser.js";
import { parseSkillMarkdown } from "../src/skill-parser.js";
import {
  VENDORED_SKILLS,
  TASK_COORDINATION_STRATEGIES_SKILL,
  TEAM_COMPOSITION_PATTERNS_SKILL,
  TEAM_COMMUNICATION_PROTOCOLS_SKILL,
} from "../src/vendored-skills.js";

function makeFakeWriter(): { writer: FsWriter; written: Map<string, string>; dirs: Set<string> } {
  const written = new Map<string, string>();
  const dirs = new Set<string>();
  const existingDirs = new Set<string>();

  const writer: FsWriter = {
    async writeFile(p: string, content: string): Promise<void> {
      written.set(p, content);
    },
    async exists(p: string): Promise<boolean> {
      if (existingDirs.has(p)) return true;
      for (const k of written.keys()) {
        if (k === p || k.startsWith(p + "/")) return true;
      }
      return false;
    },
    async mkdir(p: string): Promise<void> {
      dirs.add(p);
    },
    async removeDir(_p: string): Promise<void> {
      // no-op in fake: scaffoldIfMissing never removes directories
    },
    async removeFile(p: string): Promise<void> {
      // Mirror the real writer: a missing file is a no-op.
      written.delete(p);
    },
  };

  return { writer, written, dirs };
}

const ROOT = "/repo";

describe("scaffoldIfMissing", () => {
  it("writes a starter implementer role and config when .conductor/ is absent", async () => {
    const { writer, written } = makeFakeWriter();
    const scaffolded = await scaffoldIfMissing(ROOT, writer);

    expect(scaffolded).toBe(true);
    expect([...written.keys()].some((k) => k.includes("roles/implementer.yaml"))).toBe(true);
    expect([...written.keys()].some((k) => k.includes("config.yaml"))).toBe(true);
  });

  it("the written role YAML parses back to STARTER_ROLE", async () => {
    const { writer, written } = makeFakeWriter();
    await scaffoldIfMissing(ROOT, writer);

    const roleEntry = [...written.entries()].find(([k]) => k.includes("implementer.yaml"));
    expect(roleEntry).toBeDefined();
    const [, yaml] = roleEntry!;
    const parsed = parseRoleYaml(yaml, "test");
    expect(parsed.role.ok).toBe(true);
    if (parsed.role.ok) {
      expect(parsed.role.value.name).toBe(STARTER_ROLE.name);
      expect(parsed.role.value.autonomy).toBe(STARTER_ROLE.autonomy);
    }
  });

  it("scaffolds a config.yaml whose leadSkills lists the three vendored skill names", async () => {
    const { writer, written } = makeFakeWriter();
    await scaffoldIfMissing(ROOT, writer);

    const configEntry = [...written.entries()].find(([k]) => k.includes("config.yaml"));
    expect(configEntry).toBeDefined();
    const [, yaml] = configEntry!;
    const parsed = parseConfigYaml(yaml, "test");
    expect(parsed.config.ok).toBe(true);
    if (parsed.config.ok) {
      expect(parsed.config.value.defaults?.leadSkills).toEqual([
        "task-coordination-strategies",
        "team-composition-patterns",
        "team-communication-protocols",
      ]);
      expect(parsed.config.value.defaults?.instructions).toBe("");
      expect(parsed.config.value.defaults?.skills).toEqual([]);
    }
  });

  it("does not overwrite an existing config.yaml on a second scaffold (idempotent)", async () => {
    const { writer, written } = makeFakeWriter();
    await scaffoldIfMissing(ROOT, writer);

    const configPath = `${ROOT}/.conductor/config.yaml`;
    written.set(configPath, "PRESEEDED CONFIG");

    // .conductor/ now exists, so a second scaffold is a whole-tree no-op.
    const scaffolded = await scaffoldIfMissing(ROOT, writer);
    expect(scaffolded).toBe(false);
    expect(written.get(configPath)).toBe("PRESEEDED CONFIG");
  });

  it("returns false and writes nothing when .conductor/ already exists", async () => {
    const { writer, written } = makeFakeWriter();
    // Pre-seed a file so .conductor/ appears to exist.
    written.set(`${ROOT}/.conductor/roles/existing.yaml`, "name: Existing\n");

    const scaffolded = await scaffoldIfMissing(ROOT, writer);
    expect(scaffolded).toBe(false);
    // No new files added.
    expect(written.size).toBe(1);
  });

  it("creates the roles and teams subdirectories under .conductor", async () => {
    const { writer, dirs } = makeFakeWriter();
    await scaffoldIfMissing(ROOT, writer);

    expect([...dirs].some((d) => d === `${ROOT}/.conductor/roles`)).toBe(true);
    expect([...dirs].some((d) => d === `${ROOT}/.conductor/teams`)).toBe(true);
  });

  it("writes roles, teams, and config under .conductor and skills under .github/skills", async () => {
    const { writer, written, dirs } = makeFakeWriter();
    await scaffoldIfMissing(ROOT, writer);

    // Roles + config stay under .conductor.
    expect(written.has(`${ROOT}/.conductor/roles/implementer.yaml`)).toBe(true);
    expect(written.has(`${ROOT}/.conductor/config.yaml`)).toBe(true);
    // Skills move to .github/skills, and NO .conductor/skills dir is created.
    expect([...written.keys()].every((k) => !k.includes("/.conductor/skills/"))).toBe(true);
    expect([...dirs].some((d) => d === `${ROOT}/.conductor/skills`)).toBe(false);
  });

  it("creates a .github/skills/run-tests/SKILL.md file", async () => {
    const { writer, written } = makeFakeWriter();
    await scaffoldIfMissing(ROOT, writer);

    expect(written.has(`${ROOT}/.github/skills/run-tests/SKILL.md`)).toBe(true);
  });

  it("the seeded run-tests SKILL.md parses back to an ok manifest", async () => {
    const { writer, written } = makeFakeWriter();
    await scaffoldIfMissing(ROOT, writer);

    const path = `${ROOT}/.github/skills/run-tests/SKILL.md`;
    const md = written.get(path);
    expect(md).toBeDefined();
    const parsed = parseSkillMarkdown(md!, ".github/skills/run-tests/SKILL.md");
    expect(parsed.manifest.ok).toBe(true);
    if (parsed.manifest.ok) {
      expect(parsed.manifest.value.name).toBe("run-tests");
    }
  });

  it("writes a SKILL.md for each of the three vendored skills under .github/skills", async () => {
    const { writer, written } = makeFakeWriter();
    await scaffoldIfMissing(ROOT, writer);

    for (const skill of VENDORED_SKILLS) {
      const expectedPath = `${ROOT}/.github/skills/${skill.manifest.name}/SKILL.md`;
      expect(written.has(expectedPath)).toBe(true);
    }
  });

  it("writes the task-coordination-strategies SKILL.md with its body content", async () => {
    const { writer, written } = makeFakeWriter();
    await scaffoldIfMissing(ROOT, writer);

    const path = `${ROOT}/.github/skills/task-coordination-strategies/SKILL.md`;
    const md = written.get(path);
    expect(md).toBeDefined();
    expect(md!).toContain("# Task Coordination Strategies");
    expect(md!).toContain("file ownership");
    expect(md!).toContain("Out of Scope");
    expect(md!).toContain("delegate");
  });

  it("each seeded vendored SKILL.md parses back to an ok manifest under its own name", async () => {
    const { writer, written } = makeFakeWriter();
    await scaffoldIfMissing(ROOT, writer);

    for (const skill of VENDORED_SKILLS) {
      const path = `${ROOT}/.github/skills/${skill.manifest.name}/SKILL.md`;
      const md = written.get(path);
      expect(md).toBeDefined();
      const parsed = parseSkillMarkdown(md!, path);
      expect(parsed.manifest.ok).toBe(true);
      if (parsed.manifest.ok) {
        expect(parsed.manifest.value.name).toBe(skill.manifest.name);
      }
    }
  });

  it("scaffolding twice does not overwrite a vendored skill (whole-tree guard)", async () => {
    const { writer, written } = makeFakeWriter();
    await scaffoldIfMissing(ROOT, writer);

    const skillPath = `${ROOT}/.github/skills/team-communication-protocols/SKILL.md`;
    written.set(skillPath, "PRESEEDED");

    // .conductor/ now exists, so a second scaffold is a no-op and the file stays.
    const scaffolded = await scaffoldIfMissing(ROOT, writer);
    expect(scaffolded).toBe(false);
    expect(written.get(skillPath)).toBe("PRESEEDED");
  });
});

describe("writeSkillIfMissing", () => {
  // writeSkillIfMissing takes a resolved skills dir; callers now pass .github/skills.
  const SKILLS_DIR = `${ROOT}/.github/skills`;

  it("writes the SKILL.md when it does not yet exist", async () => {
    const { writer, written } = makeFakeWriter();
    await writeSkillIfMissing(SKILLS_DIR, TASK_COORDINATION_STRATEGIES_SKILL, writer);

    const path = `${SKILLS_DIR}/task-coordination-strategies/SKILL.md`;
    expect(written.has(path)).toBe(true);
    expect(written.get(path)).toContain("file ownership");
  });

  it("does not overwrite an existing SKILL.md (per-skill idempotency)", async () => {
    const { writer, written } = makeFakeWriter();
    const path = `${SKILLS_DIR}/task-coordination-strategies/SKILL.md`;
    written.set(path, "PRESEEDED");

    await writeSkillIfMissing(SKILLS_DIR, TASK_COORDINATION_STRATEGIES_SKILL, writer);

    // The original content is preserved; the write was skipped.
    expect(written.get(path)).toBe("PRESEEDED");
  });
});

describe("ensureVendoredSkills", () => {
  // The backfill target is now the .github/skills home.
  const SKILLS_DIR = `${ROOT}/.github/skills`;

  it("writes all three vendored skills and returns their names when .conductor/ exists but skills/ is empty", async () => {
    const { writer, written } = makeFakeWriter();
    // Pre-seed a file so .conductor/ already exists (the scaffoldIfMissing
    // whole-tree guard would otherwise skip writing the skills).
    written.set(`${ROOT}/.conductor/config.yaml`, "maxParallelAgents: 3\n");

    const added = await ensureVendoredSkills(ROOT, writer);

    expect(added).toEqual([
      "task-coordination-strategies",
      "team-composition-patterns",
      "team-communication-protocols",
    ]);
    for (const skill of VENDORED_SKILLS) {
      const expectedPath = `${SKILLS_DIR}/${skill.manifest.name}/SKILL.md`;
      expect(written.has(expectedPath)).toBe(true);
    }
  });

  it("each written SKILL.md parses back to an ok manifest under its own name", async () => {
    const { writer, written } = makeFakeWriter();
    written.set(`${ROOT}/.conductor/config.yaml`, "maxParallelAgents: 3\n");

    await ensureVendoredSkills(ROOT, writer);

    for (const skill of VENDORED_SKILLS) {
      const path = `${SKILLS_DIR}/${skill.manifest.name}/SKILL.md`;
      const md = written.get(path);
      expect(md).toBeDefined();
      const parsed = parseSkillMarkdown(md!, path);
      expect(parsed.manifest.ok).toBe(true);
      if (parsed.manifest.ok) {
        expect(parsed.manifest.value.name).toBe(skill.manifest.name);
      }
    }
  });

  it("is idempotent: a second call writes nothing and returns []", async () => {
    const { writer, written } = makeFakeWriter();
    written.set(`${ROOT}/.conductor/config.yaml`, "maxParallelAgents: 3\n");

    const first = await ensureVendoredSkills(ROOT, writer);
    expect(first).toHaveLength(3);

    const second = await ensureVendoredSkills(ROOT, writer);
    expect(second).toEqual([]);
  });

  it("never overwrites a user-edited SKILL.md and excludes it from the returned names", async () => {
    const { writer, written } = makeFakeWriter();
    written.set(`${ROOT}/.conductor/config.yaml`, "maxParallelAgents: 3\n");

    // A user has hand-edited one of the three skills before the ensure runs.
    const editedPath = `${SKILLS_DIR}/team-composition-patterns/SKILL.md`;
    written.set(editedPath, "USER EDITED CONTENT");

    const added = await ensureVendoredSkills(ROOT, writer);

    // The edited skill is left untouched and is not in the newly-written set.
    expect(written.get(editedPath)).toBe("USER EDITED CONTENT");
    expect(added).toEqual([
      "task-coordination-strategies",
      "team-communication-protocols",
    ]);
  });

  it("creates .github/skills/ when it is missing", async () => {
    const { writer, dirs, written } = makeFakeWriter();
    // .conductor/ exists (a role file is present) but no .github/skills/ yet.
    written.set(`${ROOT}/.conductor/roles/implementer.yaml`, "name: Implementer\n");

    await ensureVendoredSkills(ROOT, writer);

    expect([...dirs].some((d) => d === SKILLS_DIR)).toBe(true);
  });
});

describe("VENDORED_SKILLS", () => {
  it("exports exactly the three skills under their upstream-traceable names", () => {
    expect(VENDORED_SKILLS).toHaveLength(3);
    expect(VENDORED_SKILLS.map((s) => s.manifest.name)).toEqual([
      "task-coordination-strategies",
      "team-composition-patterns",
      "team-communication-protocols",
    ]);
  });

  it("has no em dash character anywhere in any manifest or body", () => {
    for (const { manifest, body } of VENDORED_SKILLS) {
      const text = manifest.name + manifest.description + body;
      expect(text.includes("—")).toBe(false);
    }
  });

  it("each body begins with an H1 title and carries the Maestro provenance line", () => {
    for (const { body } of VENDORED_SKILLS) {
      expect(body.startsWith("# ")).toBe(true);
      expect(body).toContain(
        "Adapted for Maestro from wshobson/agents (MIT). Original in docs/vendor/wshobson-agents.",
      );
    }
  });

  it("strips every Claude-Code-only primitive Maestro does not have", () => {
    const forbidden = [
      "SendMessage",
      "broadcast",
      "shutdown_request",
      "TaskCreate",
      "TaskUpdate",
      "addBlockedBy",
      "blockedBy",
      "subagent_type",
      "tmux",
      "iterm2",
      "iTerm2",
      ".claude/teams",
    ];
    for (const { body } of VENDORED_SKILLS) {
      for (const term of forbidden) {
        expect(body.includes(term)).toBe(false);
      }
    }
  });

  it("task-coordination-strategies keeps the decomposition axes and the task template", () => {
    const { body } = TASK_COORDINATION_STRATEGIES_SKILL;
    expect(body).toContain("# Task Coordination Strategies");
    expect(body).toContain("file ownership");
    expect(body).toContain("By layer");
    expect(body).toContain("By component");
    expect(body).toContain("By concern");
    expect(body).toContain("Objective");
    expect(body).toContain("Owned Files");
    expect(body).toContain("Acceptance Criteria");
    expect(body).toContain("Out of Scope");
    expect(body).toContain("delegate");
  });

  it("team-composition-patterns keeps the sizing heuristics and conductor-as-coordinator framing", () => {
    const { body } = TEAM_COMPOSITION_PATTERNS_SKILL;
    expect(body).toContain("# Team Composition Patterns");
    expect(body).toContain("smallest");
    expect(body).toContain(".conductor/teams");
    expect(body).toContain(".conductor/roles");
    expect(body).toContain("conductor is ALWAYS the coordinator");
  });

  it("team-communication-protocols keeps complete-context and integration framing plus an anti-patterns table", () => {
    const { body } = TEAM_COMMUNICATION_PROTOCOLS_SKILL;
    expect(body).toContain("# Team Communication Protocols");
    expect(body).toContain("complete context");
    expect(body).toContain("Anti-patterns");
    expect(body).toContain("same worktree");
    expect(body).toContain("conductor");
  });
});

describe("makeNodeFsWriter().removeFile", () => {
  it("removes a single file inside .conductor", async () => {
    const root = await mkdtemp(join(tmpdir(), "maestro-rmfile-"));
    try {
      const dir = join(root, ".conductor", "roles");
      await mkdir(dir, { recursive: true });
      const file = join(dir, "implementer.yaml");
      await writeFile(file, "name: Implementer\n", "utf8");

      const writer = await makeNodeFsWriter();
      await writer.removeFile(file);
      await expect(readFile(file, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("is a no-op when the file is already absent", async () => {
    const root = await mkdtemp(join(tmpdir(), "maestro-rmfile-"));
    try {
      await mkdir(join(root, ".conductor"), { recursive: true });
      const writer = await makeNodeFsWriter();
      await expect(
        writer.removeFile(join(root, ".conductor", "ghost.yaml")),
      ).resolves.toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses to remove a file outside the allowed homes (containment guard)", async () => {
    const root = await mkdtemp(join(tmpdir(), "maestro-rmfile-"));
    try {
      const file = join(root, "outside.txt");
      await writeFile(file, "keep me", "utf8");
      const writer = await makeNodeFsWriter();
      await expect(writer.removeFile(file)).rejects.toThrow(
        /not inside a \.conductor or \.github\/skills directory/,
      );
      // The file must survive the refused remove.
      expect(await readFile(file, "utf8")).toBe("keep me");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("removes a skill file inside .github/skills", async () => {
    const root = await mkdtemp(join(tmpdir(), "maestro-rmfile-"));
    try {
      const dir = join(root, ".github", "skills", "run-tests");
      await mkdir(dir, { recursive: true });
      const file = join(dir, "SKILL.md");
      await writeFile(file, "---\nname: run-tests\n---\n", "utf8");

      const writer = await makeNodeFsWriter();
      await writer.removeFile(file);
      await expect(readFile(file, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses to remove a file under .github/workflows (only .github/skills is allowed)", async () => {
    const root = await mkdtemp(join(tmpdir(), "maestro-rmfile-"));
    try {
      const dir = join(root, ".github", "workflows");
      await mkdir(dir, { recursive: true });
      const file = join(dir, "ci.yml");
      await writeFile(file, "name: CI\n", "utf8");

      const writer = await makeNodeFsWriter();
      await expect(writer.removeFile(file)).rejects.toThrow(
        /not inside a \.conductor or \.github\/skills directory/,
      );
      // The workflow file must survive the refused remove.
      expect(await readFile(file, "utf8")).toBe("name: CI\n");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("makeNodeFsWriter().removeDir", () => {
  it("removes a directory inside .conductor", async () => {
    const root = await mkdtemp(join(tmpdir(), "maestro-rmdir-"));
    try {
      const dir = join(root, ".conductor", "roles");
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "implementer.yaml"), "name: Implementer\n", "utf8");

      const writer = await makeNodeFsWriter();
      await writer.removeDir(dir);
      await expect(readFile(join(dir, "implementer.yaml"), "utf8")).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("removes a skill directory inside .github/skills", async () => {
    const root = await mkdtemp(join(tmpdir(), "maestro-rmdir-"));
    try {
      const dir = join(root, ".github", "skills", "run-tests");
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "SKILL.md"), "---\nname: run-tests\n---\n", "utf8");

      const writer = await makeNodeFsWriter();
      await writer.removeDir(dir);
      await expect(readFile(join(dir, "SKILL.md"), "utf8")).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses to remove a directory under .github/workflows (only .github/skills is allowed)", async () => {
    const root = await mkdtemp(join(tmpdir(), "maestro-rmdir-"));
    try {
      const dir = join(root, ".github", "workflows");
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "ci.yml"), "name: CI\n", "utf8");

      const writer = await makeNodeFsWriter();
      await expect(writer.removeDir(dir)).rejects.toThrow(
        /not inside a \.conductor or \.github\/skills directory/,
      );
      // The workflows directory must survive the refused remove.
      expect(await readFile(join(dir, "ci.yml"), "utf8")).toBe("name: CI\n");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses to remove an unrelated directory (containment guard)", async () => {
    const root = await mkdtemp(join(tmpdir(), "maestro-rmdir-"));
    try {
      const dir = join(root, "some-other-dir");
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "keep.txt"), "keep me", "utf8");

      const writer = await makeNodeFsWriter();
      await expect(writer.removeDir(dir)).rejects.toThrow(
        /not inside a \.conductor or \.github\/skills directory/,
      );
      expect(await readFile(join(dir, "keep.txt"), "utf8")).toBe("keep me");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
