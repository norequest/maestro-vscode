import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { AgentProfile, Diff, MergeResult, SkillRef, Workspace } from "@maestro/core";
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
    // Derive the worktree dir and branch from the SAME slug. Using the raw
    // agentId for the path would let a "../"-bearing id escape the worktrees
    // root (a create-and-force-remove primitive). The raw agentId stays only as
    // the in-memory map key.
    const baseSlug = GitWorkspaceManager.slug(agentId);
    if (baseSlug.length === 0) {
      throw new Error(`Agent id "${agentId}" produces an empty slug and cannot be a branch name`);
    }
    const worktreesRoot = path.join(this.repoRoot, ".conductor", "wt");
    const baseSha = (await this.git(["rev-parse", "HEAD"])).trim();
    // Clear worktree registrations whose directories are already gone, so a path
    // freed by a previous session can be reused before we try to add it.
    await this.runner(["worktree", "prune"], { cwd: this.repoRoot });

    // A leftover branch or worktree from a previous session (a crash, or an agent
    // id reused across sessions because the orchestrator's counter restarts at 1)
    // must NOT hard-fail `worktree add`. Try the natural slug first, then
    // agent/<slug>-2, -3, ... on a collision. This never deletes an existing
    // branch, so no prior work is lost. A non-collision failure (bad base sha,
    // etc.) surfaces immediately rather than spinning.
    const MAX_ATTEMPTS = 50;
    let lastStderr = "";
    for (let n = 1; n <= MAX_ATTEMPTS; n++) {
      const slug = n === 1 ? baseSlug : `${baseSlug}-${n}`;
      const wtPath = path.join(worktreesRoot, slug);
      // Defense in depth: assert the resolved path stays inside the worktrees
      // root before handing it to `git worktree add`.
      const resolved = path.resolve(wtPath);
      if (!resolved.startsWith(path.resolve(worktreesRoot) + path.sep)) {
        throw new Error(`Agent id "${agentId}" resolves to a worktree path outside ${worktreesRoot}`);
      }
      const branch = `agent/${slug}`;
      const res = await this.runner(["worktree", "add", wtPath, "-b", branch, baseSha], { cwd: this.repoRoot });
      if (res.exitCode === 0) {
        this.records.set(agentId, { path: wtPath, branch, baseSha });
        return { agentId, path: wtPath, branch };
      }
      lastStderr = res.stderr.trim();
      if (!GitWorkspaceManager.isCollisionError(lastStderr)) {
        throw new Error(`git worktree add ${wtPath} failed (${res.exitCode}): ${lastStderr}`);
      }
    }
    throw new Error(
      `git worktree add could not find a free name for agent "${agentId}" after ${MAX_ATTEMPTS} attempts: ${lastStderr}`,
    );
  }

  /**
   * True when a `git worktree add` failure is a name collision (a branch or
   * worktree path that already exists), so the caller should retry with the next
   * slug. Bad-ref / dirty-tree style failures do NOT match, so they surface at
   * once instead of spinning through 50 doomed attempts.
   */
  private static isCollisionError(stderr: string): boolean {
    return /already exists|already used by worktree|already registered|is not an empty directory/i.test(stderr);
  }

  /**
   * Re-register an existing worktree after a reload. The records map is in-memory
   * and empty when a new session starts, so a hydrated agent (restored from the
   * persisted log) has no record here and merge/diff/discard would throw
   * "Unknown agent". Adoption rebuilds the record from the persisted path +
   * branch. The base sha (the fork point, needed by diff/isStale) is recovered
   * via merge-base; if that probe fails it falls back to the current HEAD.
   * Idempotent: re-adopting an already-known agent simply refreshes its record.
   */
  async adopt(agentId: string, workspace: Workspace): Promise<void> {
    let baseSha: string;
    const probe = await this.runner(["merge-base", workspace.branch, "HEAD"], { cwd: this.repoRoot });
    if (probe.exitCode === 0 && probe.stdout.trim().length > 0) {
      baseSha = probe.stdout.trim();
    } else {
      baseSha = (await this.git(["rev-parse", "HEAD"])).trim();
    }
    this.records.set(agentId, { path: workspace.path, branch: workspace.branch, baseSha });
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
   * Materialize the role's skills into the agent's worktree under TWO trees so
   * every engine family can discover them:
   *   1. `.github/skills/<name>/SKILL.md`  (PRIMARY: Copilot and VS Code read
   *      `.github`, the folder the spawned `copilot -C <worktree>` looks in)
   *   2. `.agents/skills/<name>/SKILL.md`  (KEPT: Gemini/ACP read `.agents/skills`)
   * then make both materialized skill trees invisible to git so they never
   * reach the review diff, the staging area, or the user's branch.
   *
   * The invisibility is achieved by adding two lines to the worktree's
   * `info/exclude` file (the worktree-local equivalent of `.gitignore`, but NOT
   * itself tracked or shared): `.github/skills/` and `.agents/`. We exclude
   * `.github/skills/` specifically, NOT all of `.github/`, so any other
   * `.github` content (e.g. `.github/agents` or tracked workflow files) still
   * shows up in the review diff. git status/add/diff all honor info/exclude for
   * untracked paths, so the materialized skills are present on disk for the
   * agent to read yet absent from every git operation. diff() commits via
   * `git add -A` (which respects info/exclude) and then diffs committed history,
   * so the excluded skill files can never appear there either.
   *
   * Idempotent on repeated calls: file contents are overwritten verbatim, and
   * each exclude line is appended only when an exact matching line is not
   * already present.
   */
  async writeSkills(agentId: string, skills: SkillRef[]): Promise<void> {
    const rec = this.require(agentId);
    // Ensure both skill trees are excluded BEFORE writing any files, so there is
    // no window in which a materialized tree could be picked up by a concurrent
    // git status/add. Resolve the exclude file once, then dedupe both lines.
    const excludeFile = await this.resolveExcludeFile(rec.path);
    await this.ensureExcludeLine(excludeFile, ".github/skills/");
    await this.ensureExcludeLine(excludeFile, ".agents/");
    // Skill destinations: PRIMARY .github/skills (Copilot/VS Code), KEPT
    // .agents/skills (Gemini/ACP). Same content materialized into both.
    const roots = [
      path.join(rec.path, ".github", "skills"),
      path.join(rec.path, ".agents", "skills"),
    ];
    for (const skill of skills) {
      for (const root of roots) {
        const dir = path.join(root, skill.name);
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(path.join(dir, "SKILL.md"), skill.content);
      }
    }
  }

  /**
   * Materialize the role's Copilot custom-agent profiles into the agent's
   * worktree under `.github/agents/<name>.agent.md` (the folder the spawned
   * `copilot -C <worktree>` reads its custom agents from), then make that tree
   * invisible to git so the materialized profiles never reach the review diff,
   * the staging area, or the user's branch.
   *
   * The invisibility is achieved by adding `.github/agents/` to the worktree's
   * `info/exclude` file (the worktree-local equivalent of `.gitignore`, but NOT
   * itself tracked or shared). We exclude `.github/agents/` specifically, NOT
   * all of `.github/`, so any other `.github` content (e.g. `.github/skills` or
   * tracked workflow files) still shows up in the review diff. git
   * status/add/diff all honor info/exclude for untracked paths, so the
   * materialized profiles are present on disk for the engine to read yet absent
   * from every git operation. diff() commits via `git add -A` (which respects
   * info/exclude) and then diffs committed history, so the excluded profile
   * files can never appear there either.
   *
   * Idempotent on repeated calls: file contents are overwritten verbatim, and
   * the exclude line is appended only when an exact matching line is not already
   * present.
   */
  async writeAgentProfiles(agentId: string, profiles: AgentProfile[]): Promise<void> {
    const rec = this.require(agentId);
    // Ensure the agents tree is excluded BEFORE writing any files, so there is
    // no window in which a materialized profile could be picked up by a
    // concurrent git status/add.
    const excludeFile = await this.resolveExcludeFile(rec.path);
    await this.ensureExcludeLine(excludeFile, ".github/agents/");
    // Profile destination: .github/agents/<name>.agent.md (Copilot custom agents).
    const root = path.join(rec.path, ".github", "agents");
    for (const profile of profiles) {
      await fs.mkdir(root, { recursive: true });
      await fs.writeFile(path.join(root, `${profile.name}.agent.md`), profile.content);
    }
  }

  /**
   * Resolve the worktree's git exclude file (`<gitdir>/info/exclude`). The path
   * is obtained via `git rev-parse --git-path info/exclude`, which yields the
   * per-worktree gitdir location (worktrees have their own gitdir, so this
   * scopes the rule to this agent's checkout, not the whole repo). rev-parse may
   * return a path relative to the worktree; it is resolved against the worktree
   * so reads/writes target the real file.
   */
  private async resolveExcludeFile(worktreePath: string): Promise<string> {
    const excludePath = (await this.git(["rev-parse", "--git-path", "info/exclude"], worktreePath)).trim();
    return path.isAbsolute(excludePath) ? excludePath : path.join(worktreePath, excludePath);
  }

  /**
   * Append a single exclude pattern to the worktree's info/exclude exactly once.
   * Reads the current contents and appends the line only if no exact matching
   * line exists yet, so repeated calls (and multiple patterns) never duplicate.
   * Re-reads the file per call so a line added by a prior call in the same
   * writeSkills invocation is observed before the next pattern is appended.
   */
  private async ensureExcludeLine(excludeFile: string, pattern: string): Promise<void> {
    let current = "";
    try {
      current = await fs.readFile(excludeFile, "utf8");
    } catch {
      // info/exclude may not exist yet; treat as empty and create it below.
    }
    const alreadyExcluded = current.split(/\r?\n/).some((line) => line.trim() === pattern);
    if (alreadyExcluded) return;
    await fs.mkdir(path.dirname(excludeFile), { recursive: true });
    const prefix = current.length > 0 && !current.endsWith("\n") ? "\n" : "";
    await fs.appendFile(excludeFile, `${prefix}${pattern}\n`);
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
