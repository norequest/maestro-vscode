import * as nodePath from "node:path";
import { serializeRole, serializeSkill } from "./serializer.js";
import { SKILLS_DIR_SEGMENTS } from "./paths.js";
import { VENDORED_SKILLS } from "./vendored-skills.js";
import type { Role } from "@maestro/core";
import type { SkillManifest } from "./skill-types.js";

/** Minimal async fs interface for writing; injectable for offline testing. */
export interface FsWriter {
  /** Write text to a file, creating parent directories as needed. */
  writeFile(path: string, content: string): Promise<void>;
  /** Returns true if the path exists. */
  exists(path: string): Promise<boolean>;
  /** Create a directory and all parents. No-op if it already exists. */
  mkdir(path: string): Promise<void>;
  /** Remove a directory and all its contents recursively. Refuses to remove paths outside .conductor (containment guard). */
  removeDir(path: string): Promise<void>;
  /** Remove a single file. No-op if it does not exist. Refuses to remove paths outside .conductor (containment guard). */
  removeFile(path: string): Promise<void>;
}

export const STARTER_ROLE: Role = {
  name: "Implementer",
  instructions:
    "You are an implementer. Make the requested change in this worktree. " +
    "Commit your changes when done. Do not modify files outside the scope of the task.",
  engine: { id: "copilot" },
  autonomy: "auto-approve-safe",
};

const STARTER_SKILL: { manifest: SkillManifest; body: string } = {
  manifest: {
    name: "run-tests",
    description: "Runs the project test suite and reports failures.",
    allowedTools: ["Run", "Git"],
  },
  body:
    "Run the full test suite with the project's standard test command. " +
    "Report any failing tests with their names and error messages. " +
    "Do not modify test files; only fix the source code under test.",
};

const STARTER_CONFIG_YAML = `# Maestro orchestrator configuration
# See .conductor/roles/ to define roles and .conductor/teams/ to group them.
maxParallelAgents: 3

# defaults: a config-driven layer composed into agents at spawn.
#   instructions / skills apply to EVERY agent (the general layer).
#   leadSkills apply ONLY to the lead (the agent that holds a team roster).
defaults:
  instructions: ""
  skills: []
  leadSkills:
    - task-coordination-strategies
    - team-composition-patterns
    - team-communication-protocols
`;

/**
 * Write a starter .conductor/ directory if it does not already exist.
 * Returns true if scaffolding was performed, false if .conductor/ was already present.
 */
export async function scaffoldIfMissing(
  workspaceRoot: string,
  fs: FsWriter,
): Promise<boolean> {
  const conductorDir = nodePath.join(workspaceRoot, ".conductor");

  if (await fs.exists(conductorDir)) {
    return false;
  }

  const rolesDir = nodePath.join(conductorDir, "roles");
  const teamsDir = nodePath.join(conductorDir, "teams");
  // Skills live in the .github/skills home (the folder VS Code and Copilot
  // read), NOT under .conductor. Roles, teams, and config.yaml stay in
  // .conductor.
  const skillsDir = nodePath.join(workspaceRoot, ...SKILLS_DIR_SEGMENTS);

  await fs.mkdir(rolesDir);
  await fs.mkdir(teamsDir);
  await fs.mkdir(skillsDir);

  const implementerPath = nodePath.join(rolesDir, "implementer.yaml");
  await fs.writeFile(implementerPath, serializeRole(STARTER_ROLE));

  const configPath = nodePath.join(conductorDir, "config.yaml");
  await fs.writeFile(configPath, STARTER_CONFIG_YAML);

  await writeSkillIfMissing(skillsDir, STARTER_SKILL, fs);
  for (const skill of VENDORED_SKILLS) {
    await writeSkillIfMissing(skillsDir, skill, fs);
  }

  return true;
}

/**
 * Ensure the vendored skills exist under .github/skills/, even when .conductor/
 * already exists (scaffoldIfMissing only writes them on a fresh tree).
 * Idempotent: never overwrites an existing SKILL.md. Creates .github/skills/ if
 * absent. Returns the names of skills newly written.
 */
