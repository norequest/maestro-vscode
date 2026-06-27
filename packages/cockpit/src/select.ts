import type { AgentState } from "@hallucinate/core";
import type {
  AttentionVM,
  CardVM,
  CockpitState,
  FloorTileVM,
  HistoryEntryVM,
  TeamGroupVM,
  TileSize,
  TileWarmth,
} from "./protocol.js";
import type { CockpitModel } from "./reducer.js";
import { teamHue } from "./crest.js";

function compareCards(a: CardVM, b: CardVM): number {
  if (a.attention !== b.attention) return a.attention ? -1 : 1;
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

/**
 * Attention state -> the bar's `kind` (label + primary action). Only the six
 * states for which `stateNeedsAttention` is true appear here; any other state
 * carries no attention entry.
 */
const KIND_BY_STATE: Partial<Record<AgentState, AttentionVM["kind"]>> = {
  "awaiting-approval": "approval",
  conflict: "conflict",
  done: "review",
  error: "error",
  detached: "detached",
  "merge-cleanup-failed": "cleanup",
};

/** Urgency rank by kind: a lower number sorts first (most-urgent). */
const RANK_BY_KIND: Record<AttentionVM["kind"], number> = {
  conflict: 0,
  approval: 1,
  error: 2,
  cleanup: 3,
  detached: 4,
  review: 5,
};

/**
 * Pure: the attention queue, most-urgent first. Includes only cards that need a
 * human decision (`card.attention`). Ordered by kind urgency
 * (conflict < approval < error < cleanup < detached < review); within a rank,
 * the oldest `needsYouSince` waits first (ascending; a missing timestamp sorts
 * last), with a stable tie-break on `id` so the order is deterministic.
 */
export function selectAttention(model: CockpitModel): AttentionVM[] {
  const items: AttentionVM[] = [];
  for (const card of model.cards.values()) {
    if (!card.attention) continue;
    const kind = KIND_BY_STATE[card.state];
    if (kind === undefined) continue; // defensive: attention without a known kind
    items.push({
      id: card.id,
      roleName: card.roleName,
      state: card.state,
      kind,
      pendingApprovalId: card.pendingApprovalId,
      approvalDetail: card.approvalDetail,
      since: card.needsYouSince,
    });
  }
  items.sort((a, b) => {
    const byRank = RANK_BY_KIND[a.kind] - RANK_BY_KIND[b.kind];
    if (byRank !== 0) return byRank;
    const sinceA = a.since ?? Infinity;
    const sinceB = b.since ?? Infinity;
    if (sinceA !== sinceB) return sinceA - sinceB;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return items;
}

/**
 * Pure: lead-coordinated teams, one group per lead that actually has children.
 * A card `c` is a member of lead `c.parentId` only when `parentId` is set AND a
 * card with that id is itself present on the board (an orphan whose lead has
 * left forms no group and is no one's member). `memberIds` are in ascending id
 * order; groups are ordered by `leadId` ascending, so the result is fully
 * deterministic. Never mutates `model` or its Map.
 */
export function selectTeams(model: CockpitModel): TeamGroupVM[] {
  const membersByLead = new Map<string, string[]>();
  for (const card of model.cards.values()) {
    const leadId = card.parentId;
    if (leadId === undefined) continue;
    if (!model.cards.has(leadId)) continue; // parent not on the board: no group
    const list = membersByLead.get(leadId);
    if (list) list.push(card.id);
    else membersByLead.set(leadId, [card.id]);
  }
  const groups: TeamGroupVM[] = [];
  for (const [leadId, memberIds] of membersByLead) {
    memberIds.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    // The lead is guaranteed present (the loop above only keeps members whose
    // parent card is on the board), so resolving it is safe.
    const leadCard = model.cards.get(leadId)!;
    const memberCards = memberIds.map((id) => model.cards.get(id)!);
    const states: AgentState[] = [leadCard.state, ...memberCards.map((c) => c.state)];
    groups.push({
      leadId,
      memberIds,
      leadRoleName: leadCard.roleName,
      leadEngineId: leadCard.engineId,
      statusLabel: teamStatusLabel(states),
      tone: teamTone(states),
      hue: teamHue(leadId),
    });
  }
  groups.sort((a, b) => (a.leadId < b.leadId ? -1 : a.leadId > b.leadId ? 1 : 0));
  return groups;
}

/**
 * A tile's warmth, derived purely from the agent's state via an exhaustive map
 * (Record, so a future AgentState is a compile error). The resolved/committed
 * states normally never reach the board, but the map is total: they fall to
 * `idle` defensively.
 */
const WARMTH_BY_STATE: Record<AgentState, TileWarmth> = {
  conflict: "hot",
  error: "hot",
  "merge-cleanup-failed": "hot",
  "awaiting-approval": "warm",
  detached: "warm",
  done: "warm",
  working: "live",
  preparing: "live",
  stopped: "idle",
  merged: "idle",
  discarded: "idle",
  "pr-created": "idle",
};

/** Warmth urgency order (lower = more urgent), for rolling a team's tone up to its most-urgent member. */
const TONE_RANK: Record<TileWarmth, number> = { hot: 0, warm: 1, live: 2, idle: 3 };

/** A team-status bucket: how a member contributes to the tray's rolled-up one-liner. */
type TeamBucket = "needsYou" | "ready" | "working" | "idle";

/** Each agent state's team-status bucket (exhaustive Record, so a new AgentState is a compile error). */
const BUCKET_BY_STATE: Record<AgentState, TeamBucket> = {
  conflict: "needsYou",
  error: "needsYou",
  "merge-cleanup-failed": "needsYou",
  "awaiting-approval": "needsYou",
  detached: "needsYou",
  done: "ready",
  working: "working",
  preparing: "working",
  stopped: "idle",
  merged: "idle",
  discarded: "idle",
  "pr-created": "idle",
};

/** Singular/plural label for each bucket count, e.g. 1 -> "needs you", 2 -> "need you". */
const BUCKET_LABEL: Record<TeamBucket, [one: string, many: string]> = {
  needsYou: ["needs you", "need you"],
  ready: ["ready to review", "ready to review"],
  working: ["working", "working"],
  idle: ["idle", "idle"],
};

/** Most-urgent warmth across a set of states (defaults idle on empty). */
function teamTone(states: AgentState[]): TileWarmth {
  let best: TileWarmth = "idle";
  for (const s of states) if (TONE_RANK[WARMTH_BY_STATE[s]] < TONE_RANK[best]) best = WARMTH_BY_STATE[s];
  return best;
}

/** Compact rollup: top 2 non-zero buckets by urgency, " · " joined. No em dashes. */
function teamStatusLabel(states: AgentState[]): string {
  const counts: Record<TeamBucket, number> = { needsYou: 0, ready: 0, working: 0, idle: 0 };
  for (const s of states) counts[BUCKET_BY_STATE[s]]++;
  const order: TeamBucket[] = ["needsYou", "ready", "working", "idle"];
  const parts = order
    .filter((b) => counts[b] > 0)
    .map((b) => `${counts[b]} ${BUCKET_LABEL[b][counts[b] === 1 ? 0 : 1]}`);
  if (parts.length === 0) return "idle";
  if (counts.working === states.length && states.length > 1) return "all working";
  return parts.slice(0, 2).join(" · ");
}

/** A tile's size, a pure function of its warmth tier (hot/warm large, live medium, idle small). */
const SIZE_BY_WARMTH: Record<TileWarmth, TileSize> = {
  hot: "lg",
  warm: "lg",
  live: "md",
  idle: "sm",
};

/**
 * Salience rank by state (lower = more urgent), exhaustive (Record, so a future
 * AgentState is a compile error). Orders the Floor most-urgent first: a fresh
 * conflict outranks a routine working agent; ties fall to `needsYouSince` then id.
 */
const SALIENCE_BY_STATE: Record<AgentState, number> = {
  conflict: 0,
  error: 1,
  "merge-cleanup-failed": 2,
  "awaiting-approval": 3,
  detached: 4,
  done: 5,
  working: 6,
  preparing: 7,
  stopped: 8,
  merged: 9,
  discarded: 9,
  "pr-created": 9,
};

/** Pure: a Floor tile projection over one card; size/warmth derive only from its state. */
function tileFor(card: CardVM, child: boolean): FloorTileVM {
  const warmth = WARMTH_BY_STATE[card.state];
  return { id: card.id, size: SIZE_BY_WARMTH[warmth], warmth, child };
}

/**
 * Pure: the Floor layout, salience-ordered (most-urgent first) with each lead
 * immediately followed by its whole subtree (children, grandchildren, deeper),
 * depth-first. The output is a PERMUTATION of `model.cards`: every card appears
 * EXACTLY once. Membership reuses `selectTeams`, so the two stay consistent: a
 * present member of any lead is a child (nested under its lead, `child: true`),
 * everything else is a top-level root (`child: false`). Roots sort by salience
 * rank ascending, then oldest `needsYouSince` first (a missing timestamp sorts
 * last), then id; each tile's own size/warmth derive from its own card's state.
 * Never mutates.
 */
export function selectFloor(model: CockpitModel): FloorTileVM[] {
  const teams = selectTeams(model);
  const membersByLead = new Map<string, readonly string[]>();
  const memberIds = new Set<string>();
  for (const team of teams) {
    membersByLead.set(team.leadId, team.memberIds);
    for (const id of team.memberIds) memberIds.add(id);
  }

  // Top-level roots: cards that are not a present member of any lead.
  const roots = [...model.cards.values()].filter((card) => !memberIds.has(card.id));
  roots.sort((a, b) => {
    const byRank = SALIENCE_BY_STATE[a.state] - SALIENCE_BY_STATE[b.state];
    if (byRank !== 0) return byRank;
    const sinceA = a.needsYouSince ?? Infinity;
    const sinceB = b.needsYouSince ?? Infinity;
    if (sinceA !== sinceB) return sinceA - sinceB;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const tiles: FloorTileVM[] = [];
  const visited = new Set<string>();

  // Depth-first from a card: emit it, then recurse into its members (each a
  // `child`), so a whole delegation subtree renders nested under its root. The
  // `visited` guard prevents double-emission and breaks any malformed parentId
  // cycle (A's parent is B and B's parent is A), so this always terminates.
  const emit = (card: CardVM, child: boolean): void => {
    if (visited.has(card.id)) return;
    visited.add(card.id);
    tiles.push(tileFor(card, child));
    const members = membersByLead.get(card.id);
    if (members === undefined) return;
    for (const id of members) {
      const memberCard = model.cards.get(id);
      if (memberCard) emit(memberCard, true);
    }
  };
  for (const root of roots) emit(root, false);

  // Defensive sweep: a card trapped in a cycle that no root reaches would never
  // be visited above. Append any such leftover (in deterministic id order,
  // `child: true`) so the Floor stays a permutation of `model.cards`: nothing is
  // ever dropped. `emit` is reused so a leftover's own subtree comes with it.
  const leftovers = [...model.cards.values()]
    .filter((card) => !visited.has(card.id))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const card of leftovers) emit(card, true);

  return tiles;
}

/**
 * Pure: the in-session history, NEWEST-FIRST (most recent fold at the top) for
 * the History tab. Returns a reversed copy, so `model.history` (oldest-first) is
 * never mutated.
 */
export function selectHistory(model: CockpitModel): HistoryEntryVM[] {
  return [...model.history].reverse();
}

/** Pure: derive the ordered, renderable CockpitState from the model. */
export function selectState(model: CockpitModel): CockpitState {
  const cards = [...model.cards.values()].sort(compareCards);
  const delegations = [...model.delegations.values()];
  const attention = selectAttention(model);
  const floor = selectFloor(model);
  const teams = selectTeams(model);
  const history = selectHistory(model);
  const base: CockpitState = { cards, delegations, attention, floor, teams, history };
  return model.focusedId === undefined ? base : { ...base, focusedId: model.focusedId };
}
