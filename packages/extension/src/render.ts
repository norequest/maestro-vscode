import type {
  CardVM,
  CockpitState,
  DelegationVM,
  FloorTileVM,
  Lane,
  TeamGroupVM,
} from "@hallucinate/cockpit";
import { escapeHtml } from "./html.js";
import { normalizeInstructions } from "./instructions-format.js";

/**
 * One attention-queue item, derived structurally from the already-exported
 * `CockpitState` (the `@hallucinate/cockpit` barrel does not re-export the
 * `AttentionVM` name, so we read its element type off `CockpitState.attention`
 * instead of importing it). Most-urgent-first ordering is the reducer's job; the
 * bar just renders one of these at a time.
 */
export type AttentionVM = NonNullable<CockpitState["attention"]>[number];

// ─── Lane / column layout ─────────────────────────────────────────────────────
//
// The prototype board has THREE columns: Working / Needs you / Done. The data
// model has FOUR lanes (working, needsYou, conflict, done). `conflict` cards are
// folded into the "Needs you" column (they keep their own lane value for the
// status accent + dot colour + drawer actions). The fixed tuple below is the
// compile gate: dropping a lane is a length/type error.

const LANE_TITLES: Record<Lane, string> = {
  working: "Working",
  needsYou: "Needs you",
  conflict: "Conflict",
  done: "Done",
};
const LANE_ORDER: readonly [Lane, Lane, Lane, Lane] = ["working", "needsYou", "conflict", "done"];

/** A board column groups one or more data lanes under a single heading. */
interface Column {
  /** A stable key used in the column class hook. */
  key: "working" | "needsYou" | "done";
  title: string;
  /** Which data lanes belong in this column, in order. */
  lanes: Lane[];
}

const COLUMNS: readonly [Column, Column, Column] = [
  { key: "working", title: "Working", lanes: ["working"] },
  { key: "needsYou", title: "Needs you", lanes: ["needsYou", "conflict"] },
  { key: "done", title: "Done", lanes: ["done"] },
];

/**
 * Per-lane empty-state copy (prototype lines 130 / 163 / 191). The prototype's
 * Needs-you line uses an em dash; the project bans em dashes, so it is rephrased
 * with a period ("Nothing needs you right now.").
 */
const EMPTY_COPY: Record<Column["key"], string> = {
  working: "No agents working",
  needsYou: "Nothing needs you right now.",
  done: "Nothing merged yet",
};

// ─── Card helpers ─────────────────────────────────────────────────────────────

/**
 * The lead agent's display name for a delegation/child card. Resolves the card
 * in `cards` whose id matches `leadAgentId`, preferring its role name; falls back
 * to a short slice of the id when the lead is not (yet) on the board.
 */
function leadLabel(cards: CardVM[], leadAgentId: string): string {
  const lead = cards.find((c) => c.id === leadAgentId);
  return lead ? lead.roleName : leadAgentId.slice(0, 8);
}

/**
 * On a delegated child card, a faint "via <leadRole>" marker so the operator can
 * see which lead brought this teammate in. The lead's role name is resolved from
 * the board and escaped; rendered only when the card carries a parentId.
 */
function viaMarker(card: CardVM, cards: CardVM[]): string {
  if (!card.parentId) return "";
  return `<span class="via">via ${escapeHtml(leadLabel(cards, card.parentId))}</span>`;
}

function goalLine(card: CardVM): string {
  return card.goal ? `<div class="goal">${escapeHtml(card.goal)}</div>` : "";
}

/**
 * On a lead card (one that some other card names as its parent), a faint
 * count of its sub-agents in the meta row, so a team run reads as one lead
 * with N sub-agents. Singular "sub-agent" when N===1; nothing when N===0 (so a
 * non-parent card's markup is unchanged). The count comes from the full board.
 */
function subagentsMarker(card: CardVM, cards: CardVM[]): string {
  const n = cards.reduce((acc, c) => (c.parentId === card.id ? acc + 1 : acc), 0);
  if (n === 0) return "";
  const word = n === 1 ? "sub-agent" : "sub-agents";
  return `<span class="subagents">${n} ${word}</span>`;
}

function diffStat(card: CardVM): string {
  // No diffStat yet means the diff has not been computed (still working / no diff
  // attached). Render nothing, rather than a misleading "no changes" line.
  if (!card.diffStat) return "";
  // A run that touched NO files should read honestly, not "+0 -0". Prefer the
  // changed-files list when the card carries one (the authoritative signal), and
  // fall back to the add/delete counts when it does not.
  const noChanges =
    card.diff ? card.diff.files.length === 0 : card.diffStat.adds === 0 && card.diffStat.dels === 0;
  if (noChanges) {
    return `<div class="diffstat diffstat-empty"><span class="nochange">No file changes</span></div>`;
  }
  return `<div class="diffstat"><span class="adds">+${card.diffStat.adds}</span> <span class="dels">-${card.diffStat.dels}</span></div>`;
}

function elapsed(card: CardVM): string {
  return card.startedAt ? `<span class="elapsed" data-started="${card.startedAt}"></span>` : "";
}

/** The live equaliser mark (prototype eqbar keyframes); only on working cards. */
function eqMark(card: CardVM): string {
  if (card.lane !== "working") return "";
  return `<span class="eq" aria-hidden="true"><i></i><i></i><i></i><i></i></span>`;
}

/**
 * The "growing right now" pulse on a WORKING card: a tight added/deleted-lines
 * badge with a single pulsing bar. Shown ONLY while `card.momentum` is set; the
 * reducer clears momentum on an update where the diff did NOT grow, so a present
 * value means "the diff is changing this moment". It is VISUALLY DISTINCT from the
 * always-on `eqMark` ("alive"): a numeric growth badge, not the four-bar liveness
 * mark. The label reflects the REAL direction of growth: "+N" when lines were
 * added, "-N" when lines were deleted (a refactor with `adds:0, dels:N`), and
 * "+N -M" when both grew, so a deletions-only refactor never reads as a bare
 * "+0". Pure: presence and the numbers come straight from `card.momentum`, never
 * recomputed here. The counts are typed numbers, interpolated like diffStat /
 * anatomy.
 */
