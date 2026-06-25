/**
 * Shared path segments for where Hallucinate reads and writes skills.
 *
 * The skills home moved from `.hallucinate/skills/` to `.github/skills/` (the
 * folder VS Code and Copilot read natively). Roles, teams, and config.yaml
 * stay under `.hallucinate/`. Defining the segments here keeps the location in
 * one place, so every module joins the same path.
 */

/** Skills home: the folder VS Code and Copilot read. Relative to the workspace root. */
export const SKILLS_DIR_SEGMENTS = [".github", "skills"] as const;

/** Legacy skills home, still READ for back-compat (never written anymore). */
export const LEGACY_SKILLS_DIR_SEGMENTS = [".hallucinate", "skills"] as const;
