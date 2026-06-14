import * as path from "node:path";
import type { Diff, MergeResult, Workspace } from "@maestro/core";
import type { WorkspaceManager } from "@maestro/core";
import { nodeGitRunner } from "./git-runner.js";
import type { GitRunner } from "./git-runner.js";

interface AgentWorktree {
  path: string;
  branch: string;
  baseSha: string;
}

export interface GitWorkspaceManagerOptions {
  repoRoot: string;
  runner?: GitRunner;
}

export class GitWorkspaceManager implements WorkspaceManager {
  private readonly runner: GitRunner;
  private readonly repoRoot: string;
  private readonly records = new Map<string, AgentWorktree>();

  constructor(opts: GitWorkspaceManagerOptions) {
    this.repoRoot = opts.repoRoot;
    this.runner = opts.runner ?? nodeGitRunner;
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

  async discard(agentId: string): Promise<void> {
    await this.teardown(agentId, true);
  }

  async cleanup(agentId: string): Promise<void> {
    await this.teardown(agentId, true);
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
