import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitWorkspaceManager } from "../src/git-workspace-manager.js";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

let repo: string;
beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "maestro-ws-"));
  // Pin the initial branch name so the test is hermetic regardless of
  // the user's global init.defaultBranch setting (or lack thereof).
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "t@t.com");
  git(repo, "config", "user.name", "T");
  writeFileSync(join(repo, "file.txt"), "line1\n");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "init");
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe("GitWorkspaceManager (real git)", () => {
  it("create makes an isolated worktree + branch; cleanup removes it", async () => {
    const m = new GitWorkspaceManager({ repoRoot: repo });
    const ws = await m.create("a1");
    expect(existsSync(ws.path)).toBe(true);
    expect(git(repo, "branch", "--list", "agent/a1")).toContain("agent/a1");
    await m.cleanup("a1");
    expect(existsSync(ws.path)).toBe(false);
    expect(git(repo, "branch", "--list", "agent/a1").trim()).toBe("");
  });

  it("diff captures the agent's edits (committed or not)", async () => {
    const m = new GitWorkspaceManager({ repoRoot: repo });
    const ws = await m.create("a1");
    writeFileSync(join(ws.path, "new.txt"), "hello\n"); // uncommitted in the worktree
    const diff = await m.diff("a1");
    expect(diff.files).toContain("new.txt");
    expect(diff.patch).toContain("hello");
  });

  // Issue 7 (WS5): git quotes/C-escapes paths with spaces or non-ASCII bytes by
  // default. diff() must use -z (NUL-delimited) so the real filename reaches the
  // conductor's review surface intact, not a quoted/escaped mangling.
  it("diff returns spaced and non-ASCII (Georgian) filenames intact, not quoted/escaped", async () => {
    const m = new GitWorkspaceManager({ repoRoot: repo });
    const ws = await m.create("a1");
    const spaced = "with space.txt";
    const georgian = "ფაილი.txt"; // "file" in Georgian
    writeFileSync(join(ws.path, spaced), "a\n");
    writeFileSync(join(ws.path, georgian), "b\n");
    const diff = await m.diff("a1");
    // Exact names, no surrounding quotes and no \xxx / octal escaping.
    expect(diff.files).toContain(spaced);
    expect(diff.files).toContain(georgian);
    for (const f of diff.files) {
      expect(f.startsWith('"')).toBe(false);
      expect(f.includes("\\")).toBe(false);
    }
  });

  it("clean merge applies the agent's work to the base branch", async () => {
    const m = new GitWorkspaceManager({ repoRoot: repo });
    const ws = await m.create("a1");
    writeFileSync(join(ws.path, "added.txt"), "x\n");
    await m.diff("a1"); // snapshots the commit
    const result = await m.merge("a1");
    expect(result).toEqual({ status: "clean" });
    expect(existsSync(join(repo, "added.txt"))).toBe(true);
  });

  it("conflict merge reports the conflicted file and leaves the repo clean", async () => {
    // base advances on the same line the agent also edits -> conflict
    const m = new GitWorkspaceManager({ repoRoot: repo });
    const ws = await m.create("a1");
    writeFileSync(join(ws.path, "file.txt"), "agent-change\n");
    await m.diff("a1");
    // advance base on the same line
    writeFileSync(join(repo, "file.txt"), "base-change\n");
    git(repo, "commit", "-q", "-am", "base edit");
    const result = await m.merge("a1");
    expect(result.status).toBe("conflict");
    if (result.status === "conflict") expect(result.files).toContain("file.txt");
    // repo has no merge in progress after abort (MERGE_HEAD must not exist).
    // Note: the .conductor/ directory may remain as an untracked entry in the
    // working tree; that is normal and harmless. We filter it out and assert
    // there are no staged/conflict lines (lines NOT starting with "??").
    const porcelain = git(repo, "status", "--porcelain")
      .split("\n")
      .filter((l) => l.trim().length > 0 && !l.startsWith("??"))
      .join("\n");
    expect(porcelain).toBe("");
  });

  it("discard removes the worktree and the branch", async () => {
    const m = new GitWorkspaceManager({ repoRoot: repo });
    const ws = await m.create("a1");
    await m.discard("a1");
    expect(existsSync(ws.path)).toBe(false);
    expect(git(repo, "branch", "--list", "agent/a1").trim()).toBe("");
  });
});