function momentumMark(card: CardVM): string {
  if (card.lane !== "working" || !card.momentum) return "";
  const { adds, dels } = card.momentum;
  const parts: string[] = [];
  if (adds > 0) parts.push(`+${adds}`);
  if (dels > 0) parts.push(`-${dels}`);
  // No real growth in either direction: render nothing (the reducer clears
  // momentum in this case, so this is a defensive guard against a bare "+0").
  if (!parts.length) return "";
  return `<span class="card-momentum" aria-hidden="true" title="diff growing now"><i></i>${parts.join(" ")}</span>`;
}

/**
 * Human-readable status text for the card-header pill (prototype `pillText`,
 * line ~118). A small map keeps the copy friendly; the colour comes from the
 * lane via `state-pill lane-*` (see style.css).
 */
const PILL_TEXT: Record<CardVM["state"], string> = {
  preparing: "preparing",
  working: "working",
  "awaiting-approval": "needs approval",
  conflict: "conflict",
  done: "ready to review",
  detached: "detached",
  error: "error",
  "merge-cleanup-failed": "cleanup failed",
  "pr-created": "PR opened",
  merged: "merged",
  discarded: "discarded",
  stopped: "stopped",
};

function statusPill(card: CardVM): string {
  return `<span class="state-pill lane-${card.lane} state-${card.state}">${escapeHtml(PILL_TEXT[card.state])}</span>`;
}

/**
 * Inline "needs you" question block (prototype line 153). Shown when an agent is
 * blocked awaiting input. Reuses the existing approval detail fields on CardVM.
 */
function questionBlock(card: CardVM): string {
  if (card.state !== "awaiting-approval" || !card.pendingApprovalId) return "";
  const detail = card.approvalDetail;
  const text = detail
    ? `${escapeHtml(detail.tool)}: ${escapeHtml(detail.description)}`
    : "Waiting on your answer to continue.";
  return `<div class="card-question">${text}</div>`;
}

/**
 * Inline conflict-file block (prototype line 154). Lists the conflicting files
 * so the operator sees the blocker without opening the drawer.
 */
function conflictBlock(card: CardVM): string {
  if (card.state !== "conflict" || !card.conflictFiles?.length) return "";
  const files = card.conflictFiles.map((f) => escapeHtml(f)).join(", ");
  return `<div class="card-conflict">${files}</div>`;
}

/**
 * The faint "live activity" preview on a WORKING card: the last up to 3 non-empty
 * lines the engine streamed (CardVM.tail, derived in the reducer), rendered as a
 * subtle mono block so a busy agent shows what it is doing at a glance without
 * opening the inspector. Shown ONLY on working-lane cards with a non-empty tail;
 * non-working states and an empty/undefined tail render nothing (no empty block).
 * The tail is engine-supplied text, so every line is escaped; it is also capped
 * at 3 lines here as a defence-in-depth, even though the contract already bounds
 * it to at most 3.
 */
function tailBlock(card: CardVM): string {
  if (card.lane !== "working" || !card.tail?.length) return "";
  const lines = card.tail
    .slice(0, 3)
    .map((line) => `<span class="tail-line">${escapeHtml(line)}</span>`)
    .join("");
  return `<div class="card-tail" aria-hidden="true">${lines}</div>`;
}

/**
 * On-card "Review →" button for reviewable cards (prototype lines 157-159 /
 * 185-187). Emits the existing `open-review` action with the agent id; the
 * delegated click handler returns early on `[data-action]`, so this does not
 * also trigger card focus.
 */
function reviewButton(card: CardVM): string {
  const canReview =
    !!card.diff || card.state === "done" || card.state === "conflict" || card.state === "merge-cleanup-failed";
  if (!canReview) return "";
  const ghost = card.lane === "done" ? " ghost" : "";
  return `<button class="card-review${ghost}" data-action="open-review" data-id="${escapeHtml(card.id)}" type="button">Review →</button>`;
}

/**
 * On-card "Remove" button, ONLY for a ready-to-review (done) card. It reuses the
 * existing `discard` verb (drop worktree + branch + forget log); the cockpit
 * reducer then auto-clears the card once it reaches the resolved "discarded"
 * state. Resolved cards (merged/discarded/pr-created) auto-leave the board, so
 * this button is never rendered for them. No new host message is introduced.
 */
function removeButton(card: CardVM): string {
  if (card.state !== "done") return "";
  return `<button class="card-remove" data-action="remove" data-id="${escapeHtml(card.id)}" type="button" title="Discard this run and clear it from the board">Remove</button>`;
}

/** The card footer row: elapsed/diff metadata on the left, Remove + Review on the right. */
function cardFooter(card: CardVM): string {
  // A virtual fleet sub-agent is READ-ONLY: it has no worktree/branch/session, so
  // it is never reviewable, removable, or mergeable. Render no action affordances;
  // the lead stays the single reviewable/mergeable unit. A tiny faint hint
  // stands in so the card still reads as intentionally action-free.
  if (card.virtual) {
    return `<div class="card-footer"><span class="card-readonly">read-only sub-agent</span></div>`;
  }
  const review = reviewButton(card);
  const remove = removeButton(card);
  if (!review && !remove) return "";
  return `<div class="card-footer">${remove}${review}</div>`;
}

