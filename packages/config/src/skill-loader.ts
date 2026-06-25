import * as nodePath from "node:path";
import type { FsReader } from "./loader.js";
import { SKILLS_DIR_SEGMENTS, LEGACY_SKILLS_DIR_SEGMENTS } from "./paths.js";
import type { SkillManifest } from "./skill-types.js";
import { parseSkillMarkdown } from "./skill-parser.js";
import type { ValidationWarning } from "./types.js";

/**
 * Per-skill extras the extension resolver needs to advertise a skill by name
 * and materialize its file on demand: the one-line frontmatter description (may
 * be undefined) and the full RAW SKILL.md text exactly as read from disk
 * (frontmatter plus body).
 */
export interface SkillDetail {
  /** The frontmatter description, as parsed. Undefined when none was declared. */
  description?: string;
  /** The full SKILL.md text exactly as read from disk (frontmatter + body). */
  raw: string;
}

export interface SkillLoadResult {
  /** Successfully parsed skill manifests. */
  skills: SkillManifest[];
  /**
   * Map from skill name to the body text extracted from that skill's SKILL.md.
   * Used by compose.ts at spawn time. Only manifests that parsed successfully
   * are represented here.
   */
  bodies: Map<string, string>;
  /**
   * Map from skill name to its description and raw on-disk SKILL.md text. Keyed
   * the same way as `bodies` (only successfully parsed manifests appear). Used
   * by the extension resolver to advertise a skill by name and materialize its
   * original file verbatim.
   */
  details: Map<string, SkillDetail>;
  /** Non-fatal warnings (e.g. an allowed-tools value that was coerced). */
  warnings: Array<{ source: string; warnings: ValidationWarning[] }>;
  /** Parse or read errors (never throws; all failures are collected here). */
  errors: Array<{ source: string; errors: string[] }>;
}

/**
 * Loads all skills from BOTH skills homes under the given workspace root:
 *   - `.github/skills/<name>/SKILL.md` (PRIMARY: the folder VS Code and
 *     Copilot read), and
 *   - `.hallucinate/skills/<name>/SKILL.md` (LEGACY: still read for back-compat,
 *     never written anymore).
 *
 * Results merge by skill name with the `.github` home WINNING on a collision:
 * a `.hallucinate` skill never overwrites a `.github` skill of the same name. If
 * a directory does not exist it is skipped; if NEITHER exists, returns an empty
 * result with no errors. Each subdirectory under a skills home is treated as
 * one skill. Malformed SKILL.md files are collected as errors, not thrown.
 * Warnings and errors from both homes accumulate.
 *
 * All filesystem access goes through the injected `FsReader`, which enforces
 * the `.hallucinate` symlink containment boundary (Issue 27 / S8).
 */
export async function loadSkills(
  workspaceRoot: string,
  fs: FsReader,
): Promise<SkillLoadResult> {
  const result: SkillLoadResult = {
    skills: [],
    bodies: new Map(),
    details: new Map(),
    warnings: [],
    errors: [],
  };

  // Scan the primary home first, then the legacy home. Because we populate the
  // by-name collections only when a name is not already present, the primary
  // `.github` skill wins on a name collision with a legacy `.hallucinate` skill.
  const primaryDir = nodePath.join(workspaceRoot, ...SKILLS_DIR_SEGMENTS);
  const legacyDir = nodePath.join(workspaceRoot, ...LEGACY_SKILLS_DIR_SEGMENTS);

  await scanSkillsHome(primaryDir, workspaceRoot, fs, result);
  await scanSkillsHome(legacyDir, workspaceRoot, fs, result);

  return result;
}

/**
 * Scan one skills home, merging its skills into `result`. A directory that does
 * not exist is skipped (existing not-exists guard). A name already present in
 * `result` (i.e. claimed by an earlier home) is NOT overwritten, which is what
 * lets `.github` win over `.hallucinate` when this is called for `.github` first.
 * Warnings and errors accumulate into `result` regardless.
 */
async function scanSkillsHome(
  skillsDir: string,
  workspaceRoot: string,
  fs: FsReader,
  result: SkillLoadResult,
): Promise<void> {
  // Skip a home that does not exist.
  if (!(await fs.exists(skillsDir))) {
    return;
  }

  const subdirs = await fs.listDirs(skillsDir);

  for (const subdir of subdirs) {
    const skillMdPath = nodePath.join(skillsDir, subdir, "SKILL.md");
    const source = nodePath.relative(workspaceRoot, skillMdPath);

    let text: string;
    try {
      text = await fs.readFile(skillMdPath);
    } catch (err) {
      result.errors.push({ source, errors: [`Failed to read SKILL.md: ${String(err)}`] });
      continue;
    }

    const parsed = parseSkillMarkdown(text, source);

    if (!parsed.manifest.ok) {
      result.errors.push({ source, errors: parsed.manifest.errors });
      continue;
    }

    if (parsed.manifest.warnings.length > 0) {
      result.warnings.push({ source, warnings: parsed.manifest.warnings });
    }

    const name = parsed.manifest.value.name;

    // A skill of this name from an earlier (higher-priority) home wins: do not
    // let a later home overwrite the bodies/details/skills it already populated.
    if (result.bodies.has(name)) {
      continue;
    }

    result.skills.push(parsed.manifest.value);
    result.bodies.set(name, parsed.body);
    // `text` is the raw on-disk SKILL.md; `description` may be undefined.
    result.details.set(name, {
      description: parsed.manifest.value.description,
      raw: text,
    });
  }
}
