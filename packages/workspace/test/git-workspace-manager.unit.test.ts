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

  it("cleanup: removes the worktree (force), deletes the branch, and prunes", async () => {
    const { manager, calls } = mgr();
    await manager.create("agent-1");
    await manager.cleanup("agent-1");
    expect(
      calls.some((c) => c.args.join(" ").startsWith("worktree remove --force /repo/.conductor/wt/agent-1")),
    ).toBe(true);
    // cleanup also deletes the branch (symmetric with discard); lock it so a
    // future "retain branch on merge" policy change is a visible test failure.
    expect(calls.some((c) => c.args.join(" ") === "branch -D agent/agent-1")).toBe(true);
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

  it("create throws when the agent id slugs to an empty branch name", async () => {
    const { manager } = mgr();
    await expect(manager.create("!!!")).rejects.toThrow("empty slug");
  });

  it("merge: a non-zero exit with no unmerged files is a real failure, not a phantom conflict", async () => {
    const fake = makeFakeGitRunner([
      { match: startsWith("rev-parse", "HEAD"), result: { stdout: "base123\n" } },
      { match: startsWith("merge", "--no-commit"), result: { exitCode: 128, stderr: "fatal: not something we can merge" } },
      // diff --diff-filter=U returns nothing -> no real conflict
      { match: startsWith("diff", "--name-only", "--diff-filter=U"), result: { stdout: "" } },
    ]);
    const m = new GitWorkspaceManager({ repoRoot: REPO, runner: fake.runner });
    await m.create("a1");
    await expect(m.merge("a1")).rejects.toThrow("git merge agent/a1 failed (128)");
    // it attempted a best-effort abort to clear any partial state
    expect(fake.calls.some((c) => c.args.join(" ") === "merge --abort")).toBe(true);
  });

  it("diff: snapshots dirty work, then three-arg base..HEAD diff", async () => {
    const fake = makeFakeGitRunner([
      { match: startsWith("rev-parse", "HEAD"), result: { stdout: "base123\n" } },
      { match: startsWith("status", "--porcelain"), result: { stdout: " M a.ts\n" } },
      { match: startsWith("diff", "--name-only"), result: { stdout: "a.ts\n" } },
      { match: (a) => a[0] === "diff" && a[1] === "base123" && a[2] === "HEAD", result: { stdout: "PATCH" } },
    ]);
    const m = new GitWorkspaceManager({ repoRoot: REPO, runner: fake.runner });
    await m.create("a1");
    const diff = await m.diff("a1");
    expect(diff).toEqual({ files: ["a.ts"], patch: "PATCH" });
    // dirty -> add -A + commit happened before the diff
    expect(fake.calls.some((c) => c.args.join(" ") === "add -A")).toBe(true);
    expect(fake.calls.some((c) => c.args[0] === "commit")).toBe(true);
  });

  it("merge clean: --no-commit --no-ff then commit", async () => {
    const fake = makeFakeGitRunner([
      { match: startsWith("rev-parse", "HEAD"), result: { stdout: "base123\n" } },
      { match: startsWith("merge", "--no-commit"), result: { exitCode: 0 } },
    ]);
    const m = new GitWorkspaceManager({ repoRoot: REPO, runner: fake.runner });
    await m.create("a1");
    expect(await m.merge("a1")).toEqual({ status: "clean" });
    expect(fake.calls.some((c) => c.args[0] === "commit" && c.args.includes("--no-edit"))).toBe(true);
  });

  it("merge conflict: collects U files and aborts", async () => {
    const fake = makeFakeGitRunner([
      { match: startsWith("rev-parse", "HEAD"), result: { stdout: "base123\n" } },
      { match: startsWith("merge", "--no-commit"), result: { exitCode: 1, stdout: "CONFLICT" } },
      { match: startsWith("diff", "--name-only", "--diff-filter=U"), result: { stdout: "a.ts\n" } },
    ]);
    const m = new GitWorkspaceManager({ repoRoot: REPO, runner: fake.runner });
    await m.create("a1");
    expect(await m.merge("a1")).toEqual({ status: "conflict", files: ["a.ts"] });
    expect(fake.calls.some((c) => c.args.join(" ") === "merge --abort")).toBe(true);
  });
});