function anatomy(card: CardVM): string {
  const hasAny =
    card.soul || (card.toolsCount ?? 0) > 0 || (card.skills?.length ?? 0) > 0;
  if (!hasAny) return "";
  const parts: string[] = [];
  if (card.soul) parts.push(`<span class="an-soul">☽ soul</span>`);
  if ((card.toolsCount ?? 0) > 0) {
    const amberClass = (card.toolsCanWrite ?? 0) > 0 ? " amber" : "";
    parts.push(`<span class="an-tools${amberClass}">🔧 ${card.toolsCount}</span>`);
  }
  if (card.skills?.length)
    parts.push(
      `<span class="an-skills">◆ ${escapeHtml(card.skills[0]!)} ${card.skills.length}</span>`
    );
  return `<div class="anatomy">${parts.join(" · ")}</div>`;
}

/**
 * Pure HTML for one agent card, matching the prototype card anatomy:
 * header (status pill + role name + engine chip + live eq + elapsed), the faint
 * italic "why" goal line, the task text, inline question/conflict blocks, diff
 * stats, the anatomy row, then the footer with the on-card Review button.
 * Done cards are de-emphasised (prototype lines 176-189): they drop the goal
 * line and carry a `.done` modifier that dims the role colour.
 * Every engine-supplied string is escaped.
 */
export function renderCardHTML(card: CardVM, cards: CardVM[] = [], opts: { child?: boolean } = {}): string {
  const isDone = card.lane === "done";
  const goal = isDone ? "" : goalLine(card);
  const childClass = opts.child ? " is-child" : "";
  return `<section class="card lane-${card.lane} state-${card.state}${isDone ? " done" : ""}${card.attention ? " attention" : ""}${childClass}" data-id="${escapeHtml(card.id)}" tabindex="0">
  <header><span class="dot"></span>${statusPill(card)}<span class="role" title="${escapeHtml(card.roleName)}">${escapeHtml(card.roleName)}</span>${eqMark(card)}</header>
  <div class="card-meta"><span class="engine">${escapeHtml(card.engineId)}</span>${viaMarker(card, cards)}${subagentsMarker(card, cards)}${momentumMark(card)}${elapsed(card)}</div>
  ${goal}
  <div class="task">${escapeHtml(card.taskDescription)}</div>
  ${questionBlock(card)}
  ${conflictBlock(card)}
  ${tailBlock(card)}
  ${diffStat(card)}
  ${anatomy(card)}
  ${cardFooter(card)}
</section>`;
}

// ─── Board ────────────────────────────────────────────────────────────────────

/**
 * Reorder a lane's cards so each top-level card is immediately followed by its
 * children that are ALSO in this lane, marking those children for indented
 * rendering. A child whose parent is NOT in this lane (cross-lane or transient)
 * is emitted as a normal top-level card (`child:false`) so nothing disappears.
 */
function orderWithChildren(inCol: CardVM[]): Array<{ card: CardVM; child: boolean }> {
  const idsInCol = new Set(inCol.map((c) => c.id));
  const kids = new Map<string, CardVM[]>();
  for (const c of inCol) {
    if (c.parentId && idsInCol.has(c.parentId)) {
      const list = kids.get(c.parentId) ?? [];
      list.push(c);
      kids.set(c.parentId, list);
    }
  }
  const out: Array<{ card: CardVM; child: boolean }> = [];
  for (const c of inCol) {
    if (c.parentId && idsInCol.has(c.parentId)) continue; // emitted under its parent
    out.push({ card: c, child: false });
    for (const k of kids.get(c.id) ?? []) out.push({ card: k, child: true });
  }
  return out;
}

/**
 * The FLOOR: the default board layout (M10 Phase D). A salience-ordered grid of
 * size+warmth tiles over `state.floor` (built host-side by `selectFloor`), each
 * tile wrapping the existing agent card. The tile's `size`/`warmth` are taken
 * STRAIGHT from the contract (never recomputed here) and surface as
 * `size-* warmth-*` class hooks the stylesheet styles. A child tile is nested via
 * the `is-child` class on the WRAPPER only (margin + dashed accent); the inner
 * card is NOT marked is-child, because that fires the LANE-only elbow connector
 * and 18px indent, which in the Floor grid would point at nothing (the lead sits
 * on a different row) and double-indent the card. A floor id with no matching
 * card is skipped (the board never renders a hole). The Floor renders ONLY from
 * `state.floor`: when it is empty/undefined the body is the quiet placeholder
 * even if `state.cards` is populated, so authors must supply `floor` to assert on
 * card bodies. (In production `selectState` always populates it.)
 */
