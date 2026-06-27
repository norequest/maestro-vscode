import { describe, expect, it } from "vitest";
import { normalizeInstructions } from "../src/instructions-format.js";

describe("normalizeInstructions (drawer Instructions whitespace tidy)", () => {
  it("leaves a flush-left block untouched", () => {
    const input = "# Reviewer\nYou review code carefully.\nReport issues clearly.";
    expect(normalizeInstructions(input)).toBe(input);
  });

  it("strips the 4-space hanging/continuation indent while keeping the heading and first prose line", () => {
    // The reported case: a YAML block scalar where the heading and the first prose
    // line are flush-left, but later wrapped lines carry a literal 4-space indent.
    const input = [
      "# Reviewer",
      "You review code and report each issue with",
      "    a file and line citation, a confidence",
      "    level, and a clear explanation of why.",
    ].join("\n");
    const out = normalizeInstructions(input);
    // The heading and the first prose line are unchanged.
    expect(out).toContain("# Reviewer");
    expect(out).toContain("You review code and report each issue with");
    // The continuation lines lose their hanging 4-space indent (they align flush).
    expect(out).toContain("a file and line citation, a confidence");
    expect(out).not.toContain("    a file and line citation");
    expect(out).toContain("level, and a clear explanation of why.");
    expect(out).not.toContain("    level, and");
  });

  it("fully dedents a uniformly-indented block (common-indent case)", () => {
    const input = "    # Role\n    You do things.\n    More prose here.";
    expect(normalizeInstructions(input)).toBe("# Role\nYou do things.\nMore prose here.");
  });

  it("preserves single blank-line paragraph breaks", () => {
    const input = "First paragraph.\n\nSecond paragraph.";
    expect(normalizeInstructions(input)).toBe(input);
  });

  it("collapses 3+ consecutive blank lines to a single blank line", () => {
    // "a" then three blank lines then "b".
    const input = "a\n\n\n\nb";
    expect(normalizeInstructions(input)).toBe("a\n\nb");
  });

  it("preserves list markers and their indentation (never strips a list line as a wrap)", () => {
    const input = ["Do these:", "    - first thing", "    - second thing"].join("\n");
    const out = normalizeInstructions(input);
    // The list lines keep their marker AND their indent (they are structural, not
    // a prose wrap), so the hanging-indent strip must leave them alone.
    expect(out).toContain("    - first thing");
    expect(out).toContain("    - second thing");
  });

  it("does not strip indentation inside a fenced code region", () => {
    const input = ["Run the build:", "```", "    npm run build", "```"].join("\n");
    const out = normalizeInstructions(input);
    // Code indentation is meaningful, so the fenced line keeps its 4 spaces.
    expect(out).toContain("    npm run build");
  });

  it("handles CRLF line endings and the empty string", () => {
    expect(normalizeInstructions("")).toBe("");
    const crlf = "# Role\r\nLine two\r\n    wrapped tail";
    expect(normalizeInstructions(crlf)).toBe("# Role\nLine two\nwrapped tail");
  });

  it("is idempotent (running twice equals running once)", () => {
    const input = [
      "# Reviewer",
      "You review code and report each issue with",
      "    a file and line citation, a confidence",
      "    level, and a clear explanation of why.",
    ].join("\n");
    const once = normalizeInstructions(input);
    expect(normalizeInstructions(once)).toBe(once);
  });
});
