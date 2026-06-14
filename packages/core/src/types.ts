/** A unit of work assigned to a role. */
export interface Task {
  id: string;
  description: string;
  roleName: string;
}

/** An isolated checkout an agent works in (real worktree comes in a later milestone). */
export interface Workspace {
  agentId: string;
  path: string;
  branch: string;
}

/** A summary of what an agent changed. */
export interface Diff {
  files: string[];
  patch: string;
}

/** Outcome of merging an agent's branch. */
export type MergeResult =
  | { status: "clean" }
  | { status: "conflict"; files: string[] };

/** What an engine adapter can do; drives UI graceful degradation. */
export interface Capabilities {
  streaming: boolean;
  structuredEvents: boolean;
  approvals: boolean;
  steerable: boolean;
}

/** The lifecycle state of an agent, owned by the orchestrator. */
export type AgentState =
  | "preparing"
  | "working"
  | "awaiting-approval"
  | "done"
  | "error"
  | "stopped"
  | "merged"
  | "discarded"
  | "conflict";

/** States an adapter itself reports via a `status` event. */
export type EngineState = "working" | "awaiting-approval";

/** The common event stream every adapter emits. */
export type AgentEvent =
  | { kind: "output"; text: string }
  | { kind: "action"; tool: string; detail: unknown }
  | { kind: "approval"; id: string; detail: unknown }
  | { kind: "status"; state: EngineState }
  | { kind: "done"; summary: string; diff?: Diff }
  | { kind: "error"; message: string };

/** A reusable worker template. */
export interface Role {
  name: string;
  instructions: string;
  engine: { id: string; model?: string };
  autonomy: "manual" | "auto-approve-safe" | "yolo";
}

/** A running instance of a role on a task. */
export interface Agent {
  id: string;
  task: Task;
  role: Role;
  state: AgentState;
  log: AgentEvent[];
  summary?: string;
  diff?: Diff;
  conflict?: { files: string[] };
  diffError?: string;
  error?: string;
  pendingApprovalId?: string;
  workspace?: Workspace;
}

/** Events the orchestrator emits for a UI to render. */
export type OrchestratorEvent =
  | { kind: "agent-added"; agent: Agent }
  | { kind: "agent-updated"; agent: Agent }
  | { kind: "agent-event"; agentId: string; event: AgentEvent };

export interface OrchestratorConfig {
  maxParallelAgents: number;
}
