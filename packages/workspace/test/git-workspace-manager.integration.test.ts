import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
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