export async function ensureVendoredSkills(
  workspaceRoot: string,
  fs: FsWriter,
): Promise<string[]> {
  const skillsDir = nodePath.join(workspaceRoot, ...SKILLS_DIR_SEGMENTS);
  // Recursive mkdir is a no-op when the directory already exists.
  await fs.mkdir(skillsDir);

  const added: string[] = [];
  for (const skill of VENDORED_SKILLS) {
    const skillPath = nodePath.join(skillsDir, skill.manifest.name, "SKILL.md");
    if (await fs.exists(skillPath)) {
      continue;
    }
    await writeSkillIfMissing(skillsDir, skill, fs);
    added.push(skill.manifest.name);
  }
  return added;
}

/**
 * Write one skill to <skillsDir>/<name>/SKILL.md, behind the injected fs.
 * Idempotent: if the SKILL.md already exists it is left untouched (never
 * overwritten), mirroring the whole-tree guard scaffoldIfMissing uses.
 *
 * @param skillsDir Absolute path to the skills directory (callers pass the
 *   resolved .github/skills home).
 */
export async function writeSkillIfMissing(
  skillsDir: string,
  skill: { manifest: SkillManifest; body: string },
  fs: FsWriter,
): Promise<void> {
  const skillDir = nodePath.join(skillsDir, skill.manifest.name);
  const skillPath = nodePath.join(skillDir, "SKILL.md");
  if (await fs.exists(skillPath)) {
    return;
  }
  await fs.mkdir(skillDir);
  await fs.writeFile(skillPath, serializeSkill(skill.manifest, skill.body));
}

/**
 * Containment predicate for the node-backed writer's remove guards. True when
 * the resolved path segments place the target inside one of the two allowed
 * homes: .conductor (roles/teams/config) OR .github/skills (the skills home).
 * Anything else (e.g. .github/workflows or an unrelated directory) is refused.
 */
function isInsideAllowedHome(segments: string[]): boolean {
  if (segments.includes(".conductor")) {
    return true;
  }
  return segments.includes(".github") && segments.includes("skills");
}

/**
 * A real FsWriter backed by node:fs/promises.
 */
export async function makeNodeFsWriter(): Promise<FsWriter> {
  const fs = await import("node:fs/promises");

  return {
    async writeFile(p: string, content: string): Promise<void> {
      const dir = (await import("node:path")).dirname(p);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(p, content, "utf-8");
    },
    async exists(p: string): Promise<boolean> {
      try {
        await fs.access(p);
        return true;
      } catch {
        return false;
      }
    },
    async mkdir(p: string): Promise<void> {
      await fs.mkdir(p, { recursive: true });
    },
    async removeDir(p: string): Promise<void> {
      // Containment guard: only remove inside one of the two allowed homes,
      // .conductor (roles/teams/config) or .github/skills (the skills home).
      const path = await import("node:path");
      const segments = path.resolve(p).split(path.sep);
      if (!isInsideAllowedHome(segments)) {
        throw new Error(
          `Refusing to removeDir "${p}": path is not inside a .conductor or .github/skills directory.`,
        );
      }
      await fs.rm(p, { recursive: true, force: true });
    },
    async removeFile(p: string): Promise<void> {
      // Containment guard: the same homes removeDir allows. A role/team is a
      // single file under .conductor/<kind>/<name>.yaml, and a skill file lives
      // under .github/skills/<name>/SKILL.md.
      const path = await import("node:path");
      const segments = path.resolve(p).split(path.sep);
      if (!isInsideAllowedHome(segments)) {
        throw new Error(
          `Refusing to removeFile "${p}": path is not inside a .conductor or .github/skills directory.`,
        );
      }
      // force:true makes a missing file a no-op (parity with removeDir).
      await fs.rm(p, { force: true });
    },
  };
}
