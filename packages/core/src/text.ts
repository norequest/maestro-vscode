/**
 * The first meaningful one-line summary from role instructions: skips blank lines
 * AND leading markdown heading lines (e.g. "# Instructions"), returns the first
 * non-heading non-blank line, trimmed. Empty string when there is none.
 *
 * Role instructions conventionally OPEN with a "# Instructions" heading, so the
 * naive "first line" is a useless label. This is the shared chokepoint that keeps
 * a heading from leaking into a teammate's derived description or a fleet child's
 * task. Pure string transform: it never produces HTML, so callers keep their own
 * escaping.
 */
export function firstMeaningfulLine(instructions: string): string {
  for (const raw of instructions.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "") continue;
    if (/^#{1,6}\s/.test(line)) continue; // skip "# Heading" lines
    return line;
  }
  return "";
}
