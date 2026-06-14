# Maestro M9: Merge Robustness

> ⚠ **RECONCILE FIRST.** Authored in parallel with M5/M6/M7/M8. Before executing, apply the cross-plan deltas in `2026-06-14-maestro-m5-m9-roadmap.md` → "Reconciliation Addendum", especially **R2** (adding `"merge-cleanup-failed"` breaks the exhaustive `cardIcon()`/`actions()` switches and `needsAttention()` — extend all three), **R3** (apply your `render.ts` changes as a PATCH on top of M6's rewrite, not a fresh rewrite from `main`), and **R4** (your `merge()` rewrite must keep M7's `"detached"` case in the guard).

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Date:** 2026-06-14
**Branch:** `m9-merge-robustness` (branch off `main`)
**Goal:** Make merge production-grade. Six sub-goals: (a) serialized-merge mutex in the orchestrator; (b) stale-base detection + rebase in `GitWorkspaceManager`; (c) conflict-resolve-in-editor: open conflicted files in VS Code's merge editor and finish on resolution; (d) PR/remote-merge mode: push branch + `gh pr create` instead of a local merge; (e) branch-retention policy; (f) close M3's half-applied-state risk where `cleanup` rejects after a clean merge.

**Architecture:**
All git goes through the injectable `GitRunner` (established in M3) so every logic path is unit-tested against a fake runner asserting exact arg arrays. Real git only in clearly-separated integration tests against throwaway repos. The PR-mode `gh` binary is wrapped behind the same `GitRunner` type (or a second injectable `ShellRunner`) so it too stays offline-testable. Extension-side code follows the M4 `pure/vscode` file-split discipline: new logic lives in vscode-free helpers (`render.ts`, a new `merge-helpers.ts`) unit-tested under Vitest, and thin glue lives in `extension.ts` verified by build + typecheck only.

**Tech Stack:** TypeScript (ESM, NodeNext, strict + noUncheckedIndexedAccess), Vitest, pnpm workspace, `node:child_process`, VS Code API (`vscode.commands.executeCommand`, `vscode.window.showInformationMessage`). No new dependencies.

---

## Upstream assumptions / contract

M9 is independent of M5, M6, M7, M8 per the shared roadmap. It touches shared files only additively:

- `packages/core/src/orchestrator.ts`: M9 adds a private `mergeLock` promise-chain (not a new method signature). M6 adds `sendBack`. M7 adds `hydrate`. None of these conflict; each is a distinct private field or new public method.
- `packages/extension/src/render.ts`: M6 adds approve/steer/send-back controls; M9 adds conflict-resolve button. Both are additive inside the existing `actions()` and `detail()` functions.
- `packages/extension/src/webview/main.ts`: M6 adds approve/steer handlers; M9 adds `resolve-conflict` and `pr-mode` handlers. All additive inside the existing click handler.
- `packages/extension/src/extension.ts` `activate()`: M9 adds a `resolveConflict` command registration alongside the existing commands. Strictly additive.
- `packages/workspace/src/git-workspace-manager.ts`: M9 adds four new public methods (`isStale`, `rebase`, `resolveMerge`, `pushAndPr`) and one private option (`retainBranch`). No existing method signatures change.
- `packages/workspace/src/index.ts`: M9 re-exports the new method signatures (all additive).

The M9 plan does NOT assume M6, M7, or M8 are already merged. All its deltas compile against the current `main` baseline.

---

## File Structure (additive deltas only)

```
packages/
  workspace/
    src/
      git-workspace-manager.ts   MODIFY: add isStale, rebase, resolveMerge, pushAndPr,
                                          GitWorkspaceMergeOptions on the constructor,
                                          retainBranch in teardown
      index.ts                   MODIFY: re-export new types (MergeOptions, PrResult)
    test/
      git-workspace-manager.unit.test.ts      MODIFY: add unit tests for new methods
      git-workspace-manager.integration.test.ts  MODIFY: add real-git tests for isStale/rebase
      orchestrator-e2e.integration.test.ts    MODIFY: extend e2e for stale+rebase path
  core/
    src/
      orchestrator.ts            MODIFY: add mergeLock queue + harden merge->cleanup boundary
    test/
      orchestrator.merge.test.ts  MODIFY: add mutex ordering test + cleanup-failure recovery test
  extension/
    src/
      render.ts                  MODIFY: conflict-resolve button + PR-mode button in actions()
      merge-helpers.ts           NEW: pure, vscode-free helpers for conflict-resolve flow
                                      (resolveConflictFiles, buildPrModeMessage) — unit-tested
      extension.ts               MODIFY: register maestro.resolveConflict command + pr-mode config read
      webview/
        main.ts                  MODIFY: handle resolve-conflict + pr-mode click actions
    test/
      merge-helpers.test.ts      NEW: unit tests for merge-helpers.ts
      render.test.ts             NEW: unit tests for the new render.ts button cases
```

---

## Task C1: Serialized-merge mutex in `Orchestrator`

**Goal:** Ensure concurrent calls to `orch.merge()` serialize (one at a time). The second call does not begin its `ws.merge()` until the first has completed and transitioned state.

**Files:** `packages/core/src/orchestrator.ts` (add private `mergeLock`); `packages/core/test/orchestrator.merge.test.ts` (extend).

### Step 1: Write failing ordering test

Append to `packages/core/test/orchestrator.merge.test.ts`:

