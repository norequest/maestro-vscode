import type { CardVM, CockpitState, Lane } from "@maestro/cockpit";
import { escapeHtml } from "./html.js";

// ─── Lane layout constants ───────────────────────────────────────────────────

const LANE_TITLES: Record<Lane, string> = {
  working: "Working",
  needsYou: "Needs you",
  conflict: "Conflict",
  done: "Done",
};
// A fixed 4-tuple (not Lane[]) so dropping a lane is a length/type error; the set
// must stay in sync with LANE_TITLES above (its Record<Lane,...> is the compile gate).
const LANE_ORDER: readonly [Lane, Lane, Lane, Lane] = ["working", "needsYou", "conflict", "done"];

// ─── Card helpers ─────────────────────────────────────────────────────────────

function goalLine(card: CardVM): string {
  return card.goal ? `<div class="goal">${escapeHtml(card.goal)}</div>` : "";
}

function diffStat(card: CardVM): string {
  if (!card.diffStat) return "";
  return `<div class="diffstat"><span class="adds">+${card.diffStat.adds}</span> <span class="dels">-${card.diffStat.dels}</span></div>`;
}

function elapsed(card: CardVM): string {
  return card.startedAt ? `<span class="elapsed" data-started="${card.startedAt}"></span>` : "";
}

function anatomy(card: CardVM): string {
  const hasAny =
    card.soul || card.toolsCount !== undefined || (card.skills?.length ?? 0) > 0;
  if (!hasAny) return "";
  const parts: string[] = [];
  if (card.soul) parts.push(`<span class="an-soul">☽ soul</span>`);
  if (card.toolsCount !== undefined)
    parts.push(`<span class="an-tools">🔧 ${card.toolsCount}</span>`);
  if (card.skills?.length)
    parts.push(
      `<span class="an-skills">◆ ${escapeHtml(card.skills[0]!)} ${card.skills.length}</span>`
    );
  return `<div class="anatomy">${parts.join(" · ")}</div>`;
}

/** Pure HTML for one agent card. Every engine-supplied string is escaped. */
export function renderCardHTML(card: CardVM): string {
  return `<section class="card lane-${card.lane}${card.attention ? " attention" : ""}" data-id="${escapeHtml(card.id)}" tabindex="0">
  <header><span class="dot"></span><span class="role">${escapeHtml(card.roleName)}</span><span class="engine">${escapeHtml(card.engineId)}</span>${elapsed(card)}</header>
  ${goalLine(card)}
  <div class="task">${escapeHtml(card.taskDescription)}</div>
  ${diffStat(card)}
  ${anatomy(card)}
</section>`;
}

// ─── Board ────────────────────────────────────────────────────────────────────

function laneSection(lane: Lane, cards: CardVM[]): string {
  const inLane = cards.filter((c) => c.lane === lane);
  const body = inLane.length
    ? inLane.map(renderCardHTML).join("")
    : `<div class="lane-empty"></div>`;
  return `<section class="lane lane-col-${lane}"><h2 class="lane-header">${LANE_TITLES[lane]} <span class="count">${inLane.length}</span></h2>${body}</section>`;
}

export function renderBoard(state: CockpitState): string {
  return `<div class="board">${LANE_ORDER.map((lane) => laneSection(lane, state.cards)).join("")}</div>`;
}

// ─── Drawer helpers (carried over from old render.ts) ─────────────────────────

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
    default: {
      // Exhaustiveness guard: a new AgentState is a loud compile error here.
      const _exhaustive: never = card.state;
      void _exhaustive;
      return "";
    }
  }
}

function detail(card: CardVM): string {
  if (card.state === "done" && card.diff) {
    const files = card.diff.files.map((f) => `<li>${escapeHtml(f)}</li>`).join("");
    return `<div class="summary">${escapeHtml(card.summary ?? "")}</div><ul class="files">${files}</ul>`;
  }
  if (card.state === "done" && card.diffError) {
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
    return `<div class="pr-note">${escapeHtml("Pull request opened. Worktree released, branch kept.")}</div>`;
  }
  return "";
}

// ─── Drawer ───────────────────────────────────────────────────────────────────

function instructionsTab(card: CardVM): string {
  const goal = card.goal ? `<p class="why">${escapeHtml(card.goal)}</p>` : "";
  return `<div class="tab-body" data-tab="instructions"><h3>Task</h3><p>${escapeHtml(card.taskDescription)}</p>${goal}</div>`;
}

function outputTab(card: CardVM): string {
  return `<div class="tab-body" data-tab="output" hidden><pre class="output">${escapeHtml(card.output)}</pre></div>`;
}

function diffTab(card: CardVM): string {
  const files = (card.diff?.files ?? []).map((f) => `<li>${escapeHtml(f)}</li>`).join("");
  const patch = card.diff
    ? `<pre class="patch">${escapeHtml(card.diff.patch)}</pre>`
    : `<p class="ghost">No diff yet.</p>`;
  return `<div class="tab-body" data-tab="diff" hidden><ul class="files">${files}</ul>${patch}</div>`;
}

export function renderDrawer(state: CockpitState): string {
  if (!state.focusedId) return "";
  const focused = state.cards.find((c) => c.id === state.focusedId);
  if (!focused) return "";
  const id = escapeHtml(focused.id);
  const tabs = `<nav class="tabs"><button class="tab active" data-tab="instructions">Instructions</button><button class="tab" data-tab="output">Output</button><button class="tab" data-tab="diff">Diff</button></nav>`;
  const bar = `${approvalPanel(focused)}${steerBox(focused)}${sendBackBox(focused)}<footer class="drawer-actions">${actions(focused)}</footer>`;
  return `<aside class="drawer" data-id="${id}">
  <header class="drawer-head"><span class="role">${escapeHtml(focused.roleName)}</span><span class="engine">${escapeHtml(focused.engineId)}</span><span class="state-pill lane-${focused.lane}">${escapeHtml(focused.state)}</span><button class="drawer-close" data-action="close-drawer" data-id="${id}">×</button></header>
  ${tabs}
  ${instructionsTab(focused)}
  ${outputTab(focused)}
  ${diffTab(focused)}
  ${detail(focused)}
  ${bar}
</aside>`;
}
