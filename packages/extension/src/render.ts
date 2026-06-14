import { isTerminalState } from "@maestro/core";
import type { CardVM } from "@maestro/cockpit";
import { escapeHtml } from "./html.js";

function approvalPanel(card: CardVM): string {
  if (
    card.state !== "awaiting-approval" ||
    !card.pendingApprovalId ||
    !card.engineCapabilities?.approvals
  ) {
    return "";
  }
  const id = escapeHtml(card.id);
  const approvalId = escapeHtml(card.pendingApprovalId);
  const detailHtml = card.approvalDetail
    ? `<div class="approval-detail"><span class="approval-tool">${escapeHtml(card.approvalDetail.tool)}</span><span class="approval-summary">${escapeHtml(card.approvalDetail.description)}</span></div>`
    : "";
  return `<div class="approval-panel">${detailHtml}<button data-action="approve" data-id="${id}" data-approval-id="${approvalId}">Allow</button><button data-action="deny" data-id="${id}" data-approval-id="${approvalId}">Deny</button></div>`;
}

function steerBox(card: CardVM): string {
  if (!card.engineCapabilities?.steerable) return "";
  if (card.state !== "working" && card.state !== "awaiting-approval") return "";
  const id = escapeHtml(card.id);
  return `<form class="steer-form" data-action="steer" data-id="${id}"><input type="text" class="steer-input" placeholder="Send guidance..." aria-label="Steer agent" /><button type="submit">Send</button></form>`;
}

function sendBackBox(card: CardVM): string {
  if (card.state !== "done" && card.state !== "conflict") return "";
  const id = escapeHtml(card.id);
  return `<form class="sendback-form" data-action="sendBack" data-id="${id}"><textarea class="sendback-input" rows="2" placeholder="Feedback for another attempt..." aria-label="Send back with feedback"></textarea><button type="submit">Send back</button></form>`;
}

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
      return `${merge} ${createPr} ${discard}`;
    case "detached":
      return `${merge} ${discard}`;
    case "conflict":
      return `${resolveConflict} ${finishMerge} ${discard}`;
    case "merge-cleanup-failed":
      return `${retryCleanup} ${discard}`;
    case "error":
    case "stopped":
    case "pr-created":
      return discard;
    case "merged":
    case "discarded":
      return "";
  }
}

function detail(card: CardVM): string {
  if (card.state === "done" && card.diff) {
    const files = card.diff.files.map((f) => `<li>${escapeHtml(f)}</li>`).join("");
    return `<div class="summary">${escapeHtml(card.summary ?? "")}</div><ul class="files">${files}</ul>`;
  }
  if (card.state === "done" && card.diffError) {
    // The diff could not be computed. Surface the error so the user does not
    // merge blind (the merge/discard controls still render in actions()).
    return `<div class="summary">${escapeHtml(card.summary ?? "")}</div><div class="diff-error">Could not compute diff: ${escapeHtml(card.diffError)}</div>`;
  }
  if (card.state === "conflict" && card.conflictFiles) {
    const files = card.conflictFiles.map((f) => `<li>${escapeHtml(f)}</li>`).join("");
    return `<div class="conflict">Merge conflict in:</div><ul class="files">${files}</ul>`;
  }
  if (card.state === "merge-cleanup-failed" && card.error) {
    return `<pre class="error">${escapeHtml(card.error)}</pre><div class="cleanup-note">The merge succeeded (your code is in the branch), but the worktree cleanup failed. Click "Retry Cleanup" to remove the worktree, or "Discard" to clean up manually.</div>`;
  }
  if (card.state === "error" && card.error) {
    return `<pre class="error">${escapeHtml(card.error)}</pre>`;
  }
  if (card.state === "pr-created") {
    // Terminal note: the PR was opened, the worktree was released, but the
    // branch was kept so the pull request keeps its commits.
    return `<div class="pr-note">${escapeHtml("Pull request opened. Worktree released, branch kept.")}</div>`;
  }
  return "";
}

/** Pure HTML for one agent card. Every engine-supplied string is escaped. */
export function renderCardHTML(card: CardVM): string {
  const canApprove = card.engineCapabilities?.approvals ?? false;
  // Only badge a LIVE agent as auto-approving. A terminal card (merged,
  // discarded, detached, error, etc.) is not running, so "auto" would be
  // misleading. Liveness is the core's single source of truth.
  const autoBadge =
    !canApprove && !isTerminalState(card.state)
      ? `<span class="badge">auto</span>`
      : "";
  return `<section class="card state-${card.state}${card.attention ? " attention" : ""}" data-id="${escapeHtml(card.id)}">
  <header><span class="role">${escapeHtml(card.roleName)}</span><span class="engine">${escapeHtml(card.engineId)}</span>${autoBadge}<span class="status">${card.state}</span></header>
  <pre class="output">${escapeHtml(card.output)}</pre>
  ${detail(card)}
  ${approvalPanel(card)}
  ${steerBox(card)}
  ${sendBackBox(card)}
  <footer>${actions(card)}</footer>
</section>`;
}
