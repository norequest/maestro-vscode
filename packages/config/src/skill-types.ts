/** A parsed skill manifest derived from a SKILL.md frontmatter block. */
export interface SkillManifest {
  /** The skill name. Must match the directory name under .github/skills/ (or legacy .hallucinate/skills/). */
  name: string;
  /** Human-readable description of what this skill does. */
  description: string;
  /**
   * Optional allowlist of tool names the skill grants permission to use.
   * Undefined means no specific tool restriction is declared.
   */
  allowedTools?: string[];
  /**
   * Set by P5 Discover-and-Adopt after a skill is committed to the repo
   * (sourceFile path + content SHA). Absent in P3.
   */
  provenance?: {
    sourceFile: string;
    sourceSha: string;
  };
}
