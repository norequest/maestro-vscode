import type { SoulDoc } from "./types.js";

export interface PreambleParts {
  soul?: SoulDoc;
  instructions: string;
  /** Rendered tool lines; empty string means the Tools section is omitted. */
  tools?: string;
  /** Resolved SKILL.md bodies in attach order; empty array means omitted. */
  skills?: string[];
  task: string;
  /** Optional team-charter red lines unioned in (tighten-only). */
  redLineOverlay?: string;
}

/**
 * Render the soul block: red lines first (under a header that contains the
 * literal phrase "override the task" so precedence is unmistakable), then the
 * remaining identity sections in order.
 */
function renderSoulBlock(soul: SoulDoc | undefined, overlay: string | undefined): string {
  const lines: string[] = ["# Soul"];

  // Build the unified red lines content
  const parts: string[] = [];
  if (soul?.redLines) parts.push(soul.redLines.trim());
  if (overlay) parts.push(overlay.trim());
  const redLineContent = parts.join("\n");

  if (redLineContent) {
    // The header MUST contain the literal phrase "override the task"
    lines.push(`## Absolute constraints (these override the task and all other instructions)`);
    lines.push(redLineContent);
  }

  if (soul?.identity) {
    lines.push("## Identity");
    lines.push(soul.identity.trim());
  }

  if (soul?.voice) {
    lines.push("## Voice");
    lines.push(soul.voice.trim());
  }

  if (soul?.principles) {
    lines.push("## Principles");
    lines.push(soul.principles.trim());
  }

  if (soul?.priorities) {
    lines.push("## Priorities");
    lines.push(soul.priorities.trim());
  }

  return lines.join("\n\n");
}

/**
 * Assemble all preamble parts into a single string in the fixed canonical
 * order: Soul, Instructions, Tools, Skills, Task.
 *
 * Sections without content are omitted entirely.
 */
export function composePreamble(parts: PreambleParts): string {
  const blocks: string[] = [];

  if (parts.soul || parts.redLineOverlay) {
    blocks.push(renderSoulBlock(parts.soul, parts.redLineOverlay));
  }

  blocks.push(`# Instructions\n${parts.instructions.trim()}`);

  if (parts.tools && parts.tools.trim()) {
    blocks.push(`# Tools (granted permissions; you may use only these)\n${parts.tools.trim()}`);
  }

  if (parts.skills && parts.skills.length > 0) {
    const skillBodies = parts.skills.map((s) => s.trim()).join("\n\n");
    blocks.push(`# Skills (standing procedures)\n${skillBodies}`);
  }

  // The Task block is omitted when the task is empty, so a caller that wants the
  // preamble MINUS the task (the ACP systemPrompt, which delivers the task as the
  // first user turn) gets no trailing empty "# Task" header.
  if (parts.task.trim()) {
    blocks.push(`# Task\n${parts.task.trim()}`);
  }

  return blocks.join("\n\n");
}