// ---- Task C2: isStale + rebase (real git) ----

describe("GitWorkspaceManager isStale + rebase (real git)", () => {
  it("isStale: false when HEAD has not moved, true after a new commit on the base", async () => {
    const m = new GitWorkspaceManager({ repoRoot: repo });
    await m.create("a1");
    expect(await m.isStale("a1")).toBe(false);
    // Advance the base branch
    writeFileSync(join(repo, "base-advance.txt"), "base\n");
    git(repo, "add", ".");
    git(repo, "commit", "-q", "-m", "base advance");
    expect(await m.isStale("a1")).toBe(true);
  });

  it("rebase clean: agent branch gets the new base commit, merge then succeeds without a base-drift conflict", async () => {
    const m = new GitWorkspaceManager({ repoRoot: repo });
    const ws = await m.create("a1");
    // Agent adds a file
    writeFileSync(join(ws.path, "agent.txt"), "agent\n");
    await m.diff("a1"); // snapshot commit

    // Base advances on a different file (no content conflict)
    writeFileSync(join(repo, "base.txt"), "base\n");
    git(repo, "add", ".");
    git(repo, "commit", "-q", "-m", "base advance");

    expect(await m.isStale("a1")).toBe(true);
    const rebaseResult = await m.rebase("a1");
    expect(rebaseResult).toEqual({ status: "clean" });
    expect(await m.isStale("a1")).toBe(false); // baseSha updated

    // Now a standard merge should still succeed
    const mergeResult = await m.merge("a1");
    expect(mergeResult).toEqual({ status: "clean" });
  });

  it("rebase conflict: reports the conflicted file and leaves the worktree clean", async () => {
    const m = new GitWorkspaceManager({ repoRoot: repo });
    const ws = await m.create("a1");
    // Agent edits same line
    writeFileSync(join(ws.path, "file.txt"), "agent-change\n");
    await m.diff("a1");

    // Base edits the same line
    writeFileSync(join(repo, "file.txt"), "base-change\n");
    git(repo, "commit", "-q", "-am", "base edits file");

    const result = await m.rebase("a1");
    expect(result.status).toBe("conflict");
    if (result.status === "conflict") expect(result.files).toContain("file.txt");
    // worktree not stuck mid-rebase
    const status = git(ws.path, "status", "--porcelain").trim();
    expect(status).toBe("");
  });
});

// ---- Task C3: resolveMerge (real git) ----

describe("GitWorkspaceManager.resolveMerge (real git)", () => {
  it("after manual resolution, commits the merge and returns clean", async () => {
    const m = new GitWorkspaceManager({ repoRoot: repo });
    const ws = await m.create("a1");
    // Agent edits same line as base to create a conflict
    writeFileSync(join(ws.path, "file.txt"), "agent-change\n");
    await m.diff("a1");
    writeFileSync(join(repo, "file.txt"), "base-change\n");
    git(repo, "commit", "-q", "-am", "base edit");

    // Attempt merge -> conflict
    const conflictResult = await m.merge("a1");
    expect(conflictResult.status).toBe("conflict");

    // Simulate the user resolving the conflict: overwrite with a resolution,
    // then stage it.
    writeFileSync(join(repo, "file.txt"), "resolved\n");
    git(repo, "add", "file.txt");

    // resolveMerge should now commit successfully
    const cleanResult = await m.resolveMerge("a1");
    expect(cleanResult).toEqual({ status: "clean" });
    // The resolved content is in the repo
    const content = readFileSync(join(repo, "file.txt"), "utf8");
    expect(content.trim()).toBe("resolved");
  });
});
