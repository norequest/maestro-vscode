import type { AgentState } from "./types.js";

/**
 * Single source of truth for AgentState policy. Each map is an exhaustive
 * Record<AgentState, boolean>, so adding a new state is a COMPILE error here
 * (and forces an explicit terminal/discardable/attention decision) rather than
 * silently defaulting in scattered predicates across packages.
 */

/** Terminal = the agent's run is over; the state machine ignores further events. */
const TERMINAL_BY_STATE: Record<AgentState, boolean> = {
  preparing: false,
  working: false,
  "awaiting-approval": false,
  done: true,
  error: true,
  stopped: true,
  merged: true,
  discarded: true,
  // conflict is resolvable, so it is NON-terminal.
  conflict: false,
  detached: true,
  "merge-cleanup-failed": true,
  "pr-created": true,
};

/** Discardable = the user may throw the worktree away from this state. */
const DISCARDABLE_BY_STATE: Record<AgentState, boolean> = {
  preparing: false,
  working: false,
  "awaiting-approval": false,
  done: true,
  error: true,
  stopped: true,
  merged: false,
  discarded: false,
  conflict: true,
  detached: true,
  "merge-cleanup-failed": true,
  // The branch is kept; the user can still discard later to delete it.
  "pr-created": true,
};

/** Needs attention = the UI should surface this agent to the conductor. */
const NEEDS_ATTENTION_BY_STATE: Record<AgentState, boolean> = {
  preparing: false,
  working: false,
  "awaiting-approval": true,
  done: true,
  error: true,
  stopped: false,
  merged: false,
  discarded: false,
  conflict: true,
  detached: true,
  "merge-cleanup-failed": true,
  // Terminal success: the PR carries the review now, nothing to surface here.
  "pr-created": false,
};

export function isTerminalState(state: AgentState): boolean {
  return TERMINAL_BY_STATE[state];
}

export function isDiscardableState(state: AgentState): boolean {
  return DISCARDABLE_BY_STATE[state];
}

export function stateNeedsAttention(state: AgentState): boolean {
  return NEEDS_ATTENTION_BY_STATE[state];
}
