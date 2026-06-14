import { describe, expect, it } from "vitest";
import { buildArgs, cleanOutput } from "../src/args.js";
import type { Role, Task, Workspace } from "@maestro/core";

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
    expect(buildArgs(task, workspace, role())).toEqual([
      "-C",
      "/tmp/wt/a1",
      "-p",
      "add caching",
      "-s",
      "--no-ask-user",
      "--allow-all",
    ]);
  });

  it("appends --model when the role specifies one", () => {
    expect(buildArgs(task, workspace, role("claude-sonnet-4.6"))).toEqual([
      "-C",
      "/tmp/wt/a1",
      "-p",
      "add caching",
      "-s",
      "--no-ask-user",
      "--allow-all",
      "--model",
      "claude-sonnet-4.6",
    ]);
  });
});

describe("cleanOutput", () => {
  it("strips Braille spinner glyphs but keeps real text and tool annotations", () => {
    expect(cleanOutput("⠇⠋ running tests")).toBe(" running tests");
    expect(cleanOutput("● shell: npm test")).toBe("● shell: npm test");
  });
});
