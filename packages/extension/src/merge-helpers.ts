/** Pure helpers for M9 merge UX. No vscode import, so unit-testable under Vitest. */

import type { Agent } from "@hallucinate/core";

/**
 * The directory the agent's conflict files live in. Conflict markers are
 * written into the agent's WORKTREE, not the main repo root, so "Resolve in
 * Editor" must open files relative to the worktree. Returns the worktree path
 * when known, else undefined so the caller can skip/warn rather than open the
 * wrong (marker-free) copy from the main checkout.
 */
export function conflictFileBase(agent: Pick<Agent, "workspace">): string | undefined {
  return agent.workspace?.path;
}

export function buildConflictResolveMessage(files: readonly string[]): string {
  const list = files.map((f) => `  - ${f}`).join("\n");
  return `Hallucinate: resolve the conflicts in:\n${list}\nThen click "Finish Merge" on the card.`;
}

export function buildPrTitle(roleName: string, taskDescription: string): string {
  const truncated = taskDescription.length > 60 ? `${taskDescription.slice(0, 60)}...` : taskDescription;
  return `[Hallucinate/${roleName}] ${truncated}`;
}

export function buildPrBody(summary: string | undefined, diffFiles: readonly string[]): string {
  const fileList = diffFiles.length > 0 ? `\n\n**Changed files:**\n${diffFiles.map((f) => `- ${f}`).join("\n")}` : "";
  return `${summary ?? "No summary provided."}${fileList}\n\n_Created by Hallucinate._`;
}

/** The minimal orchestrator slice the PR-created transition needs (pure, testable). */
export interface PrCreatedTransitioner {
  markPrCreated(agentId: string): Promise<void>;
}

/**
 * After `pushAndPr` has SUCCEEDED for a done agent, move the card to the
 * terminal "pr-created" state via the core. This releases the worktree but
 * keeps the branch (the PR needs its commits). Kept pure (no vscode import) so
 * the post-push wiring is unit-tested; only the `pushAndPr` call itself lives
 * in extension.ts because it needs `vscode.workspace`.
 */
export async function markPrCreatedAfterPush(
  orch: PrCreatedTransitioner,
  agentId: string,
): Promise<void> {
  await orch.markPrCreated(agentId);
}
