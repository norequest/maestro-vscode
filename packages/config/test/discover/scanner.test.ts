import { describe, it, expect } from "vitest";
import { discoverWorkspace } from "../../src/discover/scanner.js";
import type { FsScanner } from "../../src/discover/scanner.js";

// ---------------------------------------------------------------------------
// In-memory fake FsScanner
// ---------------------------------------------------------------------------

/**
 * Build an in-memory FsScanner from a flat map of absolute path -> content.
 *
 * Behavior mirrors what the node-backed FsReader does:
 * - readFile: returns content or throws if path is not in the map
 * - exists: true if path is in the map
 * - listFiles(dir, ext): returns base names of keys that start with dir + "/"
 *   and end with ext (depth 1 only, no recursive walk)
 * - listDirs(dir): returns unique immediate child dir names of keys under dir
 *   (depth 1 only)
 *
 * For simulating unreadable files: add the path to the throwSet.
 * readFile on those paths throws even though exists returns true.
 */
function makeFakeFs(
  files: Record<string, string>,
  throwSet: Set<string> = new Set(),
): FsScanner {
  return {
    async readFile(path: string): Promise<string> {
      if (throwSet.has(path)) {
        throw new Error(`EACCES: permission denied: ${path}`);
      }
      if (Object.prototype.hasOwnProperty.call(files, path)) {
        return files[path] as string;
      }
      throw new Error(`ENOENT: no such file or directory: ${path}`);
    },

    async exists(path: string): Promise<boolean> {
      return Object.prototype.hasOwnProperty.call(files, path);
    },

    async listFiles(dir: string, ext: string): Promise<string[]> {
      const prefix = dir.endsWith("/") ? dir : dir + "/";
      const result: string[] = [];
      for (const key of Object.keys(files)) {
        if (!key.startsWith(prefix)) continue;
        // Only depth-1 entries (no slash after prefix).
        const rest = key.slice(prefix.length);
        if (rest.includes("/")) continue;
        if (rest.endsWith(ext)) {
          result.push(rest);
        }
      }
      return result;
    },

    async listDirs(dir: string): Promise<string[]> {
      const prefix = dir.endsWith("/") ? dir : dir + "/";
      const seen = new Set<string>();
      for (const key of Object.keys(files)) {
        if (!key.startsWith(prefix)) continue;
        const rest = key.slice(prefix.length);
        const slash = rest.indexOf("/");
        if (slash > 0) {
          seen.add(rest.slice(0, slash));
        }
      }
      return Array.from(seen);
    },
  };
}

// ---------------------------------------------------------------------------
// Fixture content (matches the actual fixture files at test/discover/fixtures/repo)
// ---------------------------------------------------------------------------

const ROOT = "/repo";

