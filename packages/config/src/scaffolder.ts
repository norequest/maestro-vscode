import * as nodePath from "node:path";
import { serializeRole, serializeSkill } from "./serializer.js";
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
  const skillsDir = nodePath.join(conductorDir, "skills");

  await fs.mkdir(rolesDir);
  await fs.mkdir(teamsDir);
  await fs.mkdir(skillsDir);

  const implementerPath = nodePath.join(rolesDir, "implementer.yaml");
  await fs.writeFile(implementerPath, serializeRole(STARTER_ROLE));

  const configPath = nodePath.join(conductorDir, "config.yaml");
  await fs.writeFile(configPath, STARTER_CONFIG_YAML);

  const starterSkillDir = nodePath.join(skillsDir, STARTER_SKILL.manifest.name);
  await fs.mkdir(starterSkillDir);
  const starterSkillPath = nodePath.join(starterSkillDir, "SKILL.md");
  await fs.writeFile(starterSkillPath, serializeSkill(STARTER_SKILL.manifest, STARTER_SKILL.body));

  return true;
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
      // Containment guard: refuse to remove anything outside .conductor
      const resolved = (await import("node:path")).resolve(p);
      const segments = resolved.split((await import("node:path")).sep);
      if (!segments.includes(".conductor")) {
        throw new Error(`Refusing to removeDir "${p}": path is not inside a .conductor directory.`);
      }
      await fs.rm(p, { recursive: true, force: true });
    },
  };
}
