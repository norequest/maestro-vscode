import type { AgentState } from "@maestro/core";

/** A single agent's renderable state in the cockpit. Pure data; the UI renders it verbatim. */
export interface CardVM {
  id: string;
  roleName: string;
  engineId: string;
  state: AgentState;
  /** Capped, accumulated `output` text the engine streamed. */
  output: string;
  summary?: string;
  diff?: { files: string[]; patch: string };
  diffError?: string;
  conflictFiles?: string[];
  error?: string;
  pendingApprovalId?: string;
  /** True when this card needs a human decision (awaiting-approval, done, error, conflict). */
  attention: boolean;
}

/** The whole cockpit, a pure function of orchestrator events. `cards` are pre-ordered. */
export interface CockpitState {
  cards: CardVM[];
  focusedId?: string;
}

/** Messages the extension host sends INTO the webview. */
export type HostToWebview = { type: "state"; state: CockpitState };

/** Messages the webview sends OUT to the extension host. */
export type WebviewToHost =
  | { type: "ready" }
  | { type: "focus"; agentId: string }
  | { type: "spawn"; roleName: string; description: string }
  | { type: "steer"; agentId: string; input: string }
  | { type: "approve"; agentId: string; approvalId: string; decision: "allow" | "deny" }
  | { type: "stop"; agentId: string }
  | { type: "merge"; agentId: string }
  | { type: "discard"; agentId: string };