const FIXTURE_FILES: Record<string, string> = {
  [`${ROOT}/.github/agents/planner.agent.md`]: `---
name: Planner
description: Breaks down complex tasks into subtasks and creates an implementation plan.
tools:
  - Read
  - Search
---

You are a senior technical planner. When given a task, you:
1. Analyze the existing codebase to understand patterns and constraints
2. Break the task into concrete, independently-completable subtasks
3. Identify file ownership boundaries for each subtask
4. Produce a written plan with step-by-step instructions

Output a markdown plan with one section per subtask.
`,

  [`${ROOT}/.github/chatmodes/legacy.chatmode.md`]: `---
name: Legacy Code Expert
description: Assists with understanding and modernizing legacy codebases.
---

You are an expert at working with legacy code. You excel at:
- Understanding undocumented code by reading tests and usage patterns
- Identifying safe refactoring opportunities without breaking behavior
- Explaining complex legacy patterns in plain language

When analyzing legacy code, always identify the original intent before suggesting changes.
`,

  [`${ROOT}/.claude/agents/security-reviewer.md`]: `---
name: Security Reviewer
description: Reviews code changes for security vulnerabilities and injection risks.
model: claude-sonnet-4-5
tools:
  - Read
  - Search
---

You are a senior security engineer. Your job is to review every diff for:
- SQL injection, XSS, and command injection
- Insecure deserialization
- Hardcoded secrets
- Missing authentication or authorization checks

Report findings with file:line citations and severity (critical/high/medium/low).
`,

  [`${ROOT}/.claude/skills/lint/SKILL.md`]: `---
name: lint
description: Runs the linter and reports style violations.
allowed-tools:
  - Run
---

Run the project linter and report all violations with file:line references.
If the linter is not configured, check for an ESLint, Prettier, or similar config file and run the appropriate tool.
`,

  [`${ROOT}/.conductor/roles/implementer.yaml`]: `name: Implementer
instructions: Implement the requested feature in this worktree. Write tests, make them green, then commit.
engine:
  id: copilot
autonomy: auto-approve-safe
skills:
  - run-tests
`,

  [`${ROOT}/.conductor/roles/unreadable.yaml`]: `name: Unreadable Role
instructions: This file will throw on read.
`,

  [`${ROOT}/.continue/agents/helper.yaml`]: `name: Helper
description: A general-purpose helper agent for answering questions and explaining code.
tools:
  - read_file
  - search_codebase
systemPrompt: |
  You are a helpful coding assistant. You have access to the full codebase and can answer
  questions, explain code, and help debug issues. You do NOT make changes to files.
`,

  [`${ROOT}/.cursor/rules/style.mdc`]: `---
name: Style Guide
description: Enforces the project style guide for TypeScript files.
alwaysApply: false
globs:
  - "**/*.ts"
  - "**/*.tsx"
---

When writing TypeScript:
- Use const over let when the value is not reassigned
- Prefer arrow functions for callbacks
- Always add explicit return types to exported functions
- Use early returns to reduce nesting
`,

  [`${ROOT}/CLAUDE.md`]: `# Project Instructions

This project uses TypeScript with strict mode enabled.

## Conventions

- Run \`pnpm test\` before committing
- Follow the existing patterns in each package
- Prefer editing existing files over creating new ones
`,

  [`${ROOT}/foo.prompt.md`]: `---
name: Foo Prompt
description: A sample prompt file for testing the discover pipeline.
tools:
  - Read
  - Edit
mode: agent
---

You are a general-purpose assistant. When given a task, analyze the codebase and implement the requested changes carefully.
`,

  [`${ROOT}/.mcp.json`]: JSON.stringify({
    mcpServers: {
      filesystem: {
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
        description: "Read-only filesystem access",
      },
      "code-search": {
        command: "npx",
        args: ["-y", "mcp-server-search"],
        description: "Search codebase",
      },
    },
  }),

  [`${ROOT}/.vscode/mcp.json`]: JSON.stringify({
    servers: [
      {
        name: "file-writer",
        description: "Write files to disk",
        command: "npx",
        args: ["-y", "mcp-file-writer"],
      },
      {
        name: "code-search",
        description: "Search codebase (vscode override)",
      },
    ],
  }),
};

