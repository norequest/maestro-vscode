import { describe, expect, it } from "vitest";
import type { Role, Task } from "@maestro/core";
import {
  type AgentProfileWriter,
  buildAgentProfile,
  ensureCopilotAgent,
  mapToolsToCopilot,
  slugForRole,
} from "../src/agent-profile.js";

const baseRole: Role = {
  name: "Python Reviewer",
  instructions: "You are a Python specialist. Review for PEP 8 and type hints.",
  engine: { id: "copilot" },
  autonomy: "auto-approve-safe",
};
const baseTask: Task = { id: "t1", description: "review cache.py", roleName: "Python Reviewer" };

describe("slugForRole", () => {
  it("lowercases and hyphenates", () => {
    expect(slugForRole("Python Reviewer")).toBe("python-reviewer");
    expect(slugForRole("  Security Expert!! ")).toBe("security-expert");
  });
  it("falls back when the name has no slug-able characters", () => {
    expect(slugForRole("***")).toBe("maestro-agent");
  });
});

describe("mapToolsToCopilot", () => {
  it("returns undefined when no grants are declared (Copilot defaults to all)", () => {
    expect(mapToolsToCopilot(undefined)).toBeUndefined();
    expect(mapToolsToCopilot({})).toBeUndefined();
  });
  it("maps a read-only role to read/search", () => {
    expect(mapToolsToCopilot({ builtins: { read: ["Read", "Search"] } })).toEqual(["read", "search"]);
  });
  it("maps write grants: Edit->edit, Run/Git->execute, in stable order", () => {
    expect(
      mapToolsToCopilot({ builtins: { read: ["Read"], write: ["Edit", "Run", "Git"] } }),
    ).toEqual(["read", "edit", "execute"]);
  });
});

describe("buildAgentProfile", () => {
  it("emits frontmatter with slug name and a derived description", () => {
    const md = buildAgentProfile(baseRole, baseTask);
    expect(md.startsWith("---\n")).toBe(true);
    expect(md).toContain("name: python-reviewer");
    expect(md).toContain('description: "You are a Python specialist."');
  });
  it("puts the persona (instructions, soul identity) in the body, NOT the task", () => {
    const task: Task = {
      ...baseTask,
      soulDoc: { identity: "A meticulous reviewer.", raw: "" },
      skills: [
        {
          name: "lint-first",
          description: "Run the linter before reviewing.",
          content: "Always run the linter first.",
        },
      ],
    };
    const md = buildAgentProfile(baseRole, task);
    expect(md).toContain("# Instructions");
    expect(md).toContain("Review for PEP 8");
    expect(md).toContain("## Identity");
    expect(md).toContain("A meticulous reviewer.");
    // Skills are a lightweight pointer block now, not inlined bodies.
    expect(md).toContain("# Skills (available, load when relevant)");
    expect(md).toContain("- lint-first: Run the linter before reviewing.");
    // The skill BODY is delivered as a discoverable file, NOT inlined here.
    expect(md).not.toContain("Always run the linter first.");
    // The task is delivered via -p, so it must NOT be baked into the agent file.
    expect(md).not.toContain("# Task");
    expect(md).not.toContain("review cache.py");
  });
  it("emits a tools list only when the role declares grants", () => {
    expect(buildAgentProfile(baseRole, baseTask)).not.toContain("tools:");
    const scoped: Role = { ...baseRole, tools: { builtins: { read: ["Read"], write: ["Edit"] } } };
    expect(buildAgentProfile(scoped, baseTask)).toContain('tools: ["read", "edit"]');
  });
});

/** In-memory writer that records calls (with the worktree path) and lets a test
 *  simulate an already-present worktree agent. */
function fakeWriter(opts: { repoHas?: boolean } = {}): AgentProfileWriter & {
  writes: Array<{ worktreePath: string; slug: string; content: string }>;
} {
  const writes: Array<{ worktreePath: string; slug: string; content: string }> = [];
  return {
    writes,
    repoAgentExists: () => opts.repoHas ?? false,
    writeWorktreeAgent: (worktreePath, slug, content) => {
      writes.push({ worktreePath, slug, content });
    },
  };
}

describe("ensureCopilotAgent (the mix)", () => {
  it("writes into the worktree .github/agents and returns the slug when no agent exists", () => {
    const w = fakeWriter();
    const slug = ensureCopilotAgent(w, "/tmp/wt/a1", baseRole, baseTask);
    expect(slug).toBe("python-reviewer");
    expect(w.writes).toHaveLength(1);
    expect(w.writes[0]!.worktreePath).toBe("/tmp/wt/a1");
    expect(w.writes[0]!.slug).toBe("python-reviewer");
    expect(w.writes[0]!.content).toContain("name: python-reviewer");
  });
  it("uses an already-present worktree agent as-is, writing nothing (no diff pollution)", () => {
    const w = fakeWriter({ repoHas: true });
    const slug = ensureCopilotAgent(w, "/tmp/wt/a1", baseRole, baseTask);
    expect(slug).toBe("python-reviewer");
    expect(w.writes).toHaveLength(0);
  });
});
