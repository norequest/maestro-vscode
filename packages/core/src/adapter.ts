import type { AgentEvent, Capabilities, Role, Task, Workspace } from "./types.js";

export type ApprovalDecision = "allow" | "deny";

export interface HealthStatus {
  ok: boolean;
  detail?: string;
}

/** A live run of one engine on one task. */
export interface AgentSession {
  readonly events: AsyncIterable<AgentEvent>;
  /** Inject extra guidance mid-run (steer). */
  send(input: string): void;
  /** Answer a pending approval. */
  respond(approvalId: string, decision: ApprovalDecision): void;
  /** Cancel cleanly. */
  stop(): void;
}

/** The only thing the orchestrator knows about an engine. */
export interface EngineAdapter {
  readonly id: string;
  readonly capabilities: Capabilities;
  start(task: Task, workspace: Workspace, role: Role): AgentSession;
  health(): Promise<HealthStatus>;
}
