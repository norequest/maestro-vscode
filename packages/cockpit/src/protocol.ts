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
  /** Human-readable detail of the pending approval; set while pendingApprovalId is set. */
  approvalDetail?: { tool: string; description: string };
  /** Engine capabilities carried to the UI for graceful degradation. */
  engineCapabilities?: { approvals: boolean; steerable: boolean };
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
  | { type: "discard"; agentId: string }
  | { type: "sendBack"; agentId: string; feedback: string }
  | { type: "resolve-conflict"; agentId: string }
  | { type: "finish-merge"; agentId: string }
  | { type: "create-pr"; agentId: string }
  | { type: "retry-cleanup"; agentId: string };
