import { describe, expect, it } from "vitest";
import { buildArgs, cleanOutput } from "../src/args.js";
import type { Role, Task, Workspace } from "@hallucinate/core";

const task: Task = { id: "t1", description: "add caching", roleName: "Implementer" };
const workspace: Workspace = { agentId: "a1", path: "/tmp/wt/a1", branch: "agent/a1" };
const role = (model?: string): Role => ({
  name: "Implementer",
  instructions: "x",
  engine: { id: "copilot", model },
  autonomy: "yolo",
});

describe("buildArgs", () => {
  it("builds an unattended, worktree-scoped argv", () => {
    const args = buildArgs(task, workspace, role());
    expect(args[0]).toBe("-C");
    expect(args[1]).toBe("/tmp/wt/a1");
    expect(args[2]).toBe("-p");
    expect(args[3]).toContain("# Instructions");
    expect(args[3]).toContain("# Task");
    expect(args[3]).toContain("add caching");
    expect(args[4]).toBe("-s");
    expect(args[5]).toBe("--no-ask-user");
    expect(args[6]).toBe("--allow-all");
  });

  it("appends --model when the role specifies one", () => {
    const args = buildArgs(task, workspace, role("claude-sonnet-4.6"));
    expect(args[0]).toBe("-C");
    expect(args[1]).toBe("/tmp/wt/a1");
    expect(args[2]).toBe("-p");
    expect(args[3]).toContain("add caching");
    expect(args[4]).toBe("-s");
    expect(args[5]).toBe("--no-ask-user");
    expect(args[6]).toBe("--allow-all");
    expect(args[7]).toBe("--model");
    expect(args[8]).toBe("claude-sonnet-4.6");
  });

  it("omits --output-format in the default (text) mode", () => {
    expect(buildArgs(task, workspace, role())).not.toContain("--output-format");
    expect(buildArgs(task, workspace, role(), "text")).not.toContain("--output-format");
  });

  it("appends --output-format json only in json mode", () => {
    const args = buildArgs(task, workspace, role(), "json");
    expect(args[0]).toBe("-C");
    expect(args[1]).toBe("/tmp/wt/a1");
    expect(args[2]).toBe("-p");
    expect(args[3]).toContain("add caching");
    expect(args[4]).toBe("-s");
    expect(args[5]).toBe("--no-ask-user");
    expect(args[6]).toBe("--allow-all");
    expect(args[7]).toBe("--output-format");
    expect(args[8]).toBe("json");
  });

  it("keeps --model alongside --output-format json", () => {
    const args = buildArgs(task, workspace, role("gpt-5"), "json");
    expect(args).toContain("--output-format");
    expect(args).toContain("json");
    expect(args.slice(-2)).toEqual(["--model", "gpt-5"]);
  });

  it("places soul red lines before instructions before task", () => {
    const soulTask: Task = {
      id: "t1",
      description: "UNIQUETASK_sentinel",
      roleName: "Implementer",
      soulDoc: { redLines: "never leak secrets", raw: "## Red lines\nnever leak secrets" },
    };
    const richRole: Role = {
      name: "Implementer",
      instructions: "be helpful",
      engine: { id: "copilot" },
      autonomy: "yolo",
    };
    const args = buildArgs(soulTask, workspace, richRole);
    const p = args[3]!;
    const soulIdx = p.indexOf("never leak secrets");
    const instrIdx = p.indexOf("be helpful");
    const taskIdx = p.indexOf("UNIQUETASK_sentinel");
    expect(soulIdx).toBeGreaterThanOrEqual(0);
    expect(instrIdx).toBeGreaterThan(soulIdx);
    expect(taskIdx).toBeGreaterThan(instrIdx);
  });

  it("includes tool lines when role has write grants", () => {
    const toolRole: Role = {
      name: "Implementer",
      instructions: "edit files",
      engine: { id: "copilot" },
      autonomy: "yolo",
      tools: { builtins: { write: ["Edit"] } },
    };
    const args = buildArgs(task, workspace, toolRole);
    const p = args[3]!;
    expect(p).toContain("Edit (write)");
  });

  it("bare role (no soul/tools/skills) produces Instructions+Task preamble without empty section headers", () => {
    const bareRole: Role = {
      name: "Implementer",
      instructions: "do the work",
      engine: { id: "copilot" },
      autonomy: "yolo",
    };
    const args = buildArgs(task, workspace, bareRole);
    const p = args[3]!;
    expect(p).toContain("# Instructions");
    expect(p).toContain("# Task");
    expect(p).not.toContain("# Soul");
    expect(p).not.toContain("# Tools");
    expect(p).not.toContain("# Skills");
  });
});

describe("cleanOutput", () => {
  it("strips Braille spinner glyphs but keeps real text and tool annotations", () => {
    expect(cleanOutput("⠇⠋ running tests")).toBe(" running tests");
    expect(cleanOutput("● shell: npm test")).toBe("● shell: npm test");
  });
});