```ts
// ---- Task C1: mutex ordering ----

describe("Orchestrator merge mutex (serialization)", () => {
  it("serializes two near-simultaneous merge calls, second waits for first", async () => {
    const order: string[] = [];

    // A fake WorkspaceManager where merge() records entry/exit order
    class OrderedFakeManager extends FakeWorkspaceManager {
      override async merge(agentId: string): Promise<MergeResult> {
        order.push(`start:${agentId}`);
        // yield microtask so both merges have a chance to interleave if unguarded
        await new Promise<void>((r) => setTimeout(r, 0));
        order.push(`end:${agentId}`);
        return super.merge(agentId);
      }
    }

    const manager = new OrderedFakeManager();
    // Give each agent a scripted clean result
    manager.setMergeResult("agent-1", { status: "clean" });
    manager.setMergeResult("agent-2", { status: "clean" });

    const orch = new Orchestrator({ maxParallelAgents: 2 }, manager);
    orch.registerRole(role);
    orch.registerAdapter(new FakeEngineAdapter({ script: [{ kind: "done", summary: "ok" }] }));

    // Spawn two agents and wait for both to reach "done"
    const a1 = orch.spawn("Impl", "task 1");
    const a2 = orch.spawn("Impl", "task 2");
    await waitFor(orch, a1.id, "done");
    await waitFor(orch, a2.id, "done");

    // Fire both merges without awaiting the first
    const p1 = orch.merge(a1.id);
    const p2 = orch.merge(a2.id);
    await Promise.all([p1, p2]);

    // The two merges must not overlap: end of first before start of second
    const firstEnd = order.indexOf(`end:${a1.id}`) !== -1
      ? order.indexOf(`end:${a1.id}`)
      : order.indexOf(`end:${a2.id}`);
    const secondStart = firstEnd === order.indexOf(`end:${a1.id}`)
      ? order.indexOf(`start:${a2.id}`)
      : order.indexOf(`start:${a1.id}`);
    expect(secondStart).toBeGreaterThan(firstEnd);
  });
});
```

Run: `cd packages/core && pnpm vitest run test/orchestrator.merge.test.ts` -> FAIL (no mutex yet).

### Step 2: Add half-applied-state test

Also append to `packages/core/test/orchestrator.merge.test.ts`:

```ts
describe("Orchestrator merge -> cleanup failure recovery", () => {
  it("leaves the agent in 'merge-cleanup-failed' state when cleanup rejects after a clean merge", async () => {
    class FailingCleanupManager extends FakeWorkspaceManager {
      override async cleanup(_agentId: string): Promise<void> {
        throw new Error("cleanup disk full");
      }
    }
    const manager = new FailingCleanupManager();
    manager.setMergeResult("agent-1", { status: "clean" });
    const orch = new Orchestrator({ maxParallelAgents: 1 }, manager);
    orch.registerRole(role);
    orch.registerAdapter(new FakeEngineAdapter({ script: [{ kind: "done", summary: "ok" }] }));

    const agent = orch.spawn("Impl", "task");
    await waitFor(orch, agent.id, "done");

    // merge() must not throw; it should resolve with { status: "clean" } but the
    // agent state must be "merge-cleanup-failed", not "merged" or "done".
    const result = await orch.merge(agent.id);
    expect(result).toEqual({ status: "clean" });
    expect(orch.getAgent(agent.id)!.state).toBe("merge-cleanup-failed");
    // The failure detail is surfaced on the agent
    expect(orch.getAgent(agent.id)!.error).toContain("cleanup disk full");
  });

  it("retryCleanup transitions from merge-cleanup-failed to merged", async () => {
    class FailThenSucceedManager extends FakeWorkspaceManager {
      private attempt = 0;
      override async cleanup(_agentId: string): Promise<void> {
        this.attempt++;
        if (this.attempt === 1) throw new Error("disk full");
        // second call succeeds (default no-op in FakeWorkspaceManager)
      }
    }
    const manager = new FailThenSucceedManager();
    manager.setMergeResult("agent-1", { status: "clean" });
    const orch = new Orchestrator({ maxParallelAgents: 1 }, manager);
    orch.registerRole(role);
    orch.registerAdapter(new FakeEngineAdapter({ script: [{ kind: "done", summary: "ok" }] }));

    const agent = orch.spawn("Impl", "task");
    await waitFor(orch, agent.id, "done");
    await orch.merge(agent.id); // -> merge-cleanup-failed

    await orch.retryCleanup(agent.id);
    expect(orch.getAgent(agent.id)!.state).toBe("merged");
    expect(orch.getAgent(agent.id)!.error).toBeUndefined();
  });
});
```

Run: `cd packages/core && pnpm vitest run test/orchestrator.merge.test.ts` -> FAIL (no new state/method).

### Step 3: Add `"merge-cleanup-failed"` to `AgentState` in `packages/core/src/types.ts`

This is additive, just like M3 added `"conflict"`. Add it after `"conflict"`:

```ts
export type AgentState =
  | "preparing"
  | "working"
  | "awaiting-approval"
  | "done"
  | "error"
  | "stopped"
  | "merged"
  | "discarded"
  | "conflict"
  | "merge-cleanup-failed";
```

Run: `pnpm --filter @maestro/core build` -> clean (no exhaustive switch breaks because M3 established Set-based `isTerminalState`).

Also add `"merge-cleanup-failed"` to the `isTerminalState` Set in `packages/core/src/events.ts`:

```ts
// existing line, just add the new member:
const TERMINAL: ReadonlySet<AgentState> = new Set([
  "done", "error", "stopped", "merged", "discarded", "merge-cleanup-failed",
]);
```

Note: `"merge-cleanup-failed"` IS terminal (the merge succeeded; the worktree may be orphaned but the code is landed). The agent is not recoverable to `working`; only `retryCleanup` moves it to `merged`.

### Step 4: Implement mutex + half-applied-state fix in `packages/core/src/orchestrator.ts`

Add a private field for the mutex immediately after the `running = 0` field:

```ts
  // Merges serialize: each acquires this chain before calling ws.merge().
  private mergeLock: Promise<void> = Promise.resolve();
```

Replace the existing `merge` method with the hardened version:

```ts
  async merge(agentId: string): Promise<MergeResult> {
    const agent = this.requireAgent(agentId);
    if (agent.state !== "done") {
      throw new Error(`Agent ${agentId} is not ready to merge (state: ${agent.state})`);
    }
    const ws = this.workspaces;
    if (!isWorkspaceManager(ws)) {
      throw new Error("Workspace provider does not support merge");
    }

    // Acquire the merge lock: chain onto the current tail so concurrent
    // merge() calls run strictly one-at-a-time.
    let releaseLock!: () => void;
    const acquired = new Promise<void>((r) => { releaseLock = r; });
    // eslint-disable-next-line @typescript-eslint/no-floating-promises -- intentional chain
    const prev = this.mergeLock;
    this.mergeLock = prev.then(() => acquired);
    await prev;

    try {
      const result = await ws.merge(agentId);
      if (result.status === "conflict") {
        agent.conflict = { files: result.files };
        this.update(agent, "conflict");
        return result;
      }
      // Clean merge: attempt cleanup. A cleanup failure must NOT hide the
      // successful merge (code is already landed). Surface it as a distinct state.
      try {
        await ws.cleanup(agentId);
        this.update(agent, "merged");
      } catch (cleanupError) {
        agent.error = `Merge succeeded but worktree cleanup failed: ${errorMessage(cleanupError)}`;
        this.update(agent, "merge-cleanup-failed");
      }
      return result;
    } finally {
      releaseLock();
    }
  }
```

