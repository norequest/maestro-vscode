import * as nodePath from "node:path";
import { parseRoleYaml, parseTeamYaml, parseConfigYaml } from "./parser.js";
import type { Role, Team } from "@maestro/core";
import type { ValidationWarning, MaestroConfig } from "./types.js";
import { loadSoul } from "./souls.js";
import { loadSkills } from "./skill-loader.js";

/** Minimal async fs interface; injectable for offline testing. */
export interface FsReader {
  /** Returns file contents as a UTF-8 string. Throws if the file does not exist. */
  readFile(path: string): Promise<string>;
  /** Returns base names of files with the given extension inside a directory, or [] if the dir does not exist. */
  listFiles(dir: string, ext: string): Promise<string[]>;
  /** Returns base names of immediate subdirectories inside a directory, or [] if the dir does not exist. Symlinked entries are skipped. */
  listDirs(dir: string): Promise<string[]>;
  /** Returns true if the path exists (file or directory). */
  exists(path: string): Promise<boolean>;
}

export interface LoadResult {
  roles: Role[];
  teams: Team[];
  config: MaestroConfig;
  warnings: Array<{ source: string; warnings: ValidationWarning[] }>;
  errors: Array<{ source: string; errors: string[] }>;
}

export const DEFAULT_CONFIG: MaestroConfig = { maxParallelAgents: 3 };

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
        const roleWarnings: ValidationWarning[] = [...parsed.role.warnings];
        const role = parsed.role.value;

        // Resolve soul reference if present. A missing file is a warning, not an error.
        if (role.soul !== undefined) {
          const soulResult = await loadSoul(workspaceRoot, role.soul, fs);
          if ("error" in soulResult) {
            roleWarnings.push({
              field: "soul",
              message: `soul "${role.soul}" referenced in role "${role.name}" was not found: ${soulResult.error}`,
            });
          }
          // The role.soul name stays as-is regardless; extension resolves at spawn.
        }

        result.roles.push(role);
        if (roleWarnings.length > 0) {
          result.warnings.push({ source, warnings: roleWarnings });
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

  // Resolve the loaded skill name set so the config validator can warn on
  // default skill names (defaults.skills / defaults.leadSkills) that do not
  // resolve, mirroring the role/team reference-by-name warning style. Skill
  // load errors here are non-fatal for config: an empty set just means every
  // referenced default skill warns, which is the safe, best-effort behavior.
  const skillLoad = await loadSkills(workspaceRoot, fs);
  const knownSkills = new Set<string>(skillLoad.skills.map((s) => s.name));

  // Load orchestrator config.
  if (await fs.exists(configPath)) {
    try {
      const text = await fs.readFile(configPath);
      const parsed = parseConfigYaml(text, ".conductor/config.yaml", knownSkills);
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

/** Marker directory that bounds every file the node-backed reader may touch. */
const CONDUCTOR_DIR_NAME = ".conductor";

/**
 * Returns the nearest `.conductor` ancestor of `target` (inclusive), or null if
 * `target` is not inside a `.conductor` directory. This is the containment
 * boundary the node-backed reader enforces (Issue 27 / S8).
 */
function conductorBoundary(nodePathMod: typeof import("node:path"), target: string): string | null {
  const resolved = nodePathMod.resolve(target);
  const segments = resolved.split(nodePathMod.sep);
  const idx = segments.lastIndexOf(CONDUCTOR_DIR_NAME);
  if (idx === -1) return null;
  return segments.slice(0, idx + 1).join(nodePathMod.sep);
}

/**
 * True when `candidate`, once realpath-resolved, stays within `boundary`
 * (also realpath-resolved). Used to reject symlinks in `.conductor/` that
 * escape the directory and would otherwise be an arbitrary file-read primitive.
 */
async function isContained(
  fs: typeof import("node:fs/promises"),
  nodePathMod: typeof import("node:path"),
  candidate: string,
  boundary: string,
): Promise<boolean> {
  const realBoundary = await fs.realpath(boundary);
  const realCandidate = await fs.realpath(candidate);
  const rel = nodePathMod.relative(realBoundary, realCandidate);
  // Contained iff the relative path does not climb out (`..`) and is not absolute.
  return rel === "" || (!rel.startsWith("..") && !nodePathMod.isAbsolute(rel));
}

/**
 * A real FsReader backed by node:fs/promises.
 * Import lazily in extension code so the module remains testable.
 *
 * Security (Issue 27 / S8): reads are confined to the `.conductor` directory
 * that contains the target path. Before reading, the target's realpath is
 * resolved and asserted to stay within the realpath of that `.conductor`
 * boundary, so a symlink such as `.conductor/roles/x.yaml -> /etc/passwd` is
 * refused rather than followed. Directory listings skip symlinked entries so a
 * symlinked `.yaml` is never handed back to the loader.
 */
export async function makeNodeFsReader(): Promise<FsReader> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");

  return {
    async readFile(p: string): Promise<string> {
      const boundary = conductorBoundary(path, p);
      if (boundary !== null) {
        const contained = await isContained(fs, path, p, boundary).catch(() => false);
        if (!contained) {
          throw new Error(
            `Refusing to read "${p}": it resolves outside the ${CONDUCTOR_DIR_NAME} directory (possible symlink escape).`,
          );
        }
      }
      return fs.readFile(p, "utf-8");
    },
    async listFiles(dir: string, ext: string): Promise<string[]> {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        // Skip symlinks (isFile() is already false for them, but be explicit so
        // a symlinked .yaml can never be listed and then read). Issue 27 / S8.
        return entries
          .filter((e) => !e.isSymbolicLink() && e.isFile() && e.name.endsWith(ext))
          .map((e) => e.name)
          .sort();
      } catch {
        return [];
      }
    },
    async listDirs(dir: string): Promise<string[]> {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        // Skip symlinks: a symlinked subdir could escape the .conductor boundary
        // (Issue 27 / S8). isDirectory() is already false for them, but be explicit.
        return entries
          .filter((e) => !e.isSymbolicLink() && e.isDirectory())
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
