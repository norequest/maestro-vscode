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

  /**
   * Split NUL-delimited git output (from `-z`) into filenames. With `-z`, git
   * disables its default path quoting/C-escaping, so paths with spaces or
   * non-ASCII bytes (e.g. Georgian filenames) come through intact. Splitting on
   * "\n" + trim() would mangle those; this splits on the NUL byte instead.
   */
  private static splitNul(out: string): string[] {
    return out.split("\u0000").filter((f) => f.length > 0);
  }

  /**
   * Collect the unmerged ("U") paths via the throwing git() helper so the
   * probe's own exit code is checked: a failed probe surfaces as an error
   * rather than silently parsing partial stdout as a conflict list. NUL-
   * delimited so non-ASCII / spaced conflict paths reach the conductor intact.
   */
  private async unmergedFiles(cwd = this.repoRoot): Promise<string[]> {
    const out = await this.git(["diff", "--name-only", "--diff-filter=U", "-z"], cwd);
    return GitWorkspaceManager.splitNul(out);
  }

  async create(agentId: string): Promise<Workspace> {
    const slug = GitWorkspaceManager.slug(agentId);
    if (slug.length === 0) {
      throw new Error(`Agent id "${agentId}" produces an empty slug and cannot be a branch name`);
    }
    // Derive the worktree dir from the SAME slug used for the branch. Using the
    // raw agentId here would let a "../"-bearing id escape the worktrees root
    // (a create-and-force-remove primitive) and risks collisions. The raw
    // agentId stays only as the in-memory map key.
    const worktreesRoot = path.join(this.repoRoot, ".conductor", "wt");
    const wtPath = path.join(worktreesRoot, slug);
    // Defense in depth: even with the slug, assert the resolved path stays
    // inside the worktrees root before handing it to `git worktree add`.
    const resolved = path.resolve(wtPath);
    if (!resolved.startsWith(path.resolve(worktreesRoot) + path.sep)) {
      throw new Error(`Agent id "${agentId}" resolves to a worktree path outside ${worktreesRoot}`);
    }
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
    // `-z` makes git emit NUL-delimited, unquoted paths so filenames with
    // spaces or non-ASCII bytes (e.g. Georgian) survive intact. Splitting on
    // "\n" + trim() over the default (quoted/escaped) output corrupts them.
    const files = GitWorkspaceManager.splitNul(
      await this.git(["diff", "--name-only", "-z", rec.baseSha, "HEAD"], rec.path),
    );
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
      const conflicted = await this.unmergedFiles();
      if (conflicted.length === 0) {
        // Non-zero exit with no unmerged paths is a real failure (bad ref, dirty
        // tree, etc.), not a content conflict. Clear any partial merge state with a
        // best-effort abort, then surface the underlying error.
        await this.bestEffortAbort(["merge", "--abort"]);
        throw new Error(`git merge ${rec.branch} failed (${attempt.exitCode}): ${attempt.stderr.trim()}`);
      }
      // Genuine conflict: abort to leave the repo clean, but do so best-effort so
      // a failing abort (e.g. an index lock) still RETURNS the conflict result
      // rather than throwing and losing the classification.
      await this.bestEffortAbort(["merge", "--abort"]);
      return { status: "conflict", files: conflicted };
    }
    await this.git(["commit", "--no-edit", "-m", `Merge ${rec.branch} via Maestro`]);
    return { status: "clean" };
  }

  /**
   * Run an abort (`merge --abort` / `rebase --abort`) via the non-throwing
   * runner so a failed abort does not mask a conflict-vs-failure classification
   * the caller has already decided. A failed abort is surfaced as a warning,
   * not an exception.
   */
  private async bestEffortAbort(args: string[], cwd = this.repoRoot): Promise<void> {
    const r = await this.runner(args, { cwd });
    if (r.exitCode !== 0) {
      console.warn(`git ${args.join(" ")} failed (${r.exitCode}): ${r.stderr.trim()}`);
    }
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
      // Probe via the throwing git() helper (in the worktree) so the probe's own
      // exit code is checked: a failed probe surfaces instead of having its
      // partial stdout misread as a conflict list.
      const conflicted = await this.unmergedFiles(rec.path);
      if (conflicted.length === 0) {
        // Non-conflict failure: abort (best-effort) and surface the real error.
        await this.bestEffortAbort(["rebase", "--abort"], rec.path);
        throw new Error(`git rebase ${newBase} failed (${attempt.exitCode}): ${attempt.stderr.trim()}`);
      }
      // Genuine conflict: best-effort abort so a failing abort still returns the
      // conflict classification rather than throwing.
      await this.bestEffortAbort(["rebase", "--abort"], rec.path);
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
    // Check whether any paths are still unmerged in the working tree. Probe via
    // the throwing git() helper so a failed probe surfaces rather than parsing
    // partial stdout as a (possibly empty) "resolved" result and committing.
    const remaining = await this.unmergedFiles(this.repoRoot);
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
    // gh may print extra lines (tips, warnings) around the PR URL. Extract the
    // last line that actually looks like a URL rather than trusting all of stdout.
    const prUrl = GitWorkspaceManager.extractPrUrl(prResult.stdout);
    if (!prUrl) {
      throw new Error(`gh pr create did not return a PR URL. Output: ${prResult.stdout.trim()}`);
    }
    return { prUrl };
  }

  /**
   * Pull the PR URL out of `gh pr create` output. gh can emit extra lines
   * (upgrade notices, hints) alongside the URL, so we scan for the LAST line
   * that is an http(s) URL and return it. Returns undefined if none is found.
   */
  private static extractPrUrl(stdout: string): string | undefined {
    const urlLine = stdout
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => /^https?:\/\/\S+$/.test(l))
      .pop();
    return urlLine;
  }

  async discard(agentId: string): Promise<void> {
    await this.teardown(agentId, true);
  }

  async cleanup(agentId: string): Promise<void> {
    await this.teardown(agentId, !this.retainBranchOnMerge);
  }

  /**
   * Remove the agent's worktree directory and prune it from git's worktree
   * list, but KEEP the local branch intact. Used after {@link pushAndPr} has
   * opened a pull request from the branch: the working tree can be cleaned up
   * while the branch must survive so the PR keeps its source ref. Unlike
   * {@link discard} (which always deletes the branch), this NEVER runs a
   * branch-deletion command. Idempotent for an unknown/already-released agent
   * (teardown is a no-op when no record exists).
   */
  async releaseWorktree(agentId: string): Promise<void> {
    await this.teardown(agentId, false);
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