Add the `retryCleanup` method (public, additive):

```ts
  async retryCleanup(agentId: string): Promise<void> {
    const agent = this.requireAgent(agentId);
    if (agent.state !== "merge-cleanup-failed") {
      throw new Error(`Agent ${agentId} is not in merge-cleanup-failed state`);
    }
    const ws = this.workspaces;
    if (!isWorkspaceManager(ws)) {
      throw new Error("Workspace provider does not support cleanup");
    }
    await ws.cleanup(agentId);
    agent.error = undefined;
    this.update(agent, "merged");
  }
```

### Step 5: Run + build

```bash
cd packages/core && pnpm vitest run test/orchestrator.merge.test.ts
# expect all merge tests + new mutex + half-applied tests to pass
pnpm vitest run && pnpm exec tsc --noEmit
pnpm --filter @maestro/core build
# confirm dependents still pass:
cd ../workspace && pnpm vitest run
cd ../adapter-copilot && pnpm vitest run
```

### Step 6: Commit

```bash
git add packages/core/src/types.ts packages/core/src/events.ts \
        packages/core/src/orchestrator.ts \
        packages/core/test/orchestrator.merge.test.ts
git commit -m "$(cat <<'EOF'
feat(core): serialize merges with mutex, add merge-cleanup-failed state and retryCleanup

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task C2: `isStale` and `rebase` in `GitWorkspaceManager`

**Goal:** Detect when HEAD has advanced past an agent's `baseSha` and offer a rebase of the agent branch before merge.

**Files:** `packages/workspace/src/git-workspace-manager.ts` (add two methods); tests in both unit and integration files.

### Step 1: Write failing unit tests

Append to `packages/workspace/test/git-workspace-manager.unit.test.ts`:

```ts
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
    // Must rebase onto the repo's current HEAD (not the agent's old baseSha)
    expect(rebaseCall!.args).toContain("HEAD");
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
```

Run: `cd packages/workspace && pnpm vitest run test/git-workspace-manager.unit.test.ts` -> FAIL (methods missing).

### Step 2: Implement `isStale` and `rebase` in `packages/workspace/src/git-workspace-manager.ts`

Add after the `merge` method:

```ts
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
   *   - non-zero exit + unmerged `--diff-filter=U` files -> abort + conflict result
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
```

### Step 3: Run + build

```bash
cd packages/workspace && pnpm vitest run test/git-workspace-manager.unit.test.ts
pnpm exec tsc --noEmit
pnpm --filter @maestro/workspace build
```

### Step 4: Real-git integration tests for `isStale` and `rebase`

Append to `packages/workspace/test/git-workspace-manager.integration.test.ts`:

```ts
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
```

### Step 5: Run full workspace gate + commit

```bash
cd packages/workspace && pnpm vitest run && pnpm exec tsc --noEmit
pnpm --filter @maestro/workspace build
```

```bash
git add packages/workspace/src/git-workspace-manager.ts \
        packages/workspace/test/git-workspace-manager.unit.test.ts \
        packages/workspace/test/git-workspace-manager.integration.test.ts
git commit -m "$(cat <<'EOF'
feat(workspace): add isStale/rebase with real-conflict-vs-failure discrimination

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task C3: `resolveMerge` in `GitWorkspaceManager` (finish a conflict after user resolves markers)

**Goal:** After the user has resolved conflict markers in files and staged the resolutions, `resolveMerge(agentId)` commits the merge and returns `{ status: "clean" }`.

**Files:** `packages/workspace/src/git-workspace-manager.ts` (add method); `packages/workspace/test/git-workspace-manager.unit.test.ts` (extend); integration test append.

### Step 1: Failing unit tests

Append to `packages/workspace/test/git-workspace-manager.unit.test.ts`:

```ts
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
```

Run: `cd packages/workspace && pnpm vitest run test/git-workspace-manager.unit.test.ts` -> FAIL.

### Step 2: Implement `resolveMerge` in `packages/workspace/src/git-workspace-manager.ts`

Add after `rebase`:

```ts
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
```

### Step 3: Real-git integration test for `resolveMerge`

Append to `packages/workspace/test/git-workspace-manager.integration.test.ts`:

```ts
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
    const content = require("node:fs").readFileSync(join(repo, "file.txt"), "utf8");
    expect(content.trim()).toBe("resolved");
  });
});
```

### Step 4: Run + commit

```bash
cd packages/workspace && pnpm vitest run && pnpm exec tsc --noEmit
```

```bash
git add packages/workspace/src/git-workspace-manager.ts \
        packages/workspace/test/git-workspace-manager.unit.test.ts \
        packages/workspace/test/git-workspace-manager.integration.test.ts
git commit -m "$(cat <<'EOF'
feat(workspace): add resolveMerge to finish a merge after user resolves conflict markers

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task C4: PR/remote-merge mode (`pushAndPr`)

**Goal:** A config-toggled path that pushes the agent branch to the remote and runs `gh pr create` instead of a local merge. Unit-tested against a fake runner asserting exact arg arrays; no real network required.

**Files:** `packages/workspace/src/git-workspace-manager.ts` (add `pushAndPr`); unit tests; `packages/workspace/src/index.ts` (export `PrResult`).

### Step 1: Failing unit tests

Append to `packages/workspace/test/git-workspace-manager.unit.test.ts`:

```ts
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
    const m = new GitWorkspaceManager({ repoRoot: REPO, runner: fake.runner });
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
    const m = new GitWorkspaceManager({ repoRoot: REPO, runner: fake.runner });
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
    const m = new GitWorkspaceManager({ repoRoot: REPO, runner: fake.runner });
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
```

Run: `cd packages/workspace && pnpm vitest run test/git-workspace-manager.unit.test.ts` -> FAIL.

### Step 2: Implement `pushAndPr` + `PrOptions` + `PrResult`

Add the types and method to `packages/workspace/src/git-workspace-manager.ts`:

```ts
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
```

Add the method after `resolveMerge`:

```ts
  /**
   * PR mode: push the agent branch to the remote and open a pull request via
   * `gh pr create`. This replaces the local merge when `maestro.prMode` is
   * enabled in settings. The `GitRunner` is reused for `gh` so the entire
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
    // Create the PR via gh CLI
    const ghArgs: string[] = [
      "gh", "pr", "create",
      "--title", opts.title,
      "--body", opts.body,
      "--base", opts.base,
      "--head", rec.branch,
    ];
    if (opts.draft) ghArgs.push("--draft");
    const prResult = await this.runner(ghArgs, { cwd: this.repoRoot });
    if (prResult.exitCode !== 0) {
      throw new Error(`gh pr create failed (${prResult.exitCode}): ${prResult.stderr.trim()}`);
    }
    return { prUrl: prResult.stdout.trim() };
  }
```

Note: `gh` is passed as the first element of `args` and `git` is NOT prepended. The `nodeGitRunner` passes `args` directly to `spawn("git", ...)` which will break for `gh`. To support this cleanly, add a second injectable `ShellRunner` to `GitWorkspaceManager` that is used for `gh` commands:

Revise the constructor and add `shellRunner`:

```ts
export interface GitWorkspaceManagerOptions {
  repoRoot: string;
  runner?: GitRunner;
  /** Injectable for non-git shell commands (e.g. gh). Defaults to spawning the binary directly. */
  shellRunner?: GitRunner;  // same signature; just the command changes
}

