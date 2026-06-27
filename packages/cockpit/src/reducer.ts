import { stateNeedsAttention, countGrants, type Agent, type AgentState, type OrchestratorEvent } from "@hallucinate/core";
import { laneFor, isResolvedState } from "./lane.js";
import type { CardVM, DelegationVM, HistoryEntryVM } from "./protocol.js";

/** Max accumulated output chars kept per agent (keeps state snapshots bounded). */
export const OUTPUT_CAP = 16_000;

/** Max history entries kept in the in-session ring (oldest dropped past this). */
export const HISTORY_CAP = 200;

/** Authoritative internal state. `selectState` derives the ordered CockpitState from it. */
export interface CockpitModel {
  cards: Map<string, CardVM>;
  focusedId?: string;
  /** Pending delegation proposals keyed by id, in insertion (arrival) order. */
  delegations: Map<string, DelegationVM>;
  /** In-session activity history, oldest-first; a bounded ring (see HISTORY_CAP). */
  history: HistoryEntryVM[];
}

export function initialModel(): CockpitModel {
  return { cards: new Map(), delegations: new Map(), history: [] };
}

/** Friendly phrasing for each agent state, for a history one-liner (falls back to the raw state). */
const HISTORY_PHRASE: Record<AgentState, string> = {
  working: "started working",
  preparing: "preparing",
  "awaiting-approval": "needs approval",
  done: "ready to review",
  conflict: "hit a conflict",
  error: "errored",
  detached: "detached",
  "merge-cleanup-failed": "cleanup failed",
  stopped: "stopped",
  merged: "merged",
  discarded: "discarded",
  "pr-created": "opened a PR",
};

function diffStatFromPatch(patch: string): { adds: number; dels: number } {
  let adds = 0, dels = 0;
  for (const line of patch.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) adds++;
    else if (line.startsWith("-") && !line.startsWith("---")) dels++;
  }
  return { adds, dels };
}

function cardFromAgent(
  agent: Agent,
  prevOutput: string,
  prevStartedAt: number | undefined,
  prevNeedsYouSince: number | undefined,
  prevDiffStat: { adds: number; dels: number } | undefined,
): CardVM {
  const startedAt = prevStartedAt ?? (agent.state === "working" ? Date.now() : undefined);
  // Stamp the moment this card first entered an attention state; preserve it
  // across updates while it stays in attention; clear it when it leaves.
  const needsYouSince = stateNeedsAttention(agent.state) ? (prevNeedsYouSince ?? Date.now()) : undefined;
  const diffStat = agent.diff ? diffStatFromPatch(agent.diff.patch) : undefined;
  // Momentum is the GROWTH of diffStat versus the previous card. Set it (stamped
  // now) only when the diff grew on this update; clear it otherwise, so a present
  // momentum reads as "growing right now". Each delta is clamped to >= 0 so a
  // simultaneous shrink in one axis never yields a negative.
  const prev = prevDiffStat ?? { adds: 0, dels: 0 };
  const dAdds = (diffStat?.adds ?? 0) - prev.adds;
  const dDels = (diffStat?.dels ?? 0) - prev.dels;
  const momentum =
    diffStat && (dAdds > 0 || dDels > 0)
      ? { adds: Math.max(0, dAdds), dels: Math.max(0, dDels), at: Date.now() }
      : undefined;
  const grants = countGrants(agent.role.tools);
  return {
    id: agent.id,
    roleName: agent.role.name,
    engineId: agent.role.engine.id,
    state: agent.state,
    output: prevOutput,
    tail: tailOf(prevOutput),
    summary: agent.summary,
    diff: agent.diff,
    diffError: agent.diffError,
    conflictFiles: agent.conflict?.files,
    error: agent.error,
    pendingApprovalId: agent.pendingApprovalId,
    approvalDetail: agent.approvalDetail,
    engineCapabilities: agent.engineCapabilities,
    attention: stateNeedsAttention(agent.state),
    needsYouSince,
    lane: laneFor(agent.state),
    taskDescription: agent.task.description,
    instructions: agent.role.instructions,
    goal: agent.task.goal,
    diffStat,
    momentum,
    startedAt,
    soul: agent.role.soul !== undefined,
    toolsCount: grants.granted,
    toolsCanWrite: grants.canWrite,
    skills: agent.role.skills ?? [],
    parentId: agent.parentId,
    virtual: agent.virtual,
  };
}

function appendOutput(prev: string, text: string): string {
  const next = prev + text;
  return next.length > OUTPUT_CAP ? next.slice(next.length - OUTPUT_CAP) : next;
}

