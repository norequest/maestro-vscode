import { describe, expect, it } from "vitest";
import { firstMeaningfulLine } from "../src/text.js";

describe("firstMeaningfulLine", () => {
  it("skips a leading '# Instructions' heading and returns the next real line", () => {
    const instructions = "# Instructions\nYou own ALPHA.md in the repo root and nothing else.";
    expect(firstMeaningfulLine(instructions)).toBe(
      "You own ALPHA.md in the repo root and nothing else.",
    );
  });

  it("skips multiple leading blank and heading lines", () => {
    const instructions = "\n\n# Instructions\n\n### Role\n\nDraft the release notes.";
    expect(firstMeaningfulLine(instructions)).toBe("Draft the release notes.");
  });

  it("returns the first line for a flush body with no heading", () => {
    const instructions = "Review for PEP 8 and type hints.\nSecond line.";
    expect(firstMeaningfulLine(instructions)).toBe("Review for PEP 8 and type hints.");
  });

  it("returns '' when there is no meaningful line", () => {
    expect(firstMeaningfulLine("")).toBe("");
    expect(firstMeaningfulLine("\n\n   \n")).toBe("");
    expect(firstMeaningfulLine("# Instructions\n## Only headings")).toBe("");
  });

  it("handles CRLF line endings", () => {
    const instructions = "# Instructions\r\nYou own BETA.md and nothing else.\r\n";
    expect(firstMeaningfulLine(instructions)).toBe("You own BETA.md and nothing else.");
  });

  it("treats a '#' without a following space as content, not a heading", () => {
    expect(firstMeaningfulLine("#hashtag is not a heading")).toBe("#hashtag is not a heading");
  });
});