// In the constructor:
  private readonly shellRunner: GitRunner;
  constructor(opts: GitWorkspaceManagerOptions) {
    this.repoRoot = opts.repoRoot;
    this.runner = opts.runner ?? nodeGitRunner;
    this.shellRunner = opts.shellRunner ?? nodeShellRunner;
  }
```

Add `nodeShellRunner` to `packages/workspace/src/git-runner.ts`:

```ts
/**
 * A shell runner for non-git binaries. Spawns the first element of args as the
 * command (unlike nodeGitRunner which always prepends "git").
 */
export const nodeShellRunner: GitRunner = (args, opts) => {
  const [cmd, ...rest] = args;
  if (!cmd) return Promise.resolve({ stdout: "", stderr: "", exitCode: 1 });
  return new Promise<GitResult>((resolve, reject) => {
    const child = spawn(cmd, rest, { cwd: opts?.cwd, stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (c: Buffer) => out.push(c));
    child.stderr.on("data", (c: Buffer) => err.push(c));
    child.on("error", reject);
    child.on("close", (code) =>
      resolve({
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: Buffer.concat(err).toString("utf8"),
        exitCode: code ?? 1,
      }),
    );
  });
};
```

Update `pushAndPr` to use `this.shellRunner` for the `gh` call instead of `this.runner`:

```ts
    const prResult = await this.shellRunner(ghArgs, { cwd: this.repoRoot });
```

And update the unit test fake to pass `shellRunner` instead of `runner` for the `gh` call. Revise the test helper so both runners are faked:

```ts
// In the test, create manager with both faked:
const m = new GitWorkspaceManager({
  repoRoot: REPO,
  runner: fake.runner,   // for git commands
  shellRunner: fake.runner, // same fake works since we check args[0]
});
```

### Step 3: Export new types from `packages/workspace/src/index.ts`

```ts
export type { PrOptions, PrResult } from "./git-workspace-manager.js";
export { nodeShellRunner } from "./git-runner.js";
```

### Step 4: Run + commit

```bash
cd packages/workspace && pnpm vitest run && pnpm exec tsc --noEmit
pnpm --filter @maestro/workspace build
```

```bash
git add packages/workspace/src/git-workspace-manager.ts \
        packages/workspace/src/git-runner.ts \
        packages/workspace/src/index.ts \
        packages/workspace/test/git-workspace-manager.unit.test.ts
git commit -m "$(cat <<'EOF'
feat(workspace): add pushAndPr (PR mode) with injectable shellRunner for offline testing

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task C5: Branch-retention policy

**Goal:** An opt-in setting that keeps the agent branch after a successful local merge (default: delete, matching current M3 behavior).

**Files:** `packages/workspace/src/git-workspace-manager.ts` (extend `GitWorkspaceManagerOptions` + `cleanup` logic); unit test.

### Step 1: Failing unit test

Append to `packages/workspace/test/git-workspace-manager.unit.test.ts`:

```ts
// ---- Task C5: branch-retention policy ----

describe("GitWorkspaceManager branch retention", () => {
  it("with retainBranchOnMerge: false (default), cleanup deletes the branch", async () => {
    const { manager, calls } = mgr();
    await manager.create("a1");
    await manager.cleanup("a1");
    expect(calls.some((c) => c.args.join(" ") === "branch -D agent/a1")).toBe(true);
  });

  it("with retainBranchOnMerge: true, cleanup removes worktree but keeps branch", async () => {
    const fake = makeFakeGitRunner([
      { match: startsWith("rev-parse", "HEAD"), result: { stdout: "base123\n" } },
    ]);
    const m = new GitWorkspaceManager({
      repoRoot: REPO,
      runner: fake.runner,
      retainBranchOnMerge: true,
    });
    await m.create("a1");
    await m.cleanup("a1");
    // worktree removed
    expect(fake.calls.some((c) => c.args[0] === "worktree" && c.args[1] === "remove")).toBe(true);
    // branch NOT deleted (no "branch -D" call)
    expect(fake.calls.some((c) => c.args.join(" ") === "branch -D agent/a1")).toBe(false);
  });

  it("discard always deletes the branch regardless of retention setting", async () => {
    const fake = makeFakeGitRunner([
      { match: startsWith("rev-parse", "HEAD"), result: { stdout: "base123\n" } },
    ]);
    const m = new GitWorkspaceManager({
      repoRoot: REPO,
      runner: fake.runner,
      retainBranchOnMerge: true,
    });
    await m.create("a1");
    await m.discard("a1");
    expect(fake.calls.some((c) => c.args.join(" ") === "branch -D agent/a1")).toBe(true);
  });
});
```

Run: `cd packages/workspace && pnpm vitest run test/git-workspace-manager.unit.test.ts` -> FAIL (`retainBranchOnMerge` option missing).

### Step 2: Implement retention in `packages/workspace/src/git-workspace-manager.ts`

Extend `GitWorkspaceManagerOptions`:

```ts
export interface GitWorkspaceManagerOptions {
  repoRoot: string;
  runner?: GitRunner;
  shellRunner?: GitRunner;
  /**
   * When true, the agent branch is kept after a successful merge (cleanup call).
   * The worktree is still removed. Default: false (deletes branch on cleanup).
   * Discard always deletes the branch regardless of this setting.
   */
  retainBranchOnMerge?: boolean;
}
```

Add the field to the class and use it in `teardown`:

```ts
  private readonly retainBranchOnMerge: boolean;

  constructor(opts: GitWorkspaceManagerOptions) {
    this.repoRoot = opts.repoRoot;
    this.runner = opts.runner ?? nodeGitRunner;
    this.shellRunner = opts.shellRunner ?? nodeShellRunner;
    this.retainBranchOnMerge = opts.retainBranchOnMerge ?? false;
  }
```

Modify `cleanup` and `discard` to pass different `deleteBranch` values:

```ts
  async discard(agentId: string): Promise<void> {
    await this.teardown(agentId, true); // always deletes branch
  }

  async cleanup(agentId: string): Promise<void> {
    await this.teardown(agentId, !this.retainBranchOnMerge);
  }
```

The existing `teardown` signature already takes `deleteBranch: boolean`, so no further change is needed there.

### Step 3: Run + commit

```bash
cd packages/workspace && pnpm vitest run && pnpm exec tsc --noEmit
pnpm --filter @maestro/workspace build
```

```bash
git add packages/workspace/src/git-workspace-manager.ts \
        packages/workspace/test/git-workspace-manager.unit.test.ts
git commit -m "$(cat <<'EOF'
feat(workspace): retainBranchOnMerge option (keeps branch after cleanup, discard always deletes)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task C6: Extension UI for conflict-resolve + PR mode

**Goal:** Additive deltas to the extension UI. (a) Conflict card shows a "Resolve in Editor" button; clicking it opens conflicted files in VS Code's merge editor. (b) A `maestro.prMode` setting toggles PR mode; the done card shows a "Create PR" button when enabled. (c) The `merge-cleanup-failed` state shows a "Retry Cleanup" button.

This task follows the M4 pure/vscode file-split discipline. All new logic goes into unit-testable vscode-free files.

**Files:** NEW `packages/extension/src/merge-helpers.ts`; MODIFY `packages/extension/src/render.ts`; MODIFY `packages/extension/src/webview/main.ts`; MODIFY `packages/extension/src/extension.ts`.

### Step 1: Create `packages/extension/src/merge-helpers.ts` (pure, vscode-free)

```ts
/**
 * Pure helpers for M9 merge UX. No `import "vscode"` here so these can be
 * unit-tested under Vitest without a VS Code host.
 */

/** Build the conflict-resolve instruction message shown to the user. */
export function buildConflictResolveMessage(files: readonly string[]): string {
  const list = files.map((f) => `  - ${f}`).join("\n");
  return `Maestro: resolve the conflicts in:\n${list}\nThen click "Finish Merge" on the card.`;
}

/** Build the title and body for a gh pr create call from agent context. */
export function buildPrTitle(roleName: string, taskDescription: string): string {
  const truncated = taskDescription.length > 60
    ? `${taskDescription.slice(0, 60)}...`
    : taskDescription;
  return `[Maestro/${roleName}] ${truncated}`;
}

export function buildPrBody(summary: string | undefined, diffFiles: readonly string[]): string {
  const fileList = diffFiles.length > 0
    ? `\n\n**Changed files:**\n${diffFiles.map((f) => `- ${f}`).join("\n")}`
    : "";
  return `${summary ?? "No summary provided."}${fileList}\n\n_Created by Maestro._`;
}
```

### Step 2: Write unit tests for `merge-helpers.ts`

Create `packages/extension/test/merge-helpers.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  buildConflictResolveMessage,
  buildPrTitle,
  buildPrBody,
} from "../src/merge-helpers.js";

