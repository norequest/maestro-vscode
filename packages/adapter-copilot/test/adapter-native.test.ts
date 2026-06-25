import { describe, expect, it } from "vitest";
import type { Role, Task, Workspace } from "@maestro/core";
import { CopilotAdapter } from "../src/adapter.js";
import type { AgentProfileWriter } from "../src/agent-profile.js";
import { makeFakeSpawn } from "./fake-spawn.js";

const role: Role = {
  name: "Python Reviewer",
  instructions: "You are a Python specialist.",
  engine: { id: "copilot" },
  autonomy: "auto-approve-safe",
};
const task: Task = { id: "t1", description: "review cache.py", roleName: "Python Reviewer", goal: "no regressions" };
const workspace: Workspace = { agentId: "a1", path: "/tmp/wt/a1", branch: "agent/a1" };

function fakeWriter(opts: { repoHas?: boolean; throwOnWrite?: boolean } = {}): AgentProfileWriter & {
  writes: Array<{ worktreePath: string; slug: string; content: string }>;
} {
  const writes: Array<{ worktreePath: string; slug: string; content: string }> = [];
  return {
    writes,
    repoAgentExists: () => opts.repoHas ?? false,
    writeWorktreeAgent: (worktreePath, slug, content) => {
      if (opts.throwOnWrite) throw new Error("disk full");
      writes.push({ worktreePath, slug, content });
    },
  };
}

describe("CopilotAdapter native custom-agent mode", () => {
  it("spawns with --agent <slug> and sends only the task via -p", () => {
    const fake = makeFakeSpawn();
    const writer = fakeWriter();
    new CopilotAdapter({ spawn: fake.fn, agentProfile: writer }).start(task, workspace, role);

    const args = fake.lastArgs()!;
    expect(args).toContain("--agent");
    expect(args[args.indexOf("--agent") + 1]).toBe("python-reviewer");
    const prompt = args[args.indexOf("-p") + 1]!;
    expect(prompt).toContain("review cache.py");
    expect(prompt).toContain("Goal: no regressions");
    // The persona must NOT be in the -p prompt anymore; it lives in the .agent.md.
    expect(prompt).not.toContain("# Instructions");
    expect(prompt).not.toContain("You are a Python specialist");
  });

  it("materializes the agent file with frontmatter + persona", () => {
    const fake = makeFakeSpawn();
    const writer = fakeWriter();
    new CopilotAdapter({ spawn: fake.fn, agentProfile: writer }).start(task, workspace, role);

    expect(writer.writes).toHaveLength(1);
    expect(writer.writes[0]!.slug).toBe("python-reviewer");
    expect(writer.writes[0]!.content).toContain("name: python-reviewer");
    expect(writer.writes[0]!.content).toContain("You are a Python specialist.");
  });

  it("uses a committed repo agent as-is (writes nothing)", () => {
    const fake = makeFakeSpawn();
    const writer = fakeWriter({ repoHas: true });
    new CopilotAdapter({ spawn: fake.fn, agentProfile: writer }).start(task, workspace, role);

    expect(writer.writes).toHaveLength(0);
    const args = fake.lastArgs()!;
    expect(args[args.indexOf("--agent") + 1]).toBe("python-reviewer");
  });

  it("falls back to the inline preamble if the agent file cannot be written", () => {
    const fake = makeFakeSpawn();
    const writer = fakeWriter({ throwOnWrite: true });
    new CopilotAdapter({ spawn: fake.fn, agentProfile: writer }).start(task, workspace, role);

    const args = fake.lastArgs()!;
    expect(args).not.toContain("--agent");
    expect(args[2]).toBe("-p");
    expect(args[3]).toContain("# Instructions"); // legacy inline persona restored
  });

  it("preserves legacy inline behavior when no agentProfile is injected", () => {
    const fake = makeFakeSpawn();
    new CopilotAdapter({ spawn: fake.fn }).start(task, workspace, role);

    const args = fake.lastArgs()!;
    expect(args).not.toContain("--agent");
    expect(args[2]).toBe("-p");
    expect(args[3]).toContain("# Instructions");
  });
});
