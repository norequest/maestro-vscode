import * as path from "node:path";
import type { Diff, MergeResult, Workspace } from "@maestro/core";
import type { WorkspaceManager } from "@maestro/core";
import { nodeGitRunner, nodeShellRunner } from "./git-runner.js";
import type { GitRunner } from "./git-runner.js";

interface AgentWorktree {
  path: string;
  branch: string;
  baseSha: string;
}

export interface GitWorkspaceManagerOptions {
  repoRoot: string;
  runner?: GitRunner;
  /** Injectable for non-git shell commands (e.g. gh). Defaults to spawning the binary directly. */
  shellRunner?: GitRunner;
  /**
   * When true, the agent branch is kept after a successful merge (cleanup call).
   * The worktree is still removed. Default: false (deletes branch on cleanup).
   * Discard always deletes the branch regardless of this setting.
   */
  retainBranchOnMerge?: boolean;
}

export interface PrOptions {
  title: string;
  body: string;
  base: string;
  remote: string;
  draft: boolean;
}

export interface PrResult {
  prUrl: string;
}

export class GitWorkspaceManager implements WorkspaceManager {
  private readonly runner: GitRunner;
  private readonly shellRunner: GitRunner;
  private readonly repoRoot: string;
  private readonly retainBranchOnMerge: boolean;
  private readonly records = new Map<string, AgentWorktree>();

  constructor(opts: GitWorkspaceManagerOptions) {
    this.repoRoot = opts.repoRoot;
    this.runner = opts.runner ?? nodeGitRunner;
    this.shellRunner = opts.shellRunner ?? nodeShellRunner;
    this.retainBranchOnMerge = opts.retainBranchOnMerge ?? false;
  }

