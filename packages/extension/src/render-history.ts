/**
 * Pure HTML for the in-session HISTORY view (M10 Phase F). No DOM, no vscode, no
 * Date.now / side effects: `renderHistory` is a pure function of `CockpitState`.
 * A full-page view shell like review-render / anatomy-render: a sticky head
 * (title + back-to-board) over a scrolling, newest-first activity timeline.
 *
 * Every entry-supplied string (label, roleName, agentId, kind) is escaped before
 * interpolation. The numeric fields (`seq`, `at`) are emitted as data-* hooks;
 * the visible time is left to a possible client-side ticker so this stays pure.
 */

import type { CockpitState } from "@hallucinate/cockpit";
import { escapeHtml } from "./html.js";

/**
 * One history row, derived structurally from the already-exported `CockpitState`
 * (mirrors render.ts's `AttentionVM`): the `@hallucinate/cockpit` barrel does
 * re-export `HistoryEntryVM`, but reading the element type off
 * `CockpitState.history` keeps this in lockstep with the contract automatically.
 */
type HistoryItem = NonNullable<CockpitState["history"]>[number];

/**
 * One timeline row, wrapped in an `<li class="history-row">` for real list
 * semantics. The inner element is a per-kind accent dot, the escaped label, an
 * optional role chip, and a time hint emitted as `data-at` (formatted by a client
 * ticker, if any). `data-seq` is the stable element hook.
 *
 * FOCUS GATING: an entry is interactive ONLY when it names an agent that is STILL
 * on the board (`presentIds`), so a click can actually jump back to a live card.
 * Such a row renders as a real `<button type="button">` (keyboard-reachable, SR
 * role) carrying `history-entry history-focusable` + `data-id`, which keeps the
 * router's `closest('.history-entry[data-id]')` match working. An entry whose
 * agent already left the board (merged/discarded) or that names no agent is inert:
 * a plain non-focusable `<div>` with no `data-id`, so there is no dead focus.
 */
function historyEntry(entry: HistoryItem, presentIds: Set<string>): string {
  const kind = escapeHtml(entry.kind);
  const label = escapeHtml(entry.label);
  const roleChip = entry.roleName
    ? `<span class="history-role">${escapeHtml(entry.roleName)}</span>`
    : "";
  const inner = `<span class="history-dot hk-${kind}" aria-hidden="true"></span>
    <span class="history-label">${label}</span>
    ${roleChip}
    <span class="history-time" data-at="${entry.at}"></span>`;

  const focusable = entry.agentId !== undefined && presentIds.has(entry.agentId);
  const cell = focusable
    ? `<button class="history-entry history-focusable" type="button" data-seq="${entry.seq}" data-id="${escapeHtml(entry.agentId!)}">
    ${inner}
  </button>`
    : `<div class="history-entry" data-seq="${entry.seq}">
    ${inner}
  </div>`;

  return `<li class="history-row">${cell}</li>`;
}

/**
 * The full-page History view. The list in `state.history` is ALREADY newest-first
 * (the cockpit `selectHistory` reversed it), so it is rendered as-is, never
 * re-sorted. An empty or undefined history renders a quiet placeholder, not an
 * empty list shell. The back button posts `close-history` for the sibling router
 * to return to the board. The container is a labelled region and the rows live in
 * a real `<ul>` so heading + list navigation work for screen-reader users.
 */
export function renderHistory(state: CockpitState): string {
  const entries = state.history ?? [];
  // Only entries whose agent is still on the board may be focusable (no dead focus).
  const presentIds = new Set(state.cards.map((c) => c.id));
  const body = entries.length
    ? `<ul class="history-list">${entries.map((e) => historyEntry(e, presentIds)).join("")}</ul>`
    : `<div class="history-empty">No activity yet.</div>`;
  return `<div class="history" role="region" aria-label="Activity history">
  <header class="history-head">
    <button class="history-close" data-action="close-history" type="button">&larr; Board</button>
    <h2 class="history-title">Activity</h2>
  </header>
  <div class="history-body">
    ${body}
  </div>
</div>`;
}