describe("buildConflictResolveMessage", () => {
  it("lists all conflicted files in the message", () => {
    const msg = buildConflictResolveMessage(["a.ts", "b.ts"]);
    expect(msg).toContain("a.ts");
    expect(msg).toContain("b.ts");
    expect(msg).toContain("Finish Merge");
  });
});

describe("buildPrTitle", () => {
  it("includes role name and truncated description", () => {
    const title = buildPrTitle("Implementer", "Add a --version flag to the CLI entry point");
    expect(title).toContain("Implementer");
    expect(title).toContain("Add a --version flag");
  });

  it("truncates long descriptions", () => {
    const long = "x".repeat(80);
    const title = buildPrTitle("R", long);
    expect(title.length).toBeLessThan(100);
    expect(title).toContain("...");
  });
});

describe("buildPrBody", () => {
  it("includes summary and file list", () => {
    const body = buildPrBody("All good.", ["a.ts"]);
    expect(body).toContain("All good.");
    expect(body).toContain("a.ts");
    expect(body).toContain("Maestro");
  });

  it("handles undefined summary gracefully", () => {
    const body = buildPrBody(undefined, []);
    expect(body).toContain("No summary provided");
  });
});
```

Run: `cd packages/extension && pnpm vitest run test/merge-helpers.test.ts` -> PASS (the file is pure, no vscode).

### Step 3: Extend `packages/extension/src/render.ts` (additive only)

Modify the `actions` function to handle the new states. The existing switch is replaced with an extended version (all original cases preserved):

```ts
// BEFORE: case "conflict": return discard;
// AFTER: case "conflict": add resolve + discard