  static slug(agentId: string): string {
    return agentId.toLowerCase().replace(/[^a-z0-9.-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 50);
  }

  private require(agentId: string): AgentWorktree {
    const r = this.records.get(agentId);
    if (!r) throw new Error(`Unknown agent: ${agentId}`);
    return r;
  }

  private async git(args: string[], cwd = this.repoRoot): Promise<string> {
    const r = await this.runner(args, { cwd });
    if (r.exitCode !== 0) {
      throw new Error(`git ${args.join(" ")} failed (${r.exitCode}): ${r.stderr.trim()}`);
    }
    return r.stdout;
  }

  async create(agentId: string): Promise<Workspace> {
    const slug = GitWorkspaceManager.slug(agentId);
    if (slug.length === 0) {
      throw new Error(`Agent id "${agentId}" produces an empty slug and cannot be a branch name`);
    }
    const wtPath = path.join(this.repoRoot, ".conductor", "wt", agentId);
    const branch = `agent/${slug}`;
    const baseSha = (await this.git(["rev-parse", "HEAD"])).trim();
    await this.runner(["worktree", "prune"], { cwd: this.repoRoot });
    await this.git(["worktree", "add", wtPath, "-b", branch, baseSha]);
    this.records.set(agentId, { path: wtPath, branch, baseSha });
    return { agentId, path: wtPath, branch };
  }

  async diff(agentId: string): Promise<Diff> {
    const rec = this.require(agentId);
    // Snapshot any uncommitted agent work so the diff captures it.
    const status = await this.git(["status", "--porcelain"], rec.path);
    if (status.trim().length > 0) {
      await this.git(["add", "-A"], rec.path);
      await this.git(["commit", "-m", "maestro: agent work snapshot"], rec.path);
    }
    const files = (await this.git(["diff", "--name-only", rec.baseSha, "HEAD"], rec.path))
      .split("\n")
      .map((f) => f.trim())
      .filter(Boolean);
    const patch = await this.git(["diff", rec.baseSha, "HEAD"], rec.path);
    return { files, patch };
  }

  /**
   * Merge the agent's branch into the base. Call {@link diff} first: merge
   * operates on the committed branch HEAD only, so any uncommitted work left in
   * the worktree is captured by diff's snapshot commit, not by merge. The
   * Orchestrator computes the diff on done before a merge can be triggered, so
   * this ordering holds in the normal flow; direct callers must honor it.
   */
  async merge(agentId: string): Promise<MergeResult> {
    const rec = this.require(agentId);
    const attempt = await this.runner(["merge", "--no-commit", "--no-ff", rec.branch], { cwd: this.repoRoot });
    if (attempt.exitCode !== 0) {
      const conflicted = (await this.git(["diff", "--name-only", "--diff-filter=U"]))
        .split("\n").map((f) => f.trim()).filter(Boolean);
      if (conflicted.length === 0) {
        // Non-zero exit with no unmerged paths is a real failure (bad ref, dirty
        // tree, etc.), not a content conflict. Clear any partial merge state with a
        // best-effort abort, then surface the underlying error.
        await this.runner(["merge", "--abort"], { cwd: this.repoRoot });
        throw new Error(`git merge ${rec.branch} failed (${attempt.exitCode}): ${attempt.stderr.trim()}`);
      }
      // Genuine conflict: a merge is in progress, so abort must succeed. Use the
      // throwing helper so a stuck repo surfaces instead of being silently left mid-merge.
      await this.git(["merge", "--abort"]);
      return { status: "conflict", files: conflicted };
    }
    await this.git(["commit", "--no-edit", "-m", `Merge ${rec.branch} via Maestro`]);
    return { status: "clean" };
  }

  /**
   * Returns true if the repo's current HEAD has advanced past the SHA this
   * agent branched from. When true, call rebase() before merge() to avoid a
   * confusing "already up to date" or non-linear history.
   */
  async isStale(agentId: string): Promise<boolean> {
    const rec = this.require(agentId);
    const currentHead = (await this.git(["rev-parse", "HEAD"])).trim();
    return currentHead !== rec.baseSha;
  }

  /**
   * Rebase the agent's branch onto the current HEAD of the repo. Preserves the
   * real-conflict-vs-real-failure discrimination established in merge():
   *   - non-zero exit + unmerged --diff-filter=U files -> abort + conflict result
   *   - non-zero exit + no unmerged files -> abort + throw (real failure)
   *   - exit 0 -> update baseSha record + return { status: "clean" }
   */
  async rebase(agentId: string): Promise<MergeResult> {
    const rec = this.require(agentId);
    const newBase = (await this.git(["rev-parse", "HEAD"])).trim();
    // Run rebase inside the worktree: rebase the agent's branch commits onto newBase.
    const attempt = await this.runner(["rebase", newBase], { cwd: rec.path });
    if (attempt.exitCode !== 0) {
      const conflicted = (await this.runner(["diff", "--name-only", "--diff-filter=U"], { cwd: rec.path }))
        .stdout.split("\n").map((f) => f.trim()).filter(Boolean);
      await this.runner(["rebase", "--abort"], { cwd: rec.path });
      if (conflicted.length === 0) {
        throw new Error(`git rebase ${newBase} failed (${attempt.exitCode}): ${attempt.stderr.trim()}`);
      }
      return { status: "conflict", files: conflicted };
    }
    // Success: update the stored baseSha so subsequent isStale/diff/merge use the new base.
    this.records.set(agentId, { ...rec, baseSha: newBase });
    return { status: "clean" };
  }

  /**
   * Finish a merge after the user has resolved conflict markers. Checks for
   * any remaining unmerged paths first: if found, returns the conflict result
   * (the caller should tell the user to resolve those files too). If all
   * markers are resolved, stages everything and commits the merge.
   *
   * Intended call site: the VS Code extension calls this after the user
   * closes the merge editor and indicates resolution is complete.
   */
  async resolveMerge(agentId: string): Promise<MergeResult> {
    this.require(agentId); // throws for unknown agent
    // Check whether any paths are still unmerged in the working tree
    const remaining = (await this.runner(["diff", "--name-only", "--diff-filter=U"], { cwd: this.repoRoot }))
      .stdout.split("\n").map((f) => f.trim()).filter(Boolean);
    if (remaining.length > 0) {
      return { status: "conflict", files: remaining };
    }
    await this.git(["add", "-A"]);
    await this.git(["commit", "--no-edit", "-m", "Merge resolved via Maestro"]);
    return { status: "clean" };
  }

  /**
   * PR mode: push the agent branch to the remote and open a pull request via
   * `gh pr create`. This replaces the local merge when `maestro.prMode` is
   * enabled in settings. The shellRunner is used for `gh` so the entire
   * flow stays offline-testable with a fake runner.
   *
   * Does NOT call cleanup/discard: the worktree remains until the PR is merged
   * (or the user manually discards). The caller is responsible for calling
   * discard() after the PR is merged if branch-retention is off.
   */
  async pushAndPr(agentId: string, opts: PrOptions): Promise<PrResult> {
    const rec = this.require(agentId);
    // Push the branch to the remote
    const pushResult = await this.runner(["push", opts.remote, rec.branch], { cwd: this.repoRoot });
    if (pushResult.exitCode !== 0) {
      throw new Error(`git push ${opts.remote} ${rec.branch} failed (${pushResult.exitCode}): ${pushResult.stderr.trim()}`);
    }
    // Create the PR via gh CLI (uses shellRunner, not runner)
    const ghArgs: string[] = [
      "gh", "pr", "create",
      "--title", opts.title,
      "--body", opts.body,
      "--base", opts.base,
      "--head", rec.branch,
    ];
    if (opts.draft) ghArgs.push("--draft");
    const prResult = await this.shellRunner(ghArgs, { cwd: this.repoRoot });
    if (prResult.exitCode !== 0) {
      throw new Error(`gh pr create failed (${prResult.exitCode}): ${prResult.stderr.trim()}`);
    }
    return { prUrl: prResult.stdout.trim() };
  }

  async discard(agentId: string): Promise<void> {
    await this.teardown(agentId, true);
  }

  async cleanup(agentId: string): Promise<void> {
    await this.teardown(agentId, !this.retainBranchOnMerge);
  }

  private async teardown(agentId: string, deleteBranch: boolean): Promise<void> {
    const rec = this.records.get(agentId);
    if (!rec) return;
    await this.runner(["worktree", "remove", "--force", rec.path], { cwd: this.repoRoot });
    if (deleteBranch) {
      await this.runner(["branch", "-D", rec.branch], { cwd: this.repoRoot });
    }
    await this.runner(["worktree", "prune"], { cwd: this.repoRoot });
    this.records.delete(agentId);
  }
}
