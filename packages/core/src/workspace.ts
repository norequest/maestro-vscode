import type { AgentProfile, Diff, MergeResult, SkillRef, Workspace } from "./types.js";

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
      path: `/tmp/hallucinate/${agentId}`,
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
  /** Diff of the agent's worktree vs its base; the lead's review surface. */
  diff(agentId: string): Promise<Diff>;
  /** Merge the agent's branch into the base. Reports clean | conflict. */
  merge(agentId: string): Promise<MergeResult>;
  /** Drop the agent's branch + worktree without merging. */
  discard(agentId: string): Promise<void>;
  /**
   * Remove the agent's worktree but KEEP its branch (the branch now lives on in
   * an opened PR). Optional: implementations predating this method are tolerated
   * via the guarded optional call in the orchestrator.
   */
  releaseWorktree?(agentId: string): Promise<void>;
  /**
   * Re-register an existing worktree (its path + branch) for an agent restored
   * after a reload. A manager's record map is in-memory, so it starts each
   * session empty: without re-adoption, merge/diff/discard on a hydrated agent
   * throw "Unknown agent". Optional: implementations predating this are tolerated.
   */
  adopt?(agentId: string, workspace: Workspace): Promise<void>;
  /**
   * Materialize the agent's resolved skills into its worktree (e.g. one
   * .hallucinate/skills/<name>/SKILL.md per ref) so the running engine can
   * discover and load them on demand. Optional: implementations predating this
   * are tolerated via the guarded optional call in the orchestrator.
   */
  writeSkills?(agentId: string, skills: SkillRef[]): Promise<void>;
  /**
   * Materialize agent profiles into the agent's worktree at
   * .github/agents/<name>.agent.md, git-excluded like skills so they never reach
   * the review diff. Optional; predating implementations are tolerated via the
   * guarded optional call in the orchestrator.
   */
  writeAgentProfiles?(agentId: string, profiles: AgentProfile[]): Promise<void>;
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
  readonly released: string[] = [];
  readonly adopted: string[] = [];
  /** Records each writeSkills call so tests can assert materialization. */
  readonly wroteSkills: Array<{ agentId: string; skills: SkillRef[] }> = [];
  /** Records each writeAgentProfiles call so tests can assert materialization. */
  readonly wroteAgentProfiles: Array<{ agentId: string; profiles: AgentProfile[] }> = [];
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
    return Promise.resolve({ agentId, path: `/tmp/hallucinate/${agentId}`, branch: `agent/${agentId}` });
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
  releaseWorktree(agentId: string): Promise<void> {
    this.released.push(agentId);
    return Promise.resolve();
  }
  adopt(agentId: string): Promise<void> {
    this.adopted.push(agentId);
    return Promise.resolve();
  }
  writeSkills(agentId: string, skills: SkillRef[]): Promise<void> {
    this.wroteSkills.push({ agentId, skills });
    return Promise.resolve();
  }
  writeAgentProfiles(agentId: string, profiles: AgentProfile[]): Promise<void> {
    this.wroteAgentProfiles.push({ agentId, profiles });
    return Promise.resolve();
  }
}