export function renderFloor(state: CockpitState): string {
  const tiles = state.floor ?? [];
  if (!tiles.length) {
    return `<div class="floor floor-empty"><div class="lane-empty">No agents yet</div></div>`;
  }
  const byId = new Map(state.cards.map((c) => [c.id, c]));
  const tileById = new Map(tiles.map((t) => [t.id, t]));
  const teams = state.teams ?? [];
  const teamByLead = new Map(teams.map((t) => [t.leadId, t]));
  // Every id that belongs to SOME team as a member; those tiles render INSIDE
  // their team tray, never as a top-level sibling.
  const memberSet = new Set<string>();
  for (const t of teams) for (const m of t.memberIds) memberSet.add(m);

  // Track which tile ids have actually been emitted, so a leftover sweep can
  // append any floor tile the team walk did not place. renderFloor must stay a
  // COMPLETE permutation of state.floor: no card may vanish. The classic gap is a
  // depth-2 delegation (lead -> kid -> grandkid): the kid renders as a LEAF in the
  // lead's tray, never as a tray of its own, so its grandchild is in `memberSet`
  // (skipped at top level) yet never emitted inside a tray. The sweep catches it.
  const emitted = new Set<string>();
  // One inner Floor tile: the size+warmth wrapper around the agent card. The
  // nesting cue is the `.floor-tile.is-child` WRAPPER only; do NOT pass the lane
  // `child` flag into the card (it would add the lane elbow/indent). `roleClass`
  // marks a tile's place within its tray (`ft-lead` / `ft-child`) so the tray can
  // span the lead and dim the children. `data-agent-id` + the inner `.card[data-id]`
  // (click/focus contract) are preserved verbatim. Marks the id emitted on success.
  const tileHTML = (tile: FloorTileVM, roleClass = ""): string => {
    const card = byId.get(tile.id);
    if (!card) return "";
    emitted.add(tile.id);
    const childClass = tile.child ? " is-child" : "";
    return `<div class="floor-tile size-${tile.size} warmth-${tile.warmth}${childClass}${roleClass}" data-agent-id="${escapeHtml(tile.id)}">${renderCardHTML(card, state.cards, {})}</div>`;
  };

  const body = tiles
    .map((tile) => {
      // A member tile is emitted inside its team tray (below) or by the sweep, not here.
      if (memberSet.has(tile.id)) return "";
      const team = teamByLead.get(tile.id);
      if (!team) return tileHTML(tile); // a solo agent: a bare floor tile
      // A team lead: a labeled tray ENCLOSING the lead tile + each member tile.
      // If the lead card is missing, render no tray and leave its members for the
      // sweep (they are real cards and must not vanish).
      if (!byId.has(team.leadId)) return "";
      const leadTile = tileHTML(tile, " ft-lead");
      const childTiles = team.memberIds
        .map((mid) => {
          const mtile = tileById.get(mid);
          return mtile ? tileHTML(mtile, " ft-child") : "";
        })
        .join("");
      return teamTrayHTML(team, leadTile + childTiles);
    })
    .join("");
  // Leftover sweep (mirrors selectFloor's completeness guarantee): append any
  // floor tile not yet emitted as a bare tile, in floor order, so nothing is lost.
  const sweep = tiles
    .filter((tile) => !emitted.has(tile.id))
    .map((tile) => tileHTML(tile))
    .join("");
  return `<div class="floor">${body}${sweep}</div>`;
}

/**
 * One team TRAY: a full-width band that visually encloses a lead and its
 * children as a single unit. A header carries a bars glyph, the lead's role name,
 * a faint `engineId · N agents` tag (N = members + the lead), and a right-pushed
 * status pill whose dot colour comes from the team's `tone`. A subtle, quiet
 * `--team-hue` accent gives the team a stable identity without competing with
 * status. Every interpolated value is escaped.
 */
function teamTrayHTML(team: TeamGroupVM, tilesHTML: string): string {
  const tone = team.tone ?? "idle";
  // A missing hue falls back to a quiet off-status identity hue (268, violet), so
  // it never reads as a status colour (0/red, ~210/blue, ~140/green). Kept in sync
  // with the CSS `var(--team-hue, 268)` fallback.
  const hue = team.hue ?? 268;
  const leadRole = team.leadRoleName ?? "";
  const agentCount = team.memberIds.length + 1;
  const tag = `${team.leadEngineId ?? ""} · ${agentCount} agents`;
  const status = team.statusLabel ?? "";
  return `<section class="floor-team tone-${escapeHtml(tone)}" data-team-lead="${escapeHtml(team.leadId)}" style="--team-hue:${escapeHtml(String(hue))}" aria-label="Team ${escapeHtml(leadRole)}">
    <header class="ft-header">
      <span class="ft-bars" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
      <span class="ft-name">${escapeHtml(leadRole)}</span>
      <span class="ft-tag">${escapeHtml(tag)}</span>
      <span class="ft-status"><span class="ft-dot"></span>${escapeHtml(status)}</span>
    </header>
    <div class="ft-body">${tilesHTML}</div>
  </section>`;
}

function columnSection(col: Column, cards: CardVM[]): string {
  const inCol = cards.filter((c) => col.lanes.includes(c.lane));
  const body = inCol.length
    ? orderWithChildren(inCol)
        .map(({ card, child }) => renderCardHTML(card, cards, { child }))
        .join("")
    : `<div class="lane-empty">${escapeHtml(EMPTY_COPY[col.key])}</div>`;
  // "Clear all" lives only on the Done lane header, and only when it holds at
  // least one (ready-to-review) card. It emits the new clear-done-lane message
  // (a bulk discard, confirmed host-side). Hidden on an empty lane.
  const clearAll =
    col.key === "done" && inCol.length > 0
      ? `<button class="lane-clear" data-action="clear-done-lane" type="button">Clear all</button>`
      : "";
  return `<section class="lane lane-col-${col.key}">
    <h2 class="lane-header"><span class="lane-dot"></span><span class="lane-title">${col.title}</span><span class="count">${inCol.length}</span>${clearAll}</h2>
    <div class="lane-cards">${body}</div>
  </section>`;
}

/** The board header (prototype lines 84-102): brand, counts, +New agent, Library. */
function boardHeader(state: CockpitState): string {
  const counts = laneCounts(state.cards);
  // "Need you" must be honest: count agents that need a decision PLUS every
  // pending delegation proposal (rendered in the strip above the lanes), so the
  // header total matches what is actually awaiting the lead.
  const needsYou = counts.needsYou + counts.conflict + (state.delegations?.length ?? 0);
  const total = state.cards.length;
  const agentWord = total === 1 ? "agent" : "agents";
  return `<header class="board-header">
    <div class="bh-left">
      <span class="bh-eq" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
      <span class="bh-title">Hallucinate</span>
      <span class="bh-sep"></span>
      <span class="bh-meta">${total} ${agentWord}&ensp;·&ensp;branch <span class="bh-branch">main</span></span>
      <button class="bh-newagent" data-action="new-task" type="button"><span class="plus">+</span>New task</button>
    </div>
    <div class="bh-right">
      <div class="bh-counts">
        <span class="bh-count working"><span class="dot"></span>${counts.working} working</span>
        <span class="bh-count needs"><span class="dot"></span>${needsYou} need you</span>
        <span class="bh-count done"><span class="dot"></span>${counts.done} merged</span>
      </div>
      <span class="bh-sep"></span>
      <button class="bh-history" data-action="open-history" type="button">History</button>
      <button class="bh-library" data-action="open-library" data-lib-tab="agents" type="button">Library</button>
    </div>
  </header>`;
}

