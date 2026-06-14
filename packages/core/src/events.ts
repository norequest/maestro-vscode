import type { AgentState } from "./types.js";

const TERMINAL: ReadonlySet<AgentState> = new Set<AgentState>([
  "done",
  "error",
  "stopped",
  "merged",
  "discarded",
  "detached",
]);

export function isTerminalState(state: AgentState): boolean {
  return TERMINAL.has(state);
}
