import { describe, it, expect } from "vitest";
import { splitFrontmatter, parseDiscoveredFile } from "../../src/discover/sources.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const FIXTURES = join(import.meta.dirname, "fixtures", "repo");

// ---------------------------------------------------------------------------
// splitFrontmatter
// ---------------------------------------------------------------------------

describe("splitFrontmatter", () => {
  it("parses a valid YAML frontmatter block and returns the trailing body", () => {
    const text = `---\nname: My Agent\ndescription: Does things\n---\nThis is the body.\n`;
    const { frontmatter, body } = splitFrontmatter(text);
    expect(frontmatter["name"]).toBe("My Agent");
    expect(frontmatter["description"]).toBe("Does things");
    expect(body).toContain("This is the body.");
  });

  it("returns empty frontmatter and full text as body when no --- fence", () => {
    const text = `No frontmatter here.\nJust text.`;
    const { frontmatter, body } = splitFrontmatter(text);
    expect(frontmatter).toEqual({});
    expect(body).toBe(text);
  });

  it("returns empty frontmatter and body after fence when YAML is malformed", () => {
    const text = `---\n: invalid: yaml: [\nunclosed\n---\nBody text here.`;
    expect(() => splitFrontmatter(text)).not.toThrow();
    const { frontmatter, body } = splitFrontmatter(text);
    expect(frontmatter).toEqual({});
    expect(body).toContain("Body text here.");
  });

  it("never throws on any input", () => {
    const inputs = [
      "",
      "---",
      "---\n---",
      "---\nkey: value\n---",
      "---\n{bad\n---\nbody",
      "just text",
      null as unknown as string,
    ];
    for (const input of inputs) {
      expect(() => splitFrontmatter(input ?? "")).not.toThrow();
    }
  });
});

// ---------------------------------------------------------------------------
// Per-source parsers via fixtures
// ---------------------------------------------------------------------------

describe("parseDiscoveredFile: claude-agent fixture", () => {
  it("extracts name, description, and claude engine hint", () => {
    const text = readFileSync(join(FIXTURES, ".claude/agents/security-reviewer.md"), "utf-8");
    const item = parseDiscoveredFile("claude-agent", text, ".claude/agents/security-reviewer.md");
    expect(item.kind).toBe("claude-agent");
    expect(item.name).toBe("Security Reviewer");
    expect(item.description).toMatch(/security/i);
    expect(item.engineHint).toMatch(/^claude/);
  });
});

describe("parseDiscoveredFile: hallucinate-role fixture", () => {
  it("extracts name, description, and keeps engine hint from role", () => {
    const text = readFileSync(join(FIXTURES, ".hallucinate/roles/implementer.yaml"), "utf-8");
    const item = parseDiscoveredFile("hallucinate-role", text, ".hallucinate/roles/implementer.yaml");
    expect(item.kind).toBe("hallucinate-role");
    expect(item.name).toBe("Implementer");
    expect(typeof item.description).toBe("string");
    // native roles already have known engine ids
    expect(["copilot", "acp"]).toContain(item.engineHint);
  });
});

describe("parseDiscoveredFile: copilot-agent fixture", () => {
  it("extracts name, description; missing model yields copilot engine hint", () => {
    const text = readFileSync(join(FIXTURES, ".github/agents/planner.agent.md"), "utf-8");
    const item = parseDiscoveredFile("copilot-agent", text, ".github/agents/planner.agent.md");
    expect(item.kind).toBe("copilot-agent");
    expect(item.name).toBeTruthy();
    expect(item.engineHint).toBe("copilot");
  });
});

describe("parseDiscoveredFile: copilot-chatmode fixture", () => {
  it("extracts name and yields copilot engine hint when no model specified", () => {
    const text = readFileSync(join(FIXTURES, ".github/chatmodes/legacy.chatmode.md"), "utf-8");
    const item = parseDiscoveredFile("copilot-chatmode", text, ".github/chatmodes/legacy.chatmode.md");
    expect(item.kind).toBe("copilot-chatmode");
    expect(item.name).toBeTruthy();
    expect(item.engineHint).toBe("copilot");
  });
});

describe("parseDiscoveredFile: prompt fixture", () => {
  it("extracts name and yields acp engine hint", () => {
    const text = readFileSync(join(FIXTURES, "foo.prompt.md"), "utf-8");
    const item = parseDiscoveredFile("prompt", text, "foo.prompt.md");
    expect(item.kind).toBe("prompt");
    expect(item.name).toBeTruthy();
    expect(item.engineHint).toBe("acp");
  });
});

describe("parseDiscoveredFile: claude-skill fixture", () => {
  it("extracts name and marks isSkill=true", () => {
    const text = readFileSync(join(FIXTURES, ".claude/skills/lint/SKILL.md"), "utf-8");
    const item = parseDiscoveredFile("claude-skill", text, ".claude/skills/lint/SKILL.md");
    expect(item.kind).toBe("claude-skill");
    expect(item.name).toBeTruthy();
    expect(item.isSkill).toBe(true);
    expect(item.engineHint).toMatch(/^claude/);
  });
});

describe("parseDiscoveredFile: continue-agent fixture", () => {
  it("extracts name and yields acp engine hint", () => {
    const text = readFileSync(join(FIXTURES, ".continue/agents/helper.yaml"), "utf-8");
    const item = parseDiscoveredFile("continue-agent", text, ".continue/agents/helper.yaml");
    expect(item.kind).toBe("continue-agent");
    expect(item.name).toBeTruthy();
    expect(item.engineHint).toBe("acp");
  });
});

describe("parseDiscoveredFile: cursor-rule fixture", () => {
  it("extracts name and yields acp engine hint", () => {
    const text = readFileSync(join(FIXTURES, ".cursor/rules/style.mdc"), "utf-8");
    const item = parseDiscoveredFile("cursor-rule", text, ".cursor/rules/style.mdc");
    expect(item.kind).toBe("cursor-rule");
    expect(item.name).toBeTruthy();
    expect(item.engineHint).toBe("acp");
  });
});

describe("parseDiscoveredFile: instructions fixture", () => {
  it("parses CLAUDE.md as instructions kind", () => {
    const text = readFileSync(join(FIXTURES, "CLAUDE.md"), "utf-8");
    const item = parseDiscoveredFile("instructions", text, "CLAUDE.md");
    expect(item.kind).toBe("instructions");
    expect(item.confidence).toBe("instructions");
    expect(item.body).toBeTruthy();
  });
});