function actions(card: CardVM): string {
  const id = escapeHtml(card.id);
  const stop = `<button data-action="stop" data-id="${id}">Stop</button>`;
  const merge = `<button data-action="merge" data-id="${id}">Merge</button>`;
  const discard = `<button data-action="discard" data-id="${id}">Discard</button>`;
  const resolveConflict = `<button data-action="resolve-conflict" data-id="${id}">Resolve in Editor</button>`;
  const finishMerge = `<button data-action="finish-merge" data-id="${id}">Finish Merge</button>`;
  const createPr = `<button data-action="create-pr" data-id="${id}">Create PR</button>`;
  const retryCleanup = `<button data-action="retry-cleanup" data-id="${id}">Retry Cleanup</button>`;
  switch (card.state) {
    case "working":
    case "awaiting-approval":
    case "preparing":
      return stop;
    case "done":
      // create-pr is rendered by the webview only when prMode config is true;
      // render.ts emits the button always and the webview shows/hides based on a
      // data attribute. Simpler: always render it with data-pr-mode attribute;
      // the webview hides it when not configured.
      return `${merge} ${createPr} ${discard}`;
    case "conflict":
      return `${resolveConflict} ${finishMerge} ${discard}`;
    case "merge-cleanup-failed":
      return `${retryCleanup} ${discard}`;
    case "error":
    case "stopped":
      return discard;
    case "merged":
    case "discarded":
      return "";
  }
}
```

Modify `detail` to handle `merge-cleanup-failed`:

```ts
function detail(card: CardVM): string {
  if (card.state === "done" && card.diff) {
    const files = card.diff.files.map((f) => `<li>${escapeHtml(f)}</li>`).join("");
    return `<div class="summary">${escapeHtml(card.summary ?? "")}</div><ul class="files">${files}</ul>`;
  }
  if (card.state === "conflict" && card.conflictFiles) {
    const files = card.conflictFiles.map((f) => `<li>${escapeHtml(f)}</li>`).join("");
    return `<div class="conflict">Merge conflict in:</div><ul class="files">${files}</ul>`;
  }
  if (card.state === "merge-cleanup-failed" && card.error) {
    return `<pre class="error">${escapeHtml(card.error)}</pre>
<div class="cleanup-note">The merge succeeded (your code is in the branch), but the worktree cleanup failed. Click "Retry Cleanup" to remove the worktree, or "Discard" to clean up manually.</div>`;
  }
  if (card.state === "error" && card.error) {
    return `<pre class="error">${escapeHtml(card.error)}</pre>`;
  }
  return "";
}
```

Note: `"merge-cleanup-failed"` must also be added to `CardVM.state` in `@maestro/cockpit` (the `cockpit` reducer derives state from `AgentState`). That is an additive delta to the cockpit package. The cockpit's `CardVM` already uses `card.state: AgentState` from core; since `AgentState` now includes `"merge-cleanup-failed"`, the TypeScript type propagates. The render.ts switch just needs to handle the new literal.

### Step 4: Write render tests

Create `packages/extension/test/render.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { renderCardHTML } from "../src/render.js";
import type { CardVM } from "@maestro/cockpit";

function card(overrides: Partial<CardVM>): CardVM {
  return {
    id: "a1",
    roleName: "Implementer",
    engineId: "copilot",
    state: "done",
    output: "",
    attention: false,
    ...overrides,
  };
}

