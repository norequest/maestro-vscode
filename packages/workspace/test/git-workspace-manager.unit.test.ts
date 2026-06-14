import { describe, expect, it } from "vitest";
import { GitWorkspaceManager } from "../src/git-workspace-manager.js";
import type { GitRunner } from "../src/git-runner.js";
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

// ---- Task C2: isStale + rebase ----

describe("GitWorkspaceManager.isStale", () => {
  it("returns false when HEAD equals the agent's baseSha", async () => {
    const fake = makeFakeGitRunner([
      { match: startsWith("rev-parse", "HEAD"), result: { stdout: "base123\n" } },
    ]);
    const m = new GitWorkspaceManager({ repoRoot: REPO, runner: fake.runner });
    await m.create("a1");
    // HEAD still == baseSha -> not stale
    const result = await m.isStale("a1");
    expect(result).toBe(false);
    // The check must use rev-parse HEAD (not the worktree's HEAD)
    expect(fake.calls.filter((c) => c.args.join(" ") === "rev-parse HEAD" && c.cwd === REPO).length).toBeGreaterThanOrEqual(1);
  });

  it("returns true when HEAD has advanced beyond the agent's baseSha", async () => {
    let headCallCount = 0;
    const runner: GitRunner = (args, opts) => {
      if (args[0] === "rev-parse" && args[1] === "HEAD") {
        headCallCount++;
        // First call (during create) returns baseSha; subsequent calls return a new sha.
        return Promise.resolve({ stdout: headCallCount === 1 ? "base123\n" : "newsha456\n", stderr: "", exitCode: 0 });
      }
      if (args[0] === "worktree") return Promise.resolve({ stdout: "", stderr: "", exitCode: 0 });
      return Promise.resolve({ stdout: "", stderr: "", exitCode: 0 });
    };
    const m = new GitWorkspaceManager({ repoRoot: REPO, runner });
    await m.create("a1");
    const result = await m.isStale("a1");
    expect(result).toBe(true);
  });

  it("throws for an unknown agent", async () => {
    const { manager } = mgr();
    await expect(manager.isStale("unknown")).rejects.toThrow("Unknown agent");
  });
});

describe("GitWorkspaceManager.rebase", () => {
  it("clean rebase: runs git rebase HEAD in the worktree and returns { status: 'clean' }", async () => {
    const fake = makeFakeGitRunner([
      { match: startsWith("rev-parse", "HEAD"), result: { stdout: "base123\n" } },
      { match: startsWith("rebase"), result: { exitCode: 0 } },
    ]);
    const m = new GitWorkspaceManager({ repoRoot: REPO, runner: fake.runner });
    await m.create("a1");
    const result = await m.rebase("a1");
    expect(result).toEqual({ status: "clean" });
    const rebaseCall = fake.calls.find((c) => c.args[0] === "rebase");
    expect(rebaseCall).toBeDefined();
    // Must rebase onto the resolved SHA (correction: plan said "HEAD" but impl resolves to SHA)
    expect(rebaseCall!.args).toEqual(["rebase", "base123"]);
    // Must run in the worktree, not the repo root
    expect(rebaseCall!.cwd).toContain("a1");
  });

  it("conflict rebase: collects unmerged files, runs rebase --abort, returns conflict", async () => {
    const fake = makeFakeGitRunner([
      { match: startsWith("rev-parse", "HEAD"), result: { stdout: "base123\n" } },
      { match: startsWith("rebase"), result: { exitCode: 1, stderr: "CONFLICT (content)" } },
      { match: startsWith("diff", "--name-only", "--diff-filter=U"), result: { stdout: "foo.ts\n" } },
    ]);
    const m = new GitWorkspaceManager({ repoRoot: REPO, runner: fake.runner });
    await m.create("a1");
    const result = await m.rebase("a1");
    expect(result).toEqual({ status: "conflict", files: ["foo.ts"] });
    expect(fake.calls.some((c) => c.args.join(" ") === "rebase --abort")).toBe(true);
  });

  it("real failure (non-conflict): aborts and throws", async () => {
    const fake = makeFakeGitRunner([
      { match: startsWith("rev-parse", "HEAD"), result: { stdout: "base123\n" } },
      { match: startsWith("rebase"), result: { exitCode: 128, stderr: "not a git repo" } },
      // no unmerged files -> real failure path
      { match: startsWith("diff", "--name-only", "--diff-filter=U"), result: { stdout: "" } },
    ]);
    const m = new GitWorkspaceManager({ repoRoot: REPO, runner: fake.runner });
    await m.create("a1");
    await expect(m.rebase("a1")).rejects.toThrow("git rebase");
  });

  it("throws for an unknown agent", async () => {
    const { manager } = mgr();
    await expect(manager.rebase("unknown")).rejects.toThrow("Unknown agent");
  });
});

// ---- Task C3: resolveMerge ----

