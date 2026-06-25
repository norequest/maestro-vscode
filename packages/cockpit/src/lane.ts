import type { AgentState } from "@maestro/core";
export type { Lane } from "./protocol.js";
import type { Lane } from "./protocol.js";

const LANE_BY_STATE: Record<AgentState, Lane> = {
  preparing: "working",
  working: "working",
  "awaiting-approval": "needsYou",
  error: "needsYou",
  detached: "needsYou",
  "merge-cleanup-failed": "needsYou",
  conflict: "conflict",
  done: "done",
  // A stopped run did NOT finish: it belongs with the "needs you" decisions
  // (resume or discard), not in "Done" where it would look merge-ready.
  stopped: "needsYou",
  merged: "done",
  discarded: "done",
  "pr-created": "done",
};

export function laneFor(state: AgentState): Lane {
  return LANE_BY_STATE[state];
}

/**
 * Terminal "resolved" states: the run is finished AND its outcome is already
 * committed (merged, discarded, or shipped as a PR). Cards in these states
 * auto-leave the board model rather than piling up in the Done lane forever.
 * Note `done` (ready-to-review) is NOT here: it still needs a human decision.
 */
export const RESOLVED_STATES: ReadonlySet<AgentState> = new Set<AgentState>([
  "merged",
  "discarded",
  "pr-created",
]);

/** True when an agent's outcome is already committed and its card should leave the board. */
export function isResolvedState(state: AgentState): boolean {
  return RESOLVED_STATES.has(state);
}
