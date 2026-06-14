import type { Diff, MergeResult, Workspace } from "./types.js";

/** Abstracts worktree creation so the orchestrator stays pure and testable. */
export interface WorkspaceProvider {
  create(agentId: string): Promise<Workspace>;
  cleanup(agentId: string): Promise<void>;
}

/** In-memory provider for tests and for the no-real-CLI milestone. */
export class FakeWorkspaceProvider implements WorkspaceProvider {
  readonly created: string[] = [];
  readonly cleaned: string[] = [];
  private failOn?: string;

  /** Configure the provider to throw when creating a workspace for `agentId`. */
  failCreateFor(agentId: string): void {
    this.failOn = agentId;
  }

  create(agentId: string): Promise<Workspace> {
    if (this.failOn === agentId) {
      return Promise.reject(new Error("worktree add failed"));
    }
    this.created.push(agentId);
    return Promise.resolve({
      agentId,
      path: `/tmp/maestro/${agentId}`,
      branch: `agent/${agentId}`,
    });
  }

  cleanup(agentId: string): Promise<void> {
    this.cleaned.push(agentId);
    return Promise.resolve();
  }
}

/**
 * A richer provider the orchestrator FEATURE-DETECTS. Implementing this (real
 * git worktrees) unlocks diff-on-done and merge/discard. The base
 * WorkspaceProvider (e.g. FakeWorkspaceProvider) keeps working unchanged.
 */
export interface WorkspaceManager extends WorkspaceProvider {
  /** Diff of the agent's worktree vs its base; the conductor's review surface. */
  diff(agentId: string): Promise<Diff>;
  /** Merge the agent's branch into the base. Reports clean | conflict. */
  merge(agentId: string): Promise<MergeResult>;
  /** Drop the agent's branch + worktree without merging. */
  discard(agentId: string): Promise<void>;
}

/** Runtime feature-detection guard. */
export function isWorkspaceManager(w: WorkspaceProvider): w is WorkspaceManager {
  const m = w as Partial<WorkspaceManager>;
  return (
    typeof m.diff === "function" &&
    typeof m.merge === "function" &&
    typeof m.discard === "function"
  );
}

/** In-memory WorkspaceManager test double (scriptable). */
export class FakeWorkspaceManager implements WorkspaceManager {
  readonly created: string[] = [];
  readonly cleaned: string[] = [];
  readonly diffed: string[] = [];
  readonly merged: string[] = [];
  readonly discarded: string[] = [];
  private diffs = new Map<string, Diff>();
  private mergeResults = new Map<string, MergeResult>();

  setDiff(agentId: string, diff: Diff): void {
    this.diffs.set(agentId, diff);
  }
  setMergeResult(agentId: string, result: MergeResult): void {
    this.mergeResults.set(agentId, result);
  }

  create(agentId: string): Promise<Workspace> {
    this.created.push(agentId);
    return Promise.resolve({ agentId, path: `/tmp/maestro/${agentId}`, branch: `agent/${agentId}` });
  }
  cleanup(agentId: string): Promise<void> {
    this.cleaned.push(agentId);
    return Promise.resolve();
  }
  diff(agentId: string): Promise<Diff> {
    this.diffed.push(agentId);
    return Promise.resolve(this.diffs.get(agentId) ?? { files: [], patch: "" });
  }
  merge(agentId: string): Promise<MergeResult> {
    this.merged.push(agentId);
    return Promise.resolve(this.mergeResults.get(agentId) ?? { status: "clean" });
  }
  discard(agentId: string): Promise<void> {
    this.discarded.push(agentId);
    return Promise.resolve();
  }
}