/**
 * Pure: the last up to 3 non-empty (non-whitespace-only) lines of `output`,
 * for the card's live activity preview. Bounded by construction (<=3); empty
 * when there is no output yet. Derives from the already-capped `output`, so it
 * stays consistent with OUTPUT_CAP automatically.
 */
function tailOf(output: string): string[] {
  const lines = output.split(/\r?\n/).filter((line) => line.trim().length > 0);
  return lines.slice(-3);
}

/** Pure: fold one orchestrator event into a new model (never mutates the input). */
export function reduce(model: CockpitModel, event: OrchestratorEvent): CockpitModel {
  const cards = new Map(model.cards);
  const delegations = new Map(model.delegations);
  let focusedId = model.focusedId;
  // The lifecycle moment this event records, if any. seq/at are stamped after
  // the switch; an undefined entry records NOTHING (e.g. output-stream noise).
  let entry: Omit<HistoryEntryVM, "seq" | "at"> | undefined;
  switch (event.kind) {
    case "agent-added":
      // Defensively skip an agent added already resolved (rehydrate/edge cases):
      // a committed outcome (merged/discarded/pr-created) gets no card.
      if (isResolvedState(event.agent.state)) {
        cards.delete(event.agent.id);
        if (focusedId === event.agent.id) focusedId = undefined;
      } else {
        cards.set(event.agent.id, cardFromAgent(event.agent, "", undefined, undefined, undefined));
      }
      entry = {
        kind: "agent-added",
        agentId: event.agent.id,
        roleName: event.agent.role.name,
        label: `${event.agent.role.name} added`,
      };
      break;
    case "agent-updated": {
      // agent-added always precedes agent-updated per the orchestrator contract.
      // Capture the prior state BEFORE mutating: history records only real
      // transitions (a no-op same-state update is left out of the ring).
      const prev = cards.get(event.agent.id);
      const changed = prev?.state !== event.agent.state;
      // A resolved card auto-leaves the board: delete it instead of updating,
      // and drop the drawer focus if it pointed at this card.
      if (isResolvedState(event.agent.state)) {
        cards.delete(event.agent.id);
        if (focusedId === event.agent.id) focusedId = undefined;
      } else {
        cards.set(
          event.agent.id,
          cardFromAgent(event.agent, prev?.output ?? "", prev?.startedAt, prev?.needsYouSince, prev?.diffStat),
        );
      }
      if (changed) {
        const phrase = HISTORY_PHRASE[event.agent.state] ?? event.agent.state;
        entry = {
          kind: "agent-updated",
          agentId: event.agent.id,
          roleName: event.agent.role.name,
          label: `${event.agent.role.name} ${phrase}`,
        };
      }
      break;
    }
    case "agent-event": {
      const prev = cards.get(event.agentId);
      if (prev && event.event.kind === "output") {
        const output = appendOutput(prev.output, event.event.text);
        cards.set(event.agentId, { ...prev, output, tail: tailOf(output) });
      }
      // No history entry: high-frequency output ticks are stream noise, not a
      // timeline moment.
      break;
    }
    case "delegation-proposed": {
      const { id, leadAgentId, roleName, task } = event.proposal;
      delegations.set(id, { id, leadAgentId, roleName, task });
      // Resolve the lead's role label from its card when it is on the board.
      const leadRole = cards.get(leadAgentId)?.roleName;
      entry = {
        kind: "delegation-proposed",
        agentId: leadAgentId,
        ...(leadRole !== undefined ? { roleName: leadRole } : {}),
        label: `${leadRole ?? leadAgentId} wants ${roleName}`,
      };
      break;
    }
    case "delegation-resolved":
      // Approved or denied, the proposal leaves the pending list either way.
      delegations.delete(event.proposal.id);
      entry = { kind: "delegation-resolved", label: "delegation resolved" };
      break;
    default: {
      // A new OrchestratorEvent kind must be handled explicitly; this makes a
      // silent fall-through a compile error.
      const _exhaustive: never = event;
      void _exhaustive;
      break;
    }
  }
  // Append to the bounded ring IMMUTABLY: never touch model.history. seq is the
  // last entry's seq + 1 (monotonic, NOT reset when the oldest are trimmed).
  let history = model.history;
  if (entry !== undefined) {
    const seq = (model.history.length ? model.history[model.history.length - 1]!.seq : 0) + 1;
    const appended = [...model.history, { seq, at: Date.now(), ...entry }];
    history = appended.length > HISTORY_CAP ? appended.slice(appended.length - HISTORY_CAP) : appended;
  }
  return { ...model, cards, delegations, focusedId, history };
}

/** Pure: set the focused agent. */
export function setFocus(model: CockpitModel, agentId: string): CockpitModel {
  return { ...model, focusedId: agentId };
}