interface LaneCounts {
  working: number;
  needsYou: number;
  conflict: number;
  done: number;
}

function laneCounts(cards: CardVM[]): LaneCounts {
  const counts: LaneCounts = { working: 0, needsYou: 0, conflict: 0, done: 0 };
  for (const c of cards) counts[c.lane]++;
  // Touch LANE_ORDER/LANE_TITLES so a renamed/dropped lane is a compile error.
  void LANE_ORDER;
  void LANE_TITLES;
  return counts;
}

/**
 * The status bar (prototype lines 198-204): N running · M awaiting review, plus
 * the board-layout toggle (M10 Phase D). The toggle ("Floor" / "Status") lets the
 * operator flip between the default Floor and the status lane columns; the active
 * tab is webview-local state passed in as `groupByStatus`. The two tabs are a
 * mutually-exclusive choice, so the group is a `radiogroup` of `radio` buttons
 * with `aria-checked` + a roving tabindex (not a button group with `aria-pressed`).
 */
function statusBar(state: CockpitState, groupByStatus = false): string {
  const counts = laneCounts(state.cards);
  const awaiting = counts.needsYou + counts.conflict;
  // A real two-segment control: a radiogroup whose ACTIVE tab reads as a raised
  // segment (see .layout-tab.active in app.css). Labels are "Floor" / "Status" so
  // the pair reads as one segmented control.
  const layoutToggle = `<span class="board-layout-toggle" role="radiogroup" aria-label="Board layout"><button class="layout-tab${!groupByStatus ? " active" : ""}" role="radio" aria-checked="${!groupByStatus}" tabindex="${!groupByStatus ? "0" : "-1"}" data-action="set-board-layout" data-layout="floor" type="button">Floor</button><button class="layout-tab${groupByStatus ? " active" : ""}" role="radio" aria-checked="${groupByStatus}" tabindex="${groupByStatus ? "0" : "-1"}" data-action="set-board-layout" data-layout="status" type="button">Status</button></span>`;
  // The branch chip and the two counters are passive READOUTS, not buttons: they
  // carry no data-action and read as plain status (the counters get a small
  // leading dot, the branch a "Current repo branch" title), so a click never
  // looks like it should do something.
  return `<div class="status-bar">
    <span class="sb-branch" title="Current repo branch"><svg class="sb-branch-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="6.5" cy="6" r="2.5"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="7" r="2.5"/><path d="M6.5 8.5v7M9 7h4.5a3 3 0 013 3"/></svg>main</span>
    ${layoutToggle}
    <span class="sb-running"><span class="sb-dot"></span>${counts.working} running</span>
    <span class="sb-awaiting"><span class="sb-dot"></span>${awaiting} awaiting review</span>
    <span class="sb-version">Hallucinate</span>
  </div>`;
}

/**
 * One pending delegation proposal: which lead is asking, the teammate role the
 * lead wants, and the self-contained subtask, plus Approve / Deny buttons.
 *
 * Modeled on `approvalPanel`'s Allow/Deny buttons: the buttons carry a
 * `data-action` verb and a `data-id` that is the DELEGATION id (not an agent id),
 * so the webview maps a click straight to the frozen approve/deny-delegation
 * messages. Every dynamic string (lead label, role, task) is escaped.
 */
function delegationCard(proposal: DelegationVM, cards: CardVM[]): string {
  const id = escapeHtml(proposal.id);
  const lead = escapeHtml(leadLabel(cards, proposal.leadAgentId));
  const role = escapeHtml(proposal.roleName);
  const task = escapeHtml(proposal.task);
  return `<div class="delegation" data-id="${id}">
    <div class="delegation-head"><span class="delegation-lead">${lead}</span><span class="delegation-asks">wants to bring in</span><span class="delegation-role">${role}</span></div>
    <div class="delegation-task">${task}</div>
    <div class="delegation-actions"><button class="delegation-approve" data-action="approve-delegation" data-id="${id}" type="button">Approve</button><button class="delegation-deny" data-action="deny-delegation" data-id="${id}" type="button">Deny</button></div>
  </div>`;
}

/**
 * The pending-delegations block: a prominent "needs your decision" strip of
 * delegation proposals shown above the lanes. Renders nothing when there are no
 * pending proposals.
 */
function delegationsBlock(state: CockpitState): string {
  // `delegations` is required by the protocol, but older CockpitState literals
  // (and the few tests that omit it) can leave it undefined at runtime, where
  // types are erased; treat a missing list as empty rather than throwing.
  const pending = state.delegations ?? [];
  if (!pending.length) return "";
  const cards = pending.map((p) => delegationCard(p, state.cards)).join("");
  const label = pending.length === 1 ? "DELEGATION" : "DELEGATIONS";
  return `<section class="delegations" aria-label="Pending delegations">
    <div class="delegations-eyebrow"><span class="delegations-dot"></span>${label} · NEEDS YOU<span class="delegations-count">${pending.length}</span></div>
    <div class="delegations-list">${cards}</div>
  </section>`;
}

// ─── Attention bar (M10 Phase C) ───────────────────────────────────────────────

/**
 * A short, human label for one attention item, derived from its `kind`. For an
 * approval, prefer the structured `approvalDetail` (tool + description) when the
 * engine supplied it; otherwise fall back to a neutral phrase. Every engine /
 * approval-supplied substring is escaped; the per-kind phrases are static
 * literals. The remaining kinds map to a fixed phrase each.
 */
