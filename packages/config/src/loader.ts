import * as nodePath from "node:path";
import { parseRoleYaml, parseTeamYaml, parseConfigYaml } from "./parser.js";
import type { Role, Team, OrchestratorConfig } from "@maestro/core";
import type { ValidationWarning } from "./types.js";

/** Minimal async fs interface; injectable for offline testing. */
export interface FsReader {
  /** Returns file contents as a UTF-8 string. Throws if the file does not exist. */
  readFile(path: string): Promise<string>;
  /** Returns base names of files with the given extension inside a directory, or [] if the dir does not exist. */
  listFiles(dir: string, ext: string): Promise<string[]>;
  /** Returns true if the path exists (file or directory). */
  exists(path: string): Promise<boolean>;
}

export interface LoadResult {
  roles: Role[];
  teams: Team[];
  config: OrchestratorConfig;
  warnings: Array<{ source: string; warnings: ValidationWarning[] }>;
  errors: Array<{ source: string; errors: string[] }>;
}

export const DEFAULT_CONFIG: OrchestratorConfig = { maxParallelAgents: 3 };

export async function loadConductorDir(
  workspaceRoot: string,
  fs: FsReader,
): Promise<LoadResult> {
  const conductorDir = nodePath.join(workspaceRoot, ".conductor");
  const rolesDir = nodePath.join(conductorDir, "roles");
  const teamsDir = nodePath.join(conductorDir, "teams");
  const configPath = nodePath.join(conductorDir, "config.yaml");

  const result: LoadResult = {
    roles: [],
    teams: [],
    config: { ...DEFAULT_CONFIG },
    warnings: [],
    errors: [],
  };

  if (!(await fs.exists(conductorDir))) {
    return result;
  }

  // Load roles first (teams reference roles by name).
  const roleFiles = await fs.listFiles(rolesDir, ".yaml");
  for (const file of roleFiles) {
    const filePath = nodePath.join(rolesDir, file);
    const source = nodePath.relative(workspaceRoot, filePath);
    try {
      const text = await fs.readFile(filePath);
      const parsed = parseRoleYaml(text, source);
      if (parsed.role.ok) {
        result.roles.push(parsed.role.value);
        if (parsed.role.warnings.length > 0) {
          result.warnings.push({ source, warnings: parsed.role.warnings });
        }
      } else {
        result.errors.push({ source, errors: parsed.role.errors });
      }
    } catch (err) {
      result.errors.push({ source, errors: [`Failed to read file: ${String(err)}`] });
    }
  }

  // Build role map for team resolution.
  const knownRoles = new Map<string, Role>(result.roles.map((r) => [r.name, r]));

  // Load teams.
  const teamFiles = await fs.listFiles(teamsDir, ".yaml");
  for (const file of teamFiles) {
    const filePath = nodePath.join(teamsDir, file);
    const source = nodePath.relative(workspaceRoot, filePath);
    try {
      const text = await fs.readFile(filePath);
      const parsed = parseTeamYaml(text, source, knownRoles);
      if (parsed.team.ok) {
        result.teams.push(parsed.team.value);
        if (parsed.team.warnings.length > 0) {
          result.warnings.push({ source, warnings: parsed.team.warnings });
        }
      } else {
        result.errors.push({ source, errors: parsed.team.errors });
      }
    } catch (err) {
      result.errors.push({ source, errors: [`Failed to read file: ${String(err)}`] });
    }
  }

  // Load orchestrator config.
  if (await fs.exists(configPath)) {
    try {
      const text = await fs.readFile(configPath);
      const parsed = parseConfigYaml(text, ".conductor/config.yaml");
      if (parsed.config.ok) {
        result.config = parsed.config.value;
        if (parsed.config.warnings.length > 0) {
          result.warnings.push({
            source: ".conductor/config.yaml",
            warnings: parsed.config.warnings,
          });
        }
      } else {
        result.errors.push({
          source: ".conductor/config.yaml",
          errors: parsed.config.errors,
        });
      }
    } catch (err) {
      result.errors.push({
        source: ".conductor/config.yaml",
        errors: [`Failed to read config: ${String(err)}`],
      });
    }
  }

  return result;
}

/**
 * A real FsReader backed by node:fs/promises.
 * Import lazily in extension code so the module remains testable.
 */
export async function makeNodeFsReader(): Promise<FsReader> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");

  return {
    async readFile(p: string): Promise<string> {
      return fs.readFile(p, "utf-8");
    },
    async listFiles(dir: string, ext: string): Promise<string[]> {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        return entries
          .filter((e) => e.isFile() && e.name.endsWith(ext))
          .map((e) => e.name)
          .sort();
      } catch {
        return [];
      }
    },
    async exists(p: string): Promise<boolean> {
      try {
        await fs.access(p);
        return true;
      } catch {
        return false;
      }
    },
  };
}
