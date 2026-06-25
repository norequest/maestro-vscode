/**
 * Confidence tier for discovered agents/roles.
 * - verified: file format unambiguously identifies this as an agent (e.g. .agent.md, a native .hallucinate role)
 * - likely: format suggests an agent but is not definitive (e.g. prompt files, skill files)
 * - instructions: generic instructions file; may or may not be intended as an agent
 */
export type Confidence = "verified" | "likely" | "instructions";

/**
 * Source kind: identifies the format/origin of a discovered item.
 * Each kind corresponds to a specific file pattern and parser.
 */
export type SourceKind =
  | "claude-agent"
  | "hallucinate-role"
  | "copilot-agent"
  | "copilot-chatmode"
  | "prompt"
  | "claude-skill"
  | "continue-agent"
  | "cursor-rule"
  | "instructions"
  | "plugin-agent"
  | "plugin-skill";

/**
 * A discovered agent/role candidate from a foreign config format.
 * Parsed from the file; NOT yet validated or adopted.
 */
export interface DiscoveredItem {
  /** The source format/origin. */
  kind: SourceKind;
  /** Confidence that this is actually an agent definition. */
  confidence: Confidence;
  /** Human-readable name (from frontmatter or filename stem). */
  name: string;
  /** Short description (from frontmatter or fallback). */
  description: string;
  /** The body text (below frontmatter, or the whole file for YAML formats). */
  body: string;
  /** Tools declared in frontmatter (not yet granted; subject to write-gate). */
  declaredTools: string[];
  /** Engine hint from frontmatter model field or source pattern. */
  engineHint?: string;
  /** Permission hint from frontmatter (e.g. "bypassPermissions", "acceptEdits"). */
  permissionHint?: string;
  /** Absolute or repo-relative source path. */
  source: string;
  /** For plugin items: the plugin directory stem (e.g. "my-plugin"). */
  pluginStem?: string;
  /** For plugin items: the resolved plugin display name. */
  pluginName?: string;
  /** True for skill-type sources (claude-skill, plugin-skill). */
  isSkill: boolean;
}