function attentionLabel(item: AttentionVM): string {
  switch (item.kind) {
    case "approval": {
      const detail = item.approvalDetail;
      return detail
        ? `${escapeHtml(detail.tool)}: ${escapeHtml(detail.description)}`
        : "wants approval";
    }
    case "conflict":
      return "hit a merge conflict";
    case "review":
      return "ready to review";
    case "error":
      return "errored";
    case "detached":
      return "detached";
    case "cleanup":
      return "merge cleanup failed";
    default: {
      // Exhaustiveness guard: a new attention kind is a loud compile error here.
      const _exhaustive: never = item.kind;
      void _exhaustive;
      return "";
    }
  }
}

/**
 * The inline PRIMARY action for one attention item, reusing the EXACT
 * data-action verbs (and data-* attributes) the rest of the board already emits,
 * so the existing delegated click handler routes these without any change:
 *   approval -> Allow + Deny (copied verbatim from `approvalPanel`: data-action
 *               approve/deny + data-id + data-approval-id; the decision is the
 *               verb), conflict -> resolve-conflict, review/error/detached ->
 *               open-review, cleanup -> retry-cleanup. The id is escaped.
 */
function attentionAction(item: AttentionVM): string {
  const id = escapeHtml(item.id);
  switch (item.kind) {
    case "approval": {
      const approvalId = escapeHtml(item.pendingApprovalId ?? "");
      return (
        `<button class="attn-act attn-allow" data-action="approve" data-id="${id}" data-approval-id="${approvalId}" type="button">Allow</button>` +
        `<button class="attn-act attn-deny" data-action="deny" data-id="${id}" data-approval-id="${approvalId}" type="button">Deny</button>`
      );
    }
    case "conflict":
      return `<button class="attn-act" data-action="resolve-conflict" data-id="${id}" type="button">Resolve</button>`;
    case "review":
    case "error":
    case "detached":
      return `<button class="attn-act" data-action="open-review" data-id="${id}" type="button">Review</button>`;
    case "cleanup":
      return `<button class="attn-act" data-action="retry-cleanup" data-id="${id}" type="button">Retry cleanup</button>`;
    default: {
      const _exhaustive: never = item.kind;
      void _exhaustive;
      return "";
    }
  }
}

/**
 * The sticky ATTENTION BAR: ONE attention item at a time with an "n of m"
 * counter, an urgency marker, the role name, a short human label, a clickable
 * focus region, and an inline primary action. Returns "" for an empty queue (no
 * bar). `index` is clamped into range via modulo so the webview's auto-advance
 * ticker can pass any monotonic counter. It reuses existing messages only: the
 * label region posts `focus`, and the primary action posts the verb for the
 * item's kind. Every engine-supplied string is escaped.
 */
export function renderAttentionBar(attention: AttentionVM[], index: number): string {
  if (!attention.length) return "";
  const i = (((index % attention.length) + attention.length) % attention.length);
  const item = attention[i]!;
  const id = escapeHtml(item.id);
  const role = escapeHtml(item.roleName);
  const counter = `${i + 1} of ${attention.length}`;
  return `<section class="attention-bar kind-${escapeHtml(item.kind)}" aria-label="Needs you" aria-live="polite" aria-atomic="true">
    <span class="attn-mark" aria-hidden="true"></span>
    <button class="attn-label" data-action="focus" data-id="${id}" type="button"><span class="attn-role">${role}</span><span class="attn-text">${attentionLabel(item)}</span></button>
    <span class="attn-count">${counter}</span>
    <span class="attn-actions">${attentionAction(item)}</span>
  </section>`;
}

/**
 * The full Board: header, the sticky attention bar, the pending-delegations
 * block, the central layout, and the status bar (which carries the layout
 * toggle). The central layout DEFAULTS to the Floor (size+warmth tiles, M10
 * Phase D); `opts.groupByStatus` swaps it for the lane columns. The header,
 * attention bar, delegations, and status bar are identical in both layouts.
 * Pre-existing callers expect a single string; the drawer is appended separately
 * by the webview client. The attention bar sits between the header and the
 * layout, initialised at index 0 (the most-urgent item); the webview ticker
 * re-renders just that bar.
 */
export function renderBoard(state: CockpitState, opts: { groupByStatus?: boolean } = {}): string {
  const groupByStatus = opts.groupByStatus ?? false;
  const layout = groupByStatus
    ? `<div class="lanes">${COLUMNS.map((col) => columnSection(col, state.cards)).join("")}</div>`
    : renderFloor(state);
  return `<div class="board-shell">
  <div class="board">
    ${boardHeader(state)}
    ${renderAttentionBar(state.attention ?? [], 0)}
    ${delegationsBlock(state)}
    ${layout}
    ${statusBar(state, groupByStatus)}
  </div>
</div>`;
}

// ─── Drawer helpers ───────────────────────────────────────────────────────────

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
  return `<form class="steer-form" data-action="steer" data-id="${id}"><input type="text" class="steer-input" placeholder="Steer the agent…" aria-label="Steer agent" /><button type="submit">Steer</button></form>`;
}

function sendBackBox(card: CardVM): string {
  if (card.state !== "done" && card.state !== "conflict") return "";
  const id = escapeHtml(card.id);
  return `<form class="sendback-form" data-action="sendBack" data-id="${id}"><textarea class="sendback-input" rows="2" placeholder="Add a note to send back…" aria-label="Send back with feedback"></textarea><button type="submit">Send back</button></form>`;
}

