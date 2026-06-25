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

  // releaseWorktree complements the PR flow (pushAndPr): after a PR is opened
  // from the branch, the worktree directory is cleaned up and pruned from git's
  // worktree list, but the branch MUST survive so the PR keeps its source ref.
  // This is the key distinction from discard, which deletes the branch too.
  it("releaseWorktree removes the worktree (pruned) but keeps the branch", async () => {
    const m = new GitWorkspaceManager({ repoRoot: repo });
    const ws = await m.create("a1");
    expect(existsSync(ws.path)).toBe(true);
    expect(git(repo, "worktree", "list")).toContain(ws.path);

    await m.releaseWorktree("a1");

    // Worktree directory is gone from disk.
    expect(existsSync(ws.path)).toBe(false);
    // And it is no longer listed by git (pruned from the worktree list).
    expect(git(repo, "worktree", "list")).not.toContain(ws.path);
    // The branch survives (the PR still references it).
    expect(git(repo, "branch", "--list", "agent/a1")).toContain("agent/a1");
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

// ---- writeSkills: materialize skills, invisible to the review diff (real git) ----

describe("GitWorkspaceManager.writeSkills (real git)", () => {
  it("materializes each skill into BOTH .github/skills and .agents/skills with the exact content", async () => {
    const m = new GitWorkspaceManager({ repoRoot: repo });
    const ws = await m.create("a1");
    const content = "---\nname: coordinator\n---\n# Coordinator\nDo the thing.\n";
    await m.writeSkills("a1", [{ name: "coordinator", description: "coordinate", content }]);
    // PRIMARY: Copilot and VS Code read .github/skills.
    const githubPath = join(ws.path, ".github", "skills", "coordinator", "SKILL.md");
    expect(existsSync(githubPath)).toBe(true);
    expect(readFileSync(githubPath, "utf8")).toBe(content);
    // KEPT: Gemini/ACP read .agents/skills.
    const agentsPath = join(ws.path, ".agents", "skills", "coordinator", "SKILL.md");
    expect(existsSync(agentsPath)).toBe(true);
    expect(readFileSync(agentsPath, "utf8")).toBe(content);
  });

  it("materialized skills (.github/skills AND .agents/) do NOT appear in the diff, but tracked edits still do", async () => {
    const m = new GitWorkspaceManager({ repoRoot: repo });
    const ws = await m.create("a1");
    await m.writeSkills("a1", [{ name: "skA", content: "skill body A\n" }]);
    // A normal edit the agent makes that SHOULD show up in the review diff.
    writeFileSync(join(ws.path, "real.txt"), "real work\n");

    const diff = await m.diff("a1");
    // Neither materialized skill tree is visible to review.
    expect(diff.files.some((f) => f.startsWith(".github/skills/"))).toBe(false);
    expect(diff.files.some((f) => f.startsWith(".agents/"))).toBe(false);
    expect(diff.patch.includes(".github/skills/")).toBe(false);
    expect(diff.patch.includes(".agents/")).toBe(false);
    expect(diff.patch.includes("skill body A")).toBe(false);
    // The exclusion is scoped to the skill trees only: the normal edit still shows.
    expect(diff.files).toContain("real.txt");
    expect(diff.patch).toContain("real work");
  });

  it("excluding .github/skills/ does NOT hide a separate tracked file elsewhere under .github", async () => {
    // Commit a tracked file under .github that is NOT a skill, so we can prove the
    // exclusion is scoped to .github/skills/ specifically, not all of .github.
    execFileSync("mkdir", ["-p", join(repo, ".github")]);
    writeFileSync(join(repo, ".github", "keep.txt"), "keep base\n");
    git(repo, "add", ".github/keep.txt");
    git(repo, "commit", "-q", "-m", "add tracked .github/keep.txt");

    const m = new GitWorkspaceManager({ repoRoot: repo });
    const ws = await m.create("a1");
    await m.writeSkills("a1", [{ name: "skA", content: "skill body A\n" }]);
    // Edit the tracked, non-skills file under .github in the worktree.
    writeFileSync(join(ws.path, ".github", "keep.txt"), "keep edited\n");

    const diff = await m.diff("a1");
    // The skill tree under .github/skills is still hidden ...
    expect(diff.files.some((f) => f.startsWith(".github/skills/"))).toBe(false);
    // ... but the tracked, non-skills .github file edit DOES appear.
    expect(diff.files).toContain(".github/keep.txt");
    expect(diff.patch).toContain("keep edited");
  });

  it("calling writeSkills twice does not duplicate the .agents/ or .github/skills/ lines in info/exclude", async () => {
    const m = new GitWorkspaceManager({ repoRoot: repo });
    const ws = await m.create("a1");
    await m.writeSkills("a1", [{ name: "s1", content: "one\n" }]);
    await m.writeSkills("a1", [{ name: "s2", content: "two\n" }]);
    const excludePath = git(ws.path, "rev-parse", "--git-path", "info/exclude").trim();
    const resolved = excludePath.startsWith("/") ? excludePath : join(ws.path, excludePath);
    const allLines = readFileSync(resolved, "utf8").split(/\r?\n/);
    expect(allLines.filter((l) => l.trim() === ".agents/").length).toBe(1);
    expect(allLines.filter((l) => l.trim() === ".github/skills/").length).toBe(1);
  });

  it("throws for an unknown agentId", async () => {
    const m = new GitWorkspaceManager({ repoRoot: repo });
    await expect(m.writeSkills("nope", [{ name: "s", content: "x\n" }])).rejects.toThrow(/unknown agent/i);
  });
});

// ---- writeAgentProfiles: materialize profiles, invisible to the review diff (real git) ----

describe("GitWorkspaceManager.writeAgentProfiles (real git)", () => {
  it("materializes each profile into .github/agents/<name>.agent.md with the exact content", async () => {
    const m = new GitWorkspaceManager({ repoRoot: repo });
    const ws = await m.create("a1");
    const content = "---\nname: scribe\n---\n# Scribe\nWrite the notes.\n";
    await m.writeAgentProfiles("a1", [{ name: "scribe", content }]);
    const profilePath = join(ws.path, ".github", "agents", "scribe.agent.md");
    expect(existsSync(profilePath)).toBe(true);
    expect(readFileSync(profilePath, "utf8")).toBe(content);
  });

  it("materialized agent profiles (.github/agents/) do NOT appear in the diff, but tracked edits still do", async () => {
    const m = new GitWorkspaceManager({ repoRoot: repo });
    const ws = await m.create("a1");
    await m.writeAgentProfiles("a1", [{ name: "scribe", content: "scribe body\n" }]);
    // A normal edit the agent makes that SHOULD show up in the review diff.
    writeFileSync(join(ws.path, "real.txt"), "real work\n");

    const diff = await m.diff("a1");
    // The materialized profile tree is invisible to review.
    expect(diff.files.some((f) => f.startsWith(".github/agents/"))).toBe(false);
    expect(diff.patch.includes(".github/agents/")).toBe(false);
    expect(diff.patch.includes("scribe body")).toBe(false);
    // The exclusion is scoped to the agents tree only: the normal edit still shows.
    expect(diff.files).toContain("real.txt");
    expect(diff.patch).toContain("real work");
  });

  it("excluding .github/agents/ does NOT hide a separate tracked file elsewhere under .github", async () => {
    // Commit a tracked file under .github that is NOT an agent profile, so we can
    // prove the exclusion is scoped to .github/agents/ specifically, not all of
    // .github.
    execFileSync("mkdir", ["-p", join(repo, ".github")]);
    writeFileSync(join(repo, ".github", "keep.txt"), "keep base\n");
    git(repo, "add", ".github/keep.txt");
    git(repo, "commit", "-q", "-m", "add tracked .github/keep.txt");

    const m = new GitWorkspaceManager({ repoRoot: repo });
    const ws = await m.create("a1");
    await m.writeAgentProfiles("a1", [{ name: "scribe", content: "scribe body\n" }]);
    // Edit the tracked, non-agents file under .github in the worktree.
    writeFileSync(join(ws.path, ".github", "keep.txt"), "keep edited\n");

    const diff = await m.diff("a1");
    // The agents tree under .github/agents is still hidden ...
    expect(diff.files.some((f) => f.startsWith(".github/agents/"))).toBe(false);
    // ... but the tracked, non-agents .github file edit DOES appear.
    expect(diff.files).toContain(".github/keep.txt");
    expect(diff.patch).toContain("keep edited");
  });

  it("calling writeAgentProfiles twice does not duplicate the .github/agents/ line in info/exclude", async () => {
    const m = new GitWorkspaceManager({ repoRoot: repo });
    const ws = await m.create("a1");
    await m.writeAgentProfiles("a1", [{ name: "p1", content: "one\n" }]);
    await m.writeAgentProfiles("a1", [{ name: "p2", content: "two\n" }]);
    const excludePath = git(ws.path, "rev-parse", "--git-path", "info/exclude").trim();
    const resolved = excludePath.startsWith("/") ? excludePath : join(ws.path, excludePath);
    const allLines = readFileSync(resolved, "utf8").split(/\r?\n/);
    expect(allLines.filter((l) => l.trim() === ".github/agents/").length).toBe(1);
  });

  it("throws for an unknown agentId", async () => {
    const m = new GitWorkspaceManager({ repoRoot: repo });
    await expect(m.writeAgentProfiles("nope", [{ name: "p", content: "x\n" }])).rejects.toThrow(/unknown agent/i);
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