describe("renderCardHTML (M9 additions)", () => {
  it("conflict card has resolve-in-editor and finish-merge buttons", () => {
    const html = renderCardHTML(card({ state: "conflict", conflictFiles: ["x.ts"] }));
    expect(html).toContain('data-action="resolve-conflict"');
    expect(html).toContain('data-action="finish-merge"');
    expect(html).toContain('data-action="discard"');
    // Must NOT have merge (not safe during conflict)
    expect(html).not.toContain('data-action="merge"');
  });

  it("done card has merge, create-pr, and discard buttons", () => {
    const html = renderCardHTML(card({ state: "done", diff: { files: ["a.ts"], patch: "" } }));
    expect(html).toContain('data-action="merge"');
    expect(html).toContain('data-action="create-pr"');
    expect(html).toContain('data-action="discard"');
  });

  it("merge-cleanup-failed card has retry-cleanup and discard buttons", () => {
    const html = renderCardHTML(card({ state: "merge-cleanup-failed", error: "disk full" }));
    expect(html).toContain('data-action="retry-cleanup"');
    expect(html).toContain('data-action="discard"');
    expect(html).toContain("disk full");
    expect(html).toContain("cleanup-note");
  });

  it("all engine output is still escaped", () => {
    const html = renderCardHTML(card({ output: "<script>alert(1)</script>" }));
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
```

Run: `cd packages/extension && pnpm vitest run test/render.test.ts` -> after implementing render.ts changes, PASS.

### Step 5: Extend `packages/extension/src/webview/main.ts` (additive click handlers)

This file imports no vscode module; changes are additive inside the existing click handler:

```ts
// Inside the existing click handler, after the existing `else if (action === "discard")` branch, add:
    else if (action === "resolve-conflict") {
      vscode.postMessage({ type: "resolve-conflict", agentId: id });
    } else if (action === "finish-merge") {
      vscode.postMessage({ type: "finish-merge", agentId: id });
    } else if (action === "create-pr") {
      vscode.postMessage({ type: "create-pr", agentId: id });
    } else if (action === "retry-cleanup") {
      vscode.postMessage({ type: "retry-cleanup", agentId: id });
    }
```

These new message types must be added to `WebviewToHost` in `@maestro/cockpit` (additive):

```ts
// In packages/cockpit/src/protocol.ts, extend WebviewToHost:
  | { type: "resolve-conflict"; agentId: string }
  | { type: "finish-merge"; agentId: string }
  | { type: "create-pr"; agentId: string }
  | { type: "retry-cleanup"; agentId: string }
```

And the controller must handle them (additive cases in `packages/extension/src/controller.ts`):

```ts
// Extend OrchestratorLike to include the new methods:
export interface OrchestratorLike {
  // ... existing methods ...
  retryCleanup(agentId: string): Promise<void>;
  // resolveConflict and finishMerge and createPr are handled via VS Code commands
  // in extension.ts (they need vscode.window / vscode.commands); controller only
  // dispatches what it can without vscode.
}

// Extend handle():
      case "retry-cleanup":
        orch.retryCleanup(message.agentId).catch(fail);
        break;
      // resolve-conflict, finish-merge, create-pr are posted back to the host
      // via a dedicated VS Code command channel (see extension.ts); the controller
      // passes them through to a registered handler.
      case "resolve-conflict":
      case "finish-merge":
      case "create-pr":
        this.onMergeAction?.(message);
        break;
```

The `onMergeAction` callback is injected into `createCockpit` as an optional fourth parameter (additive):

```ts
export function createCockpit(
  orch: OrchestratorLike,
  onState: (state: CockpitState) => void,
  onError?: (message: string) => void,
  onMergeAction?: (msg: WebviewToHost) => void,
): Cockpit
```

This is purely additive: existing callers pass no fourth argument and `onMergeAction?.()` is a safe no-op.

### Step 6: Extend `packages/extension/src/extension.ts` (additive `activate()` delta)

Add a `maestro.resolveConflict` command and the `onMergeAction` handler. This is NOT a rewrite; it is an additive block inside the existing `activate()` function, after the cockpit is created and before `context.subscriptions.push(...)`:

```ts
  // M9: wire resolve-conflict + finish-merge + create-pr + retry-cleanup

  // Read PR mode setting. Default false (local merge).
  const prMode = (): boolean =>
    vscode.workspace.getConfiguration("maestro").get<boolean>("prMode", false);

  // Handler for merge-action messages that need VS Code APIs
  const handleMergeAction = async (msg: WebviewToHost): Promise<void> => {
    const agent = orch.getAgent((msg as { agentId: string }).agentId);
    if (!agent) return;

    if (msg.type === "resolve-conflict") {
      const files = agent.conflict?.files ?? [];
      // Open each conflicted file in VS Code's merge editor
      for (const relPath of files) {
        const uri = vscode.Uri.joinPath(
          vscode.Uri.file(repoRoot),
          relPath,
        );
        await vscode.commands.executeCommand("vscode.open", uri);
      }
      const { buildConflictResolveMessage } = await import("./merge-helpers.js");
      void vscode.window.showInformationMessage(
        buildConflictResolveMessage(files),
      );
    } else if (msg.type === "finish-merge") {
      // User indicates markers are resolved: call resolveMerge then transition state
      try {
        const result = await workspaces.resolveMerge(agent.id);
        if (result.status === "clean") {
          // cleanup and transition to merged
          await workspaces.cleanup(agent.id);
          // The orchestrator does not have a direct "set merged" hook from outside;
          // call retryCleanup on a "merge-cleanup-failed" agent or rely on a new
          // orchestrator method. Since M9 owns the orchestrator too, add a thin
          // internal path: expose orch.finishConflictResolution(agentId).
          // (See note below.)
          await orch.finishConflictResolution(agent.id);
        } else {
          void vscode.window.showWarningMessage(
            `Still unresolved: ${result.files.join(", ")}. Fix all markers and click Finish Merge again.`,
          );
        }
      } catch (err) {
        void vscode.window.showErrorMessage(`Finish merge failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    } else if (msg.type === "create-pr") {
      if (!prMode()) {
        void vscode.window.showInformationMessage("PR mode is off. Enable maestro.prMode in settings.");
        return;
      }
      const { buildPrTitle, buildPrBody } = await import("./merge-helpers.js");
      const title = buildPrTitle(agent.role.name, agent.task.description);
      const body = buildPrBody(agent.summary, agent.diff?.files ?? []);
      try {
        const result = await workspaces.pushAndPr(agent.id, {
          title,
          body,
          base: "main",
          remote: "origin",
          draft: vscode.workspace.getConfiguration("maestro").get<boolean>("prDraft", false),
        });
        void vscode.window.showInformationMessage(`PR created: ${result.prUrl}`);
      } catch (err) {
        void vscode.window.showErrorMessage(`Create PR failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  };

  // Rebuild cockpit with onMergeAction wired in. The existing cockpit is already
  // constructed above; replace it with a version that includes the handler.
  // NOTE: In practice, the cockpit construction is a single call. The M9
  // delta is: pass handleMergeAction as the 4th arg to createCockpit.
  // The implementation order ensures cockpit is not yet subscribed when we
  // assign handleMergeAction, so this is a one-line additive change to the
  // existing createCockpit() call:
  //   createCockpit(orch, onState, onError, handleMergeAction)
  //
  // The "finishConflictResolution" method on the orchestrator is also new (see C6 note).
```

**Note on `finishConflictResolution`:** The orchestrator needs a way for the extension to signal "the conflict was resolved externally and the agent should move to `merged`." Add this public method to `packages/core/src/orchestrator.ts` (additive):

```ts
  /**
   * Called after an external conflict resolution (user fixed markers, `resolveMerge`
   * returned clean, and cleanup succeeded). Transitions the agent from `conflict`
   * to `merged` and emits the state update.
   *
   * This is the only valid path for an agent to leave `conflict` state via
   * an external tool (not the workspace manager's merge() call).
   */
  finishConflictResolution(agentId: string): void {
    const agent = this.requireAgent(agentId);
    if (agent.state !== "conflict") {
      throw new Error(`Agent ${agentId} is not in conflict state (state: ${agent.state})`);
    }
    agent.conflict = undefined;
    this.update(agent, "merged");
  }
```

Add a unit test for `finishConflictResolution` in `packages/core/test/orchestrator.merge.test.ts`:

```ts
describe("Orchestrator.finishConflictResolution", () => {
  it("transitions from conflict to merged and clears conflict field", async () => {
    const manager = new FakeWorkspaceManager();
    manager.setMergeResult("agent-1", { status: "conflict", files: ["a.ts"] });
    const orch = new Orchestrator({ maxParallelAgents: 1 }, manager);
    orch.registerRole(role);
    orch.registerAdapter(new FakeEngineAdapter({ script: [{ kind: "done", summary: "ok" }] }));

    const agent = orch.spawn("Impl", "task");
    await waitFor(orch, agent.id, "done");
    await orch.merge(agent.id); // -> conflict

    expect(orch.getAgent(agent.id)!.state).toBe("conflict");
    orch.finishConflictResolution(agent.id);
    expect(orch.getAgent(agent.id)!.state).toBe("merged");
    expect(orch.getAgent(agent.id)!.conflict).toBeUndefined();
  });

  it("throws if the agent is not in conflict state", async () => {
    const { orch } = build();
    const agent = orch.spawn("Impl", "task");
    await waitFor(orch, agent.id, "done");
    expect(() => orch.finishConflictResolution(agent.id)).toThrow("not in conflict state");
  });
});
```

### Step 7: Run all packages + commit

```bash
# core
cd packages/core && pnpm vitest run && pnpm exec tsc --noEmit && pnpm --filter @maestro/core build
# workspace
cd packages/workspace && pnpm vitest run && pnpm exec tsc --noEmit && pnpm --filter @maestro/workspace build
# extension
cd packages/extension && pnpm vitest run && pnpm exec tsc --noEmit
# esbuild bundle
node build.mjs
```

```bash
git add packages/core/src/orchestrator.ts \
        packages/core/test/orchestrator.merge.test.ts \
        packages/cockpit/src/protocol.ts \
        packages/extension/src/merge-helpers.ts \
        packages/extension/src/render.ts \
        packages/extension/src/controller.ts \
        packages/extension/src/webview/main.ts \
        packages/extension/src/extension.ts \
        packages/extension/test/merge-helpers.test.ts \
        packages/extension/test/render.test.ts
git commit -m "$(cat <<'EOF'
feat(extension,core): conflict-resolve-in-editor, PR mode, retry-cleanup UI + finishConflictResolution

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task C7: Full M9 gate

**Goal:** Confirm all packages build and all tests pass.

### Step 1: Full gate run

```bash
# From repo root:
pnpm --filter @maestro/core build
pnpm --filter @maestro/cockpit build
pnpm --filter @maestro/workspace build
pnpm --filter @maestro/adapter-copilot build

# All tests across all packages:
pnpm --filter @maestro/core test
pnpm --filter @maestro/workspace test       # includes unit + integration (real git)
pnpm --filter @maestro/adapter-copilot test
pnpm --filter @maestro/cockpit test
pnpm --filter @maestro/extension test

# Typecheck the extension (it imports vscode so tsc --noEmit catches type errors even without host):
cd packages/extension && pnpm exec tsc --noEmit

# esbuild bundle:
cd packages/extension && node build.mjs
```

Expected gate: 112 existing tests + new tests from M9. Breakdown:
- `@maestro/core`: 47 existing + ~8 new (mutex, half-applied state, retryCleanup, finishConflictResolution) = ~55
- `@maestro/workspace`: 17 existing + ~18 new (isStale unit x2, rebase unit x4, resolveMerge unit x3, pushAndPr unit x4, retention x3, isStale integration x2, rebase integration x2, resolveMerge integration x1) = ~35
- `@maestro/cockpit`: 12 existing (protocol type changes are compile-time only) = ~12
- `@maestro/adapter-copilot`: 20 existing = 20
- `@maestro/extension`: 16 existing + ~7 new (merge-helpers x3, render x4) = ~23
- **Total expected: ~145 tests**

### Step 2: Final commit

```bash
git add -A
git commit -m "$(cat <<'EOF'
chore(m9): full gate pass - all packages build and test

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-review checklist

- [ ] Every new method in `GitWorkspaceManager` (`isStale`, `rebase`, `resolveMerge`, `pushAndPr`) goes through the injectable `GitRunner`/`shellRunner`: unit tests assert exact arg arrays without real git.
- [ ] Real-git integration tests are in clearly-separated `*.integration.test.ts` files; they use real throwaway repos in `mkdtempSync`.
- [ ] The real-conflict-vs-real-failure discrimination from M3 is preserved in `rebase`: non-zero exit + unmerged `--diff-filter=U` files is a conflict (abort + report); non-zero exit + no unmerged files is a throw.
- [ ] The merge mutex uses a promise chain (not a third-party library): `this.mergeLock = prev.then(() => acquired)` with `releaseLock` called in `finally`. No deadlock risk because `releaseLock` is always called in the `finally` block, even if `ws.merge()` throws.
- [ ] `"merge-cleanup-failed"` is a terminal state (in `isTerminalState`). A cleanup failure after a successful merge is not a recoverable error from the agent's perspective: the code is already merged; only the worktree cleanup failed. `retryCleanup` is the explicit recovery action, not an automatic retry.
- [ ] `finishConflictResolution` on the orchestrator only accepts `conflict` state, preventing misuse.
- [ ] Branch-retention policy: `cleanup` respects `retainBranchOnMerge`; `discard` always deletes. This invariant is tested explicitly.
- [ ] PR mode uses `shellRunner` (not `runner`) for `gh`, keeping both injectable and independently fakeable.
- [ ] All new extension logic that does not import `vscode` lives in `merge-helpers.ts`, which is unit-tested.
- [ ] `render.ts` changes are purely additive: all five original `switch` cases are preserved; three new states are added (`merge-cleanup-failed` plus the new button on `done` and updated `conflict`).
- [ ] `WebviewToHost` extensions in `cockpit` are additive union members.
- [ ] `createCockpit` signature extension is backward-compatible (optional 4th parameter).
- [ ] No em dashes anywhere.
- [ ] All commits end with the Co-Authored-By trailer.
- [ ] No existing test is modified to make it pass: only new tests are added (or existing test files are appended to).
- [ ] The M4 test gate (112 tests) is never broken mid-milestone: each task step runs `pnpm vitest run` before committing.

---

## Appendix: `GitWorkspaceManager` new public method signatures

For the reconciliation map:

```ts
// packages/workspace/src/git-workspace-manager.ts (new methods, M9 only)

/** True if the repo HEAD has advanced past this agent's baseSha. */
isStale(agentId: string): Promise<boolean>

/**
 * Rebase the agent branch onto the current HEAD. Preserves real-conflict-vs-real-failure
 * discrimination. On success, updates the internal baseSha record.
 */
rebase(agentId: string): Promise<MergeResult>

/**
 * Finish a partially-resolved merge: checks for remaining unmerged paths,
 * then stages and commits if all markers are resolved.
 */
resolveMerge(agentId: string): Promise<MergeResult>

/**
 * PR mode: push the agent branch and run `gh pr create`. Uses shellRunner for gh.
 * Does not clean up the worktree.
 */
pushAndPr(agentId: string, opts: PrOptions): Promise<PrResult>
```

New `GitWorkspaceManagerOptions` fields (all optional, all additive):
```ts
shellRunner?: GitRunner;        // for gh CLI; defaults to nodeShellRunner
retainBranchOnMerge?: boolean;  // default false
```

New `Orchestrator` public methods (additive):
```ts
retryCleanup(agentId: string): Promise<void>         // recover from merge-cleanup-failed
finishConflictResolution(agentId: string): void       // after external conflict resolution
```

New `AgentState` member (additive): `"merge-cleanup-failed"` (terminal).

New `WebviewToHost` message types (additive union members):
```ts
| { type: "resolve-conflict"; agentId: string }
| { type: "finish-merge"; agentId: string }
| { type: "create-pr"; agentId: string }
| { type: "retry-cleanup"; agentId: string }
```