function actions(card: CardVM): string {
  const id = escapeHtml(card.id);
  const stop = `<button data-action="stop" data-id="${id}">Stop</button>`;
  const merge = `<button data-action="merge" data-id="${id}">Merge</button>`;
  const discard = `<button data-action="discard" data-id="${id}">Discard</button>`;
  const resume = `<button data-action="resume" data-id="${id}">Resume</button>`;
  const resolveConflict = `<button data-action="resolve-conflict" data-id="${id}">Resolve in Editor</button>`;
  const finishMerge = `<button data-action="finish-merge" data-id="${id}">Finish Merge</button>`;
  const createPr = `<button data-action="create-pr" data-id="${id}">Create PR</button>`;
  const retryCleanup = `<button data-action="retry-cleanup" data-id="${id}">Retry Cleanup</button>`;
  switch (card.state) {
    case "working":
    case "awaiting-approval":
    case "preparing":
      return stop;
    case "done": {
      // A run that finished with an EMPTY diff (computed, zero files) produced no
      // changes, so there is nothing to land: discard-only. A missing diff means
      // it is still computing, or it failed (diffError), in which case the branch
      // may still hold commits, so merge stays reachable (audit Issue 23).
      const noChanges = !!card.diff && card.diff.files.length === 0;
      return noChanges ? discard : `${merge} ${createPr} ${discard}`;
    }
    case "detached":
      return `${merge} ${discard}`;
    case "conflict":
      return `${resolveConflict} ${finishMerge} ${discard}`;
    case "merge-cleanup-failed":
      return `${retryCleanup} ${discard}`;
    case "stopped":
      // A stopped run can be resumed in its worktree or discarded; never merged.
      return `${resume} ${discard}`;
    case "error":
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
    return `<div class="detail-block"><div class="summary">${escapeHtml(card.summary ?? "")}</div><ul class="files">${files}</ul></div>`;
  }
  if (card.state === "done" && card.diffError) {
    return `<div class="detail-block"><div class="summary">${escapeHtml(card.summary ?? "")}</div><div class="diff-error">Could not compute diff: ${escapeHtml(card.diffError)}</div></div>`;
  }
  if (card.state === "conflict" && card.conflictFiles) {
    const files = card.conflictFiles.map((f) => `<li>${escapeHtml(f)}</li>`).join("");
    return `<div class="detail-block"><div class="conflict">Resolve the conflict below, then continue the run.</div><ul class="files">${files}</ul></div>`;
  }
  if (card.state === "merge-cleanup-failed" && card.error) {
    return `<div class="detail-block"><pre class="error">${escapeHtml(card.error)}</pre><div class="cleanup-note">The merge succeeded (your code is in the branch), but the worktree cleanup failed. Click "Retry Cleanup" to remove the worktree, or "Discard" to clean up manually.</div></div>`;
  }
  if (card.state === "error" && card.error) {
    return `<div class="detail-block"><pre class="error">${escapeHtml(card.error)}</pre></div>`;
  }
  if (card.state === "pr-created") {
    return `<div class="detail-block"><div class="pr-note">${escapeHtml("Pull request opened. Worktree released, branch kept.")}</div></div>`;
  }
  return "";
}

/**
 * The editable TASK section between the drawer header and the tabs (prototype
 * lines 227-230). A mono "TASK" eyebrow over an input pre-filled with the task.
 *
 * NOTE: there is no existing host verb for committing a task edit this pass, so
 * the input carries a placeholder `data-action="edit-task"` plus its `data-id`.
 * A future router pass wires it (markup + style only here).
 */
function taskSection(card: CardVM, cards: CardVM[] = []): string {
  const id = escapeHtml(card.id);
  // A virtual (read-only) fleet sub-agent has no editable task: it inherits the
  // lead's run. Render a STATIC task line. When the sub-agent's own task is empty
  // or heading-like (a stray "# ..." block scalar leaking through), stand in a
  // clear "Delegated by <lead>" instead, resolving the lead role from the parent
  // card; fall back to "lead" when the parent is unknown.
  if (card.virtual) {
    const raw = card.taskDescription?.trim() ?? "";
    const headingLike = raw === "" || raw.startsWith("#");
    const lead = card.parentId
      ? cards.find((c) => c.id === card.parentId)?.roleName ?? "lead"
      : "lead";
    const text = headingLike ? `Delegated by ${lead}` : card.taskDescription;
    return `<section class="drawer-task">
    <div class="drawer-task-label">TASK</div>
    <div class="drawer-task-static">${escapeHtml(text)}</div>
  </section>`;
  }
  // TODO(next-pass): wire edit-task (reuse the steer/task mechanism, no new host message type).
  return `<section class="drawer-task">
    <div class="drawer-task-label">TASK</div>
    <input class="drawer-task-input" type="text" value="${escapeHtml(card.taskDescription)}" data-action="edit-task" data-id="${id}" aria-label="Edit task" />
  </section>`;
}

/**
 * The per-state drawer footer (prototype lines 288-333). Reuses the existing
 * `approvalPanel`, `steerBox`, `sendBackBox`, and `actions` helpers so the wired
 * data-action verbs are unchanged. Two prototype controls have no existing verb:
 * the working Pause/Resume toggle and the blocked "Answer to unblock…" input;
 * both render with a placeholder data-action and a TODO for the next pass.
 */
