import { describe, it, expect } from "vitest";
import { composePreamble } from "../src/compose.js";
import type { PreambleParts } from "../src/compose.js";
import type { SoulDoc } from "../src/types.js";

const soulFixture: SoulDoc = {
  identity: "I am a focused code reviewer.",
  principles: "Accuracy above speed.",
  redLines: "Never delete production data without explicit confirmation.",
  raw: "# Soul\nI am a focused code reviewer.",
};

describe("composePreamble", () => {
  it("orders blocks Soul then Instructions then Tools then Skills then Task", () => {
    const parts: PreambleParts = {
      soul: soulFixture,
      instructions: "Review the PR carefully.",
      tools: "Read (read-only)\nSearch (read-only)",
      skills: ["## skill-a\nDo step one.", "## skill-b\nDo step two."],
      task: "Review PR #42.",
    };
    const out = composePreamble(parts);

    const idxSoul = out.indexOf("I am a focused code reviewer");
    const idxInstructions = out.indexOf("# Instructions");
    const idxTools = out.indexOf("# Tools");
    const idxSkills = out.indexOf("# Skills");
    const idxTask = out.indexOf("# Task");

    expect(idxSoul).toBeGreaterThanOrEqual(0);
    expect(idxInstructions).toBeGreaterThan(idxSoul);
    expect(idxTools).toBeGreaterThan(idxInstructions);
    expect(idxSkills).toBeGreaterThan(idxTools);
    expect(idxTask).toBeGreaterThan(idxSkills);
  });

  it("frames red lines before Instructions AND output matches /override the task/i", () => {
    const parts: PreambleParts = {
      soul: soulFixture,
      instructions: "Do the task.",
      task: "Fix the bug.",
    };
    const out = composePreamble(parts);

    // Red lines must appear before the Instructions section
    const idxRedLines = out.indexOf("Never delete production data");
    const idxInstructions = out.indexOf("# Instructions");
    expect(idxRedLines).toBeGreaterThanOrEqual(0);
    expect(idxRedLines).toBeLessThan(idxInstructions);

    // The red-lines header must contain the phrase "override the task"
    expect(out).toMatch(/override the task/i);
  });

  it("omits Soul/Tools/Skills sections when absent; Instructions before Task", () => {
    const parts: PreambleParts = {
      instructions: "Implement the feature.",
      task: "Add pagination.",
    };
    const out = composePreamble(parts);

    expect(out).not.toContain("# Soul");
    expect(out).not.toContain("# Tools");
    expect(out).not.toContain("# Skills");

    const idxInstructions = out.indexOf("# Instructions");
    const idxTask = out.indexOf("# Task");
    expect(idxInstructions).toBeGreaterThanOrEqual(0);
    expect(idxTask).toBeGreaterThan(idxInstructions);
  });

  it("unions a redLineOverlay into the red lines block", () => {
    const parts: PreambleParts = {
      soul: soulFixture,
      instructions: "Follow the plan.",
      task: "Deploy the service.",
      redLineOverlay: "Never push to main without a review.",
    };
    const out = composePreamble(parts);

    // Both the soul's own redLines and the overlay must appear
    expect(out).toContain("Never delete production data");
    expect(out).toContain("Never push to main without a review");
  });

  it("omits the soul block when neither soul nor redLineOverlay provided", () => {
    const parts: PreambleParts = {
      instructions: "Do the work.",
      task: "Build the thing.",
    };
    const out = composePreamble(parts);
    expect(out).not.toMatch(/# Soul/);
    expect(out).not.toMatch(/override the task/i);
  });

  it("includes only redLineOverlay in soul block when soul is absent", () => {
    const parts: PreambleParts = {
      instructions: "Follow team rules.",
      task: "Write the migration.",
      redLineOverlay: "Never drop tables in production.",
    };
    const out = composePreamble(parts);
    expect(out).toContain("Never drop tables in production");
    expect(out).toMatch(/override the task/i);
  });

  it("omits Tools section when tools is empty string", () => {
    const parts: PreambleParts = {
      instructions: "Run the linter.",
      tools: "",
      task: "Lint the codebase.",
    };
    const out = composePreamble(parts);
    expect(out).not.toContain("# Tools");
  });

  it("omits Skills section when skills array is empty", () => {
    const parts: PreambleParts = {
      instructions: "Write tests.",
      skills: [],
      task: "Test the module.",
    };
    const out = composePreamble(parts);
    expect(out).not.toContain("# Skills");
  });
});

describe("composePreamble · empty task (ACP systemPrompt case)", () => {
  it("omits the Task block entirely when the task is empty", () => {
    const out = composePreamble({ instructions: "Review the diff.", task: "" });
    expect(out).toContain("# Instructions");
    expect(out).not.toContain("# Task");
    expect(out.endsWith("Review the diff.")).toBe(true);
  });
});