describe("GitWorkspaceManager.resolveMerge", () => {
  it("stages all, commits the merge, returns { status: 'clean' }", async () => {
    const fake = makeFakeGitRunner([
      { match: startsWith("rev-parse", "HEAD"), result: { stdout: "base123\n" } },
      // confirm no remaining unmerged files (simulate user already resolved them)
      { match: startsWith("diff", "--name-only", "--diff-filter=U"), result: { stdout: "" } },
    ]);
    const m = new GitWorkspaceManager({ repoRoot: REPO, runner: fake.runner });
    await m.create("a1");
    const result = await m.resolveMerge("a1");
    expect(result).toEqual({ status: "clean" });
    // Must stage all and commit --no-edit in the repo root
    expect(fake.calls.some((c) => c.args.join(" ") === "add -A" && c.cwd === REPO)).toBe(true);
    expect(fake.calls.some((c) => c.args[0] === "commit" && c.args.includes("--no-edit") && c.cwd === REPO)).toBe(true);
  });

  it("returns conflict with remaining files if user has not resolved all markers", async () => {
    const fake = makeFakeGitRunner([
      { match: startsWith("rev-parse", "HEAD"), result: { stdout: "base123\n" } },
      { match: startsWith("diff", "--name-only", "--diff-filter=U"), result: { stdout: "unresolved.ts\n" } },
    ]);
    const m = new GitWorkspaceManager({ repoRoot: REPO, runner: fake.runner });
    await m.create("a1");
    const result = await m.resolveMerge("a1");
    expect(result).toEqual({ status: "conflict", files: ["unresolved.ts"] });
    // Must NOT commit when files remain unresolved
    expect(fake.calls.some((c) => c.args[0] === "commit")).toBe(false);
  });

  it("throws for an unknown agent", async () => {
    const { manager } = mgr();
    await expect(manager.resolveMerge("unknown")).rejects.toThrow("Unknown agent");
  });
});

// ---- Task C4: pushAndPr ----

describe("GitWorkspaceManager.pushAndPr", () => {
  it("pushes the branch and runs gh pr create with expected args", async () => {
    const fake = makeFakeGitRunner([
      { match: startsWith("rev-parse", "HEAD"), result: { stdout: "base123\n" } },
      // push
      { match: startsWith("push", "origin"), result: { exitCode: 0 } },
      // gh pr create -> returns a URL
      { match: (a) => a[0] === "gh" && a[1] === "pr" && a[2] === "create", result: { stdout: "https://github.com/org/repo/pull/42\n", exitCode: 0 } },
    ]);
    const m = new GitWorkspaceManager({ repoRoot: REPO, runner: fake.runner, shellRunner: fake.runner });
    await m.create("a1");
    const result = await m.pushAndPr("a1", {
      title: "Agent: implement feature X",
      body: "Auto-generated by Maestro.",
      base: "main",
      remote: "origin",
      draft: false,
    });
    expect(result).toEqual({ prUrl: "https://github.com/org/repo/pull/42" });

    const pushCall = fake.calls.find((c) => c.args[0] === "push");
    expect(pushCall).toBeDefined();
    expect(pushCall!.args).toEqual(["push", "origin", "agent/a1"]);

    const prCall = fake.calls.find((c) => c.args[0] === "gh" && c.args[1] === "pr");
    expect(prCall).toBeDefined();
    expect(prCall!.args).toContain("--title");
    expect(prCall!.args).toContain("Agent: implement feature X");
    expect(prCall!.args).toContain("--base");
    expect(prCall!.args).toContain("main");
  });

  it("with draft: true, passes --draft to gh pr create", async () => {
    const fake = makeFakeGitRunner([
      { match: startsWith("rev-parse", "HEAD"), result: { stdout: "base123\n" } },
      { match: startsWith("push"), result: { exitCode: 0 } },
      { match: (a) => a[0] === "gh", result: { stdout: "https://github.com/org/repo/pull/99\n", exitCode: 0 } },
    ]);
    const m = new GitWorkspaceManager({ repoRoot: REPO, runner: fake.runner, shellRunner: fake.runner });
    await m.create("a1");
    await m.pushAndPr("a1", { title: "t", body: "b", base: "main", remote: "origin", draft: true });
    const prCall = fake.calls.find((c) => c.args[0] === "gh");
    expect(prCall!.args).toContain("--draft");
  });

  it("throws when push fails", async () => {
    const fake = makeFakeGitRunner([
      { match: startsWith("rev-parse", "HEAD"), result: { stdout: "base123\n" } },
      { match: startsWith("push"), result: { exitCode: 1, stderr: "remote: Permission denied" } },
    ]);
    const m = new GitWorkspaceManager({ repoRoot: REPO, runner: fake.runner, shellRunner: fake.runner });
    await m.create("a1");
    await expect(
      m.pushAndPr("a1", { title: "t", body: "b", base: "main", remote: "origin", draft: false }),
    ).rejects.toThrow("push");
  });

  it("throws for an unknown agent", async () => {
    const { manager } = mgr();
    await expect(
      manager.pushAndPr("unknown", { title: "t", body: "b", base: "main", remote: "origin", draft: false }),
    ).rejects.toThrow("Unknown agent");
  });
});
