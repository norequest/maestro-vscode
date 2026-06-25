import { describe, it, expect } from "vitest";
import { parseSkillMarkdown } from "../src/skill-parser.js";

const VALID_MD = `---
name: run-tests
description: Runs the project test suite and reports failures.
allowed-tools:
  - Run
  - Git
---

## Procedure

1. Run pnpm test in the repo root.
2. Report failing test names and their error messages.
`;

describe("parseSkillMarkdown", () => {
  it("parses a valid SKILL.md and returns ok manifest with correct fields", () => {
    const result = parseSkillMarkdown(VALID_MD, "run-tests/SKILL.md");
    expect(result.manifest.ok).toBe(true);
    if (!result.manifest.ok) return;
    expect(result.manifest.value.name).toBe("run-tests");
    expect(result.manifest.value.description).toBe(
      "Runs the project test suite and reports failures.",
    );
    expect(result.manifest.value.allowedTools).toEqual(["Run", "Git"]);
  });

  it("body contains the procedure text and NOT the frontmatter fence", () => {
    const result = parseSkillMarkdown(VALID_MD, "run-tests/SKILL.md");
    expect(result.body).toContain("Procedure");
    expect(result.body).toContain("pnpm test");
    expect(result.body).not.toContain("---");
    expect(result.body).not.toContain("name: run-tests");
  });

  it("returns error when name is missing", () => {
    const md = `---
description: Some skill.
---

Body.
`;
    const result = parseSkillMarkdown(md, "unnamed/SKILL.md");
    expect(result.manifest.ok).toBe(false);
    if (result.manifest.ok) return;
    expect(result.manifest.errors.some((e) => /name/i.test(e))).toBe(true);
  });

  it("returns error when description is missing", () => {
    const md = `---
name: my-skill
---

Body.
`;
    const result = parseSkillMarkdown(md, "my-skill/SKILL.md");
    expect(result.manifest.ok).toBe(false);
    if (result.manifest.ok) return;
    expect(result.manifest.errors.some((e) => /description/i.test(e))).toBe(true);
  });

  it("returns error when there is no frontmatter fence at all", () => {
    const md = `Just a bare body with no frontmatter.`;
    const result = parseSkillMarkdown(md, "no-front/SKILL.md");
    expect(result.manifest.ok).toBe(false);
    if (result.manifest.ok) return;
    expect(result.manifest.errors.length).toBeGreaterThan(0);
  });

  it("allowedTools is undefined when allowed-tools is omitted", () => {
    const md = `---
name: simple-skill
description: A skill with no tool restrictions.
---

Do the thing.
`;
    const result = parseSkillMarkdown(md, "simple-skill/SKILL.md");
    expect(result.manifest.ok).toBe(true);
    if (!result.manifest.ok) return;
    expect(result.manifest.value.allowedTools).toBeUndefined();
  });

  it("rejects a name starting with a dash (CLI flag injection guard)", () => {
    const md = `---
name: "-rm-rf"
description: Dangerous.
---
`;
    const result = parseSkillMarkdown(md, "bad/SKILL.md");
    expect(result.manifest.ok).toBe(false);
    if (result.manifest.ok) return;
    expect(result.manifest.errors.some((e) => /dash/i.test(e))).toBe(true);
  });

  it("rejects a name containing control characters", () => {
    const md = `---
name: "bad\x01name"
description: Has ctrl char.
---
`;
    const result = parseSkillMarkdown(md, "bad/SKILL.md");
    expect(result.manifest.ok).toBe(false);
    if (result.manifest.ok) return;
    expect(result.manifest.errors.some((e) => /control/i.test(e))).toBe(true);
  });

  it("provenance is undefined when not passed (set only by P5)", () => {
    const result = parseSkillMarkdown(VALID_MD, "run-tests/SKILL.md");
    expect(result.manifest.ok).toBe(true);
    if (!result.manifest.ok) return;
    expect(result.manifest.value.provenance).toBeUndefined();
  });
});
