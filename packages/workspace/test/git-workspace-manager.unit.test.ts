import { describe, expect, it } from "vitest";
import { GitWorkspaceManager } from "../src/git-workspace-manager.js";
import { makeFakeGitRunner, startsWith } from "./fake-git-runner.js";

const REPO = "/repo";

function mgr(responses: Parameters<typeof makeFakeGitRunner>[0] = []) {
  const fake = makeFakeGitRunner([
    { match: startsWith("rev-parse", "HEAD"), result: { stdout: "base123\n" } },
    ...responses,
  ]);
  return { manager: new GitWorkspaceManager({ repoRoot: REPO, runner: fake.runner }), calls: fake.calls };
}

describe("GitWorkspaceManager create/cleanup/discard", () => {
  it("create: prunes, captures base, adds worktree, returns Workspace", async () => {
    const { manager, calls } = mgr();
    const ws = await manager.create("agent-1");
    expect(ws).toEqual({
      agentId: "agent-1",
      path: "/repo/.conductor/wt/agent-1",
      branch: "agent/agent-1",
    });
    // captured base then added worktree off it
    expect(calls.some((c) => c.args.join(" ") === "rev-parse HEAD")).toBe(true);
    expect(
      calls.some(
        (c) =>
          c.args[0] === "worktree" &&
          c.args[1] === "add" &&
          c.args.includes("-b") &&
          c.args.includes("agent/agent-1") &&
          c.args.includes("base123"),
      ),
    ).toBe(true);
  });

  it("cleanup: removes the worktree (force) and prunes", async () => {
    const { manager, calls } = mgr();
    await manager.create("agent-1");
    await manager.cleanup("agent-1");
    expect(
      calls.some((c) => c.args.join(" ").startsWith("worktree remove --force /repo/.conductor/wt/agent-1")),
    ).toBe(true);
  });

  it("discard: removes worktree and force-deletes the branch", async () => {
    const { manager, calls } = mgr();
    await manager.create("agent-1");
    await manager.discard("agent-1");
    expect(calls.some((c) => c.args.join(" ") === "branch -D agent/agent-1")).toBe(true);
  });

  it("create throws if the worktree was never created when diffing", async () => {
    const { manager } = mgr();
    await expect(manager.diff("missing")).rejects.toThrow("Unknown agent");
  });
});