// The unreadable.yaml path is in the fake FS but readFile will throw on it.
const THROW_SET = new Set([`${ROOT}/.conductor/roles/unreadable.yaml`]);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("discoverWorkspace", () => {
  it("discovers every fixture source kind exactly once", async () => {
    const fs = makeFakeFs(FIXTURE_FILES, THROW_SET);
    const result = await discoverWorkspace(ROOT, fs);

    const kindSet = new Set(result.items.map((i) => i.kind));
    expect(kindSet.has("claude-agent")).toBe(true);
    expect(kindSet.has("claude-skill")).toBe(true);
    expect(kindSet.has("conductor-role")).toBe(true);
    expect(kindSet.has("continue-agent")).toBe(true);
    expect(kindSet.has("cursor-rule")).toBe(true);
    expect(kindSet.has("copilot-agent")).toBe(true);
    expect(kindSet.has("copilot-chatmode")).toBe(true);
    expect(kindSet.has("instructions")).toBe(true);
    expect(kindSet.has("prompt")).toBe(true);
  });

  it("returns exactly one item per fixture file (excluding unreadable)", async () => {
    const fs = makeFakeFs(FIXTURE_FILES, THROW_SET);
    const result = await discoverWorkspace(ROOT, fs);

    // We have 9 readable items (one per kind above). unreadable.yaml is skipped.
    // CLAUDE.md -> instructions (1), planner.agent.md -> copilot-agent (1),
    // legacy.chatmode.md -> copilot-chatmode (1), security-reviewer.md -> claude-agent (1),
    // lint/SKILL.md -> claude-skill (1), implementer.yaml -> conductor-role (1),
    // helper.yaml -> continue-agent (1), style.mdc -> cursor-rule (1),
    // foo.prompt.md -> prompt (1).
    expect(result.items).toHaveLength(9);
  });

  it("populates mcp.servers from both .mcp.json and .vscode/mcp.json", async () => {
    const fs = makeFakeFs(FIXTURE_FILES, THROW_SET);
    const result = await discoverWorkspace(ROOT, fs);

    const names = result.mcp.servers.map((s) => s.name);
    // .mcp.json contributes: filesystem, code-search
    // .vscode/mcp.json contributes: file-writer (code-search already seen)
    expect(names).toContain("filesystem");
    expect(names).toContain("code-search");
    expect(names).toContain("file-writer");
    // code-search should appear only once (first-wins dedup).
    expect(names.filter((n) => n === "code-search")).toHaveLength(1);
  });

  it("pushes unreadable paths to skipped and does not throw", async () => {
    const fs = makeFakeFs(FIXTURE_FILES, THROW_SET);
    const result = await discoverWorkspace(ROOT, fs);

    expect(result.skipped).toContain(`${ROOT}/.conductor/roles/unreadable.yaml`);
  });

  it("does not include the unreadable path as a discovered item", async () => {
    const fs = makeFakeFs(FIXTURE_FILES, THROW_SET);
    const result = await discoverWorkspace(ROOT, fs);

    const sources = result.items.map((i) => i.source);
    expect(sources.every((s) => !s.includes("unreadable"))).toBe(true);
  });

  it("excludes symlinked agents (listDirs/listFiles naturally omit them)", async () => {
    // Simulate: symlinked-agent.md lives in the fake FS but listFiles for
    // .claude/agents will NOT return it (we do NOT add it to FIXTURE_FILES).
    // So we just verify no item mentions it.
    const filesWithSymlink: Record<string, string> = {
      ...FIXTURE_FILES,
      // Symlinked file: readable if directly fetched, but listFiles will not return it
      // because it's not in the normal FS map key space for that dir.
      // (In real usage, listFiles skips symlinks at OS level.)
    };

    // We add the symlinked agent to the map but craft a custom fs where
    // listFiles for .claude/agents NEVER returns the symlinked name.
    const symlinkedPath = `${ROOT}/.claude/agents/symlinked-agent.md`;
    filesWithSymlink[symlinkedPath] = "symlinked content";

    // Create a fs wrapper that filters out symlinked-agent.md from listFiles.
    const baseFs = makeFakeFs(filesWithSymlink, THROW_SET);
    const safeFsWithSymlinkOmitted: FsScanner = {
      ...baseFs,
      async listFiles(dir: string, ext: string): Promise<string[]> {
        const names = await baseFs.listFiles(dir, ext);
        return names.filter((n) => n !== "symlinked-agent.md");
      },
    };

    const result = await discoverWorkspace(ROOT, safeFsWithSymlinkOmitted);
    const sources = result.items.map((i) => i.source);
    expect(sources.every((s) => !s.includes("symlinked-agent"))).toBe(true);
  });

  it("gracefully handles completely empty workspace (no files at all)", async () => {
    const fs = makeFakeFs({});
    const result = await discoverWorkspace(ROOT, fs);
    expect(result.items).toHaveLength(0);
    expect(result.mcp.servers).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);
  });

  it("gracefully handles a workspace with only MCP config files", async () => {
    const mcpOnly: Record<string, string> = {
      [`${ROOT}/.mcp.json`]: FIXTURE_FILES[`${ROOT}/.mcp.json`] as string,
    };
    const fs = makeFakeFs(mcpOnly);
    const result = await discoverWorkspace(ROOT, fs);
    expect(result.items).toHaveLength(0);
    expect(result.mcp.servers.length).toBeGreaterThan(0);
    expect(result.skipped).toHaveLength(0);
  });

  it("claude-skill item has isSkill=true", async () => {
    const fs = makeFakeFs(FIXTURE_FILES, THROW_SET);
    const result = await discoverWorkspace(ROOT, fs);
    const skillItem = result.items.find((i) => i.kind === "claude-skill");
    expect(skillItem).toBeDefined();
    expect(skillItem!.isSkill).toBe(true);
  });

  it("non-skill items have isSkill=false", async () => {
    const fs = makeFakeFs(FIXTURE_FILES, THROW_SET);
    const result = await discoverWorkspace(ROOT, fs);
    const nonSkills = result.items.filter((i) => i.kind !== "claude-skill" && i.kind !== "plugin-skill");
    expect(nonSkills.every((i) => !i.isSkill)).toBe(true);
  });

  it("conductor-role item has correct name and engineHint", async () => {
    const fs = makeFakeFs(FIXTURE_FILES, THROW_SET);
    const result = await discoverWorkspace(ROOT, fs);
    const role = result.items.find((i) => i.kind === "conductor-role");
    expect(role).toBeDefined();
    expect(role!.name).toBe("Implementer");
    expect(role!.engineHint).toBe("copilot");
  });

  it("CLAUDE.md is parsed as instructions kind", async () => {
    const fs = makeFakeFs(FIXTURE_FILES, THROW_SET);
    const result = await discoverWorkspace(ROOT, fs);
    const instructions = result.items.find((i) => i.kind === "instructions");
    expect(instructions).toBeDefined();
    expect(instructions!.source).toContain("CLAUDE.md");
  });

  it("prompt item source ends with .prompt.md", async () => {
    const fs = makeFakeFs(FIXTURE_FILES, THROW_SET);
    const result = await discoverWorkspace(ROOT, fs);
    const prompt = result.items.find((i) => i.kind === "prompt");
    expect(prompt).toBeDefined();
    expect(prompt!.source).toMatch(/\.prompt\.md$/);
  });

  it("file-writer MCP server is flagged writeCapable", async () => {
    const fs = makeFakeFs(FIXTURE_FILES, THROW_SET);
    const result = await discoverWorkspace(ROOT, fs);
    const fileWriter = result.mcp.servers.find((s) => s.name === "file-writer");
    expect(fileWriter).toBeDefined();
    expect(fileWriter!.writeCapable).toBe(true);
  });

  it("collapses a conductor role and its Copilot agent mirror to one item", async () => {
    // The same logical agent ("implementer") exists BOTH as a canonical
    // .conductor/roles/implementer.yaml role AND as a .github/agents/implementer.agent.md
    // Copilot mirror that Maestro itself writes. Without dedup, Discover would show it twice.
    const dupFiles: Record<string, string> = {
      [`${ROOT}/.conductor/roles/implementer.yaml`]: `name: Implementer
instructions: Implement the requested feature in this worktree. Write tests, make them green, then commit.
engine:
  id: copilot
autonomy: auto-approve-safe
`,
      [`${ROOT}/.github/agents/implementer.agent.md`]: `---
name: Implementer
description: Copilot mirror of the implementer role written by Maestro.
tools:
  - Read
  - Edit
---

You implement the requested feature in this worktree, write tests, and commit.
`,
    };

    const fs = makeFakeFs(dupFiles);
    const result = await discoverWorkspace(ROOT, fs);

    const normalize = (s: string): string =>
      s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

    const implementers = result.items.filter((i) => normalize(i.name) === "implementer");
    // Exactly one survivor for the "implementer" name.
    expect(implementers).toHaveLength(1);
    // The canonical conductor role wins; the Copilot mirror was dropped.
    expect(implementers[0]!.kind).toBe("conductor-role");
    // No copilot-agent item remains for this agent.
    const copilotMirrors = result.items.filter(
      (i) => i.kind === "copilot-agent" && normalize(i.name) === "implementer",
    );
    expect(copilotMirrors).toHaveLength(0);
  });

  it("multiple unreadable files all land in skipped", async () => {
    const extraThrow = new Set([
      `${ROOT}/.conductor/roles/unreadable.yaml`,
      `${ROOT}/.continue/agents/helper.yaml`,
    ]);
    const fs = makeFakeFs(FIXTURE_FILES, extraThrow);
    const result = await discoverWorkspace(ROOT, fs);

    expect(result.skipped).toContain(`${ROOT}/.conductor/roles/unreadable.yaml`);
    expect(result.skipped).toContain(`${ROOT}/.continue/agents/helper.yaml`);
    // continue-agent kind should be absent because its only file is unreadable.
    const kindSet = new Set(result.items.map((i) => i.kind));
    expect(kindSet.has("continue-agent")).toBe(false);
  });
});
