/**
 * Tidy a role's Instructions markdown for the drawer's pre-wrapped block.
 *
 * Role instructions come from a YAML block scalar, which commonly leaves wrapped
 * continuation lines carrying a literal HANGING indent (the heading and the first
 * prose line are flush-left, later wrapped lines are indented 4) so a naive
 * common-indent dedent does nothing (the minimum indent is 0). Rendered verbatim
 * in a `white-space:pre-wrap` block that reads ragged.
 *
 * This is a PURE, whitespace-only transform: it never emits HTML and must run
 * BEFORE escapeHtml. It (1) trims trailing whitespace per line, (2) applies a
 * common-indent dedent for the uniformly-indented case, (3) strips the hanging
 * indent off prose continuation lines (a non-blank line indented relative to a
 * preceding flush-left prose line that does NOT begin a structural block: list
 * marker, `>` quote, fenced ``` region, or `#` heading), and (4) collapses runs
 * of 3+ blank lines to one. Intentional breaks, headings, lists, and fenced code
 * indentation survive. Idempotent: running it twice equals running it once.
 */

/** Leading-whitespace run (spaces or tabs) at the start of a line. */
function leadingWs(line: string): string {
  return /^[ \t]*/.exec(line)![0];
}

/**
 * Does this (already left-trimmed) line BEGIN a structural markdown block whose
 * indentation is meaningful and must not be treated as a prose wrap? Covers list
 * markers (`- `/`* `/`+ `/`N.`), block quotes (`>`), fenced code (```` ``` ````),
 * and headings (`#`).
 */
function isStructural(content: string): boolean {
  if (/^[-*+]\s/.test(content)) return true; // unordered list marker
  if (/^\d+\.\s/.test(content)) return true; // ordered list marker (N.)
  if (content.startsWith(">")) return true; // block quote
  if (content.startsWith("```")) return true; // fenced code marker
  if (content.startsWith("#")) return true; // heading
  return false;
}

export function normalizeInstructions(text: string): string {
  if (text === "") return "";

  // 1) Split on CRLF or LF; trim trailing whitespace off every line.
  let lines = text.split(/\r?\n/).map((l) => l.replace(/[ \t]+$/, ""));

  // 2) Common-indent dedent: drop the smallest leading-space run shared by EVERY
  //    non-blank line (the uniformly-indented case). A min of 0 (the hanging case)
  //    is a no-op, handled by step 3.
  const indents = lines.filter((l) => l !== "").map((l) => leadingWs(l).length);
  const common = indents.length ? Math.min(...indents) : 0;
  if (common > 0) lines = lines.map((l) => (l === "" ? l : l.slice(common)));

  // 3) Strip the hanging/continuation indent off prose wraps. A wrapped line is
  //    indented relative to a preceding flush-left prose line; left-strip it so
  //    the wrap aligns. Structural lines (list/quote/heading) keep their indent,
  //    and nothing inside a fenced ``` region is altered (code indent is real).
  let inFence = false;
  let sawFlushLeftProse = false;
  lines = lines.map((line) => {
    const ws = leadingWs(line);
    const content = line.slice(ws.length);
    if (content.startsWith("```")) {
      // A fence marker toggles the region and is not a prose anchor.
      inFence = !inFence;
      sawFlushLeftProse = false;
      return line;
    }
    if (inFence) return line;
    if (content === "") return line; // blank: keep the anchor across paragraph spacing
    if (ws.length === 0) {
      // A flush-left line: prose becomes the anchor for following wraps; a
      // structural line (heading/list/quote) starts a new block and clears it.
      sawFlushLeftProse = !isStructural(content);
      return line;
    }
    // An indented line: structural keeps its indent; a prose wrap under a
    // flush-left prose anchor is left-stripped.
    if (isStructural(content)) return line;
    if (sawFlushLeftProse) return content;
    return line;
  });

  // 4) Collapse runs of 3+ blank lines to a single blank line (1- and 2-blank
  //    paragraph breaks are preserved).
  const out: string[] = [];
  let blankRun = 0;
  const flushBlanks = (): void => {
    if (blankRun === 0) return;
    const keep = blankRun >= 3 ? 1 : blankRun;
    for (let i = 0; i < keep; i++) out.push("");
    blankRun = 0;
  };
  for (const l of lines) {
    if (l === "") {
      blankRun++;
    } else {
      flushBlanks();
      out.push(l);
    }
  }
  flushBlanks();
  return out.join("\n");
}
