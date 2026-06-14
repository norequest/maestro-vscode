import * as nodePath from "node:path";
import { serializeRole } from "./serializer.js";
import type { Role } from "@maestro/core";

/** Minimal async fs interface for writing; injectable for offline testing. */
export interface FsWriter {
  /** Write text to a file, creating parent directories as needed. */
  writeFile(path: string, content: string): Promise<void>;
  /** Returns true if the path exists. */
  exists(path: string): Promise<boolean>;
  /** Create a directory and all parents. No-op if it already exists. */
  mkdir(path: string): Promise<void>;
}

export const STARTER_ROLE: Role = {
  name: "Implementer",
  instructions:
    "You are an implementer. Make the requested change in this worktree. " +
    "Commit your changes when done. Do not modify files outside the scope of the task.",
  engine: { id: "copilot" },
  autonomy: "auto-approve-safe",
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

  await fs.mkdir(rolesDir);
  await fs.mkdir(teamsDir);

  const implementerPath = nodePath.join(rolesDir, "implementer.yaml");
  await fs.writeFile(implementerPath, serializeRole(STARTER_ROLE));

  const configPath = nodePath.join(conductorDir, "config.yaml");
  await fs.writeFile(configPath, STARTER_CONFIG_YAML);

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
  };
}