function drawerFooter(card: CardVM): string {
  const id = escapeHtml(card.id);

  // A virtual fleet sub-agent is READ-ONLY: no approval panel, steer box, send-back
  // box, or merge/discard actions. Its drawer is a view-only window onto the
  // sub-agent's output; the lead remains the only actionable unit.
  if (card.virtual) {
    return `<footer class="drawer-actions drawer-footer-readonly"><span class="drawer-readonly-note">This is a read-only sub-agent. Act on the lead instead.</span></footer>`;
  }

  // BLOCKED (awaiting input): the prototype shows a waiting note + an
  // "Answer to unblock…" input. When the engine exposes a structured approval,
  // keep the real Approve/Deny panel and steer box above the note.
  if (card.state === "awaiting-approval") {
    // TODO(next-pass): wire answer-to-unblock (free-text answer for blocked agents).
    const answerRow = card.engineCapabilities?.approvals
      ? ""
      : `<div class="drawer-blocked-row">
        <input class="drawer-answer-input" type="text" placeholder="Answer to unblock…" data-action="answer-unblock" data-id="${id}" aria-label="Answer to unblock the agent" />
        <button class="drawer-answer-send" data-action="answer-unblock" data-id="${id}" type="button">Send answer</button>
      </div>`;
    return `${approvalPanel(card)}${steerBox(card)}<footer class="drawer-actions drawer-footer-blocked">
      <div class="drawer-blocked-note">This agent is waiting on your answer to continue.</div>
      ${answerRow}
      ${actions(card)}
    </footer>`;
  }

  // WORKING: Pause/Resume toggle + Stop, then a Steer row.
  if (card.state === "working" || card.state === "preparing") {
    // TODO(next-pass): wire pause/resume toggle (no existing host verb yet).
    const pause = `<button class="drawer-pause" data-action="pause-toggle" data-id="${id}" type="button">Pause</button>`;
    return `<footer class="drawer-actions drawer-footer-working">${pause}${actions(card)}${steerBox(card)}</footer>`;
  }

  // REVIEW (done): Approve & merge / Send back / Steer, plus the merge/discard actions.
  // CONFLICT: resolve-conflict / finish-merge / discard + send-back note.
  // Everything else (detached, error, pr-created, merge-cleanup-failed, merged,
  // discarded, stopped): the plain action row.
  return `${sendBackBox(card)}<footer class="drawer-actions">${actions(card)}</footer>`;
}

// ─── Drawer ───────────────────────────────────────────────────────────────────

/**
 * The Instructions tab: the agent's ROLE brief (role.md), NOT the task. The task
 * is shown in the TASK box above the tabs and the goal as the faint card line, so
 * neither is duplicated here. Instructions are multi-line markdown (headings,
 * blank lines, possibly a fenced example), so they render in a pre-wrapped block
 * (`.instr-body` keeps the line breaks) rather than a `<p>` that collapses
 * whitespace. The text is engine/role-supplied, so it is always escaped. When no
 * instructions are attached, a small muted placeholder stands in (never the task).
 */
function instructionsTab(card: CardVM): string {
  const body = card.instructions
    ? `<pre class="instr-body">${escapeHtml(normalizeInstructions(card.instructions))}</pre>`
    : `<p class="instr-empty">No instructions.</p>`;
  return `<div class="tab-body" data-tab="instructions"><div class="tab-label">ROLE · role.md</div>${body}</div>`;
}

function outputTab(card: CardVM): string {
  return `<div class="tab-body" data-tab="output" hidden><pre class="output">${escapeHtml(card.output)}</pre></div>`;
}

function diffTab(card: CardVM): string {
  const files = (card.diff?.files ?? []).map((f) => `<li>${escapeHtml(f)}</li>`).join("");
  const patch = card.diff
    ? `<pre class="patch">${escapeHtml(card.diff.patch)}</pre>`
    : `<p class="ghost">No diff yet.<br>This agent is still working.</p>`;

  // Show "Open full review" for cards that have a diff or are in a conflict /
  // cleanup-failed state (where the review panel provides actionable controls).
  const hasDiffOrConflict =
    !!card.diff || card.state === "conflict" || card.state === "merge-cleanup-failed";
  const openReviewBtn = hasDiffOrConflict
    ? `<button class="open-review-btn" data-action="open-review" data-id="${escapeHtml(card.id)}">Open full review →</button>`
    : "";

  return `<div class="tab-body" data-tab="diff" hidden>${openReviewBtn}<ul class="files">${files}</ul>${patch}</div>`;
}

/**
 * The docked inspector for the focused agent, matching the prototype drawer
 * (lines 206-337): header (role + chips + close), the faint goal line, the
 * Instructions / Output / Diff tabs, an inline detail block, and the footer
 * action bar (approval panel, steer/send-back boxes, and the state actions).
 *
 * It docks as a non-modal side panel beside the board (see `.drawer` in app.css),
 * so the board stays visible and every other agent keeps rendering while one is
 * focused. The header close button (`data-action="close-drawer"`) is the close
 * path; there is no full-screen scrim dimming the board.
 */
export function renderDrawer(state: CockpitState): string {
  if (!state.focusedId) return "";
  const focused = state.cards.find((c) => c.id === state.focusedId);
  if (!focused) return "";
  const id = escapeHtml(focused.id);
  const goal = focused.goal ? `<div class="drawer-goal">${escapeHtml(focused.goal)}</div>` : "";
  const tabs = `<nav class="tabs"><button class="tab active" data-tab="instructions">Instructions</button><button class="tab" data-tab="output">Output</button><button class="tab" data-tab="diff">Diff</button></nav>`;
  const bar = drawerFooter(focused);
  return `<aside class="drawer" data-id="${id}">
  <header class="drawer-head">
    <span class="drawer-eq" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
    <div class="drawer-id">
      <span class="role" title="${escapeHtml(focused.roleName)}">${escapeHtml(focused.roleName)}</span>
      <span class="drawer-chips"><span class="state-pill lane-${focused.lane} state-${focused.state}">${escapeHtml(PILL_TEXT[focused.state])}</span><span class="engine">${escapeHtml(focused.engineId)}</span></span>
    </div>
    <button class="drawer-close" data-action="close-drawer" data-id="${id}">×</button>
  </header>
  ${goal}
  ${taskSection(focused, state.cards)}
  ${tabs}
  <div class="drawer-body">
    ${instructionsTab(focused)}
    ${outputTab(focused)}
    ${diffTab(focused)}
    ${detail(focused)}
  </div>
  ${bar}
</aside>`;
}
