/** A unit of work assigned to a role. */
export interface Task {
  id: string;
  description: string;
  roleName: string;
  /** The "why" for this dispatch, shown as the faint italic goal line on the card. */
  goal?: string;
  /** Resolved at spawn; not persisted. */
  soulDoc?: SoulDoc;
  /** Resolved skill bodies at spawn; not persisted. */
  skillBodies?: string[];
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
  | "conflict"
  /** Process gone, worktree preserved on disk; user decides merge/discard/retry. */
  | "detached"
  /** Merge landed (code is in the branch) but worktree cleanup failed; recover via retryCleanup. */
  | "merge-cleanup-failed"
  /** A PR was opened for the branch; worktree released but the branch is kept. Terminal. */
  | "pr-created";

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

/** The renderable detail of a pending approval request from an engine. */
export interface ApprovalDetail {
  tool: string;
  description: string;
}

/** The five built-in capability names the anatomy Tools grid renders. */
export type BuiltinTool = "Read" | "Edit" | "Run" | "Search" | "Git";

/** A granular tool grant. Read and write are tracked APART; write is off by
 *  default because absence of a write entry means read-only. */
export interface ToolGrant {
  builtins?: { read?: ("Read" | "Search")[]; write?: ("Edit" | "Run" | "Git")[] };
  mcp?: Array<{ server: string; read?: boolean; write?: boolean }>;
}

/** A parsed soul.md: stable identity across tasks. Sections per design 03. */
export interface SoulDoc {
  identity?: string;
  principles?: string;
  voice?: string;
  priorities?: string;
  /** Actions the agent will never take, regardless of instructions (Tier 1). */
  redLines?: string;
  /** The full raw markdown, kept so a round-trip never loses content. */
  raw: string;
}

/** A reusable worker template. */
export interface Role {
  name: string;
  instructions: string;
  engine: { id: string; model?: string };
  autonomy: "manual" | "auto-approve-safe" | "yolo";
  /** Names of skills resolved to .conductor/skills/<name>/SKILL.md at spawn. Additive; absent means none. */
  skills?: string[];
  /** Name of a soul file resolved to .conductor/souls/<soul>.md at spawn. */
  soul?: string;
  /** Tool grants for this role; absence of a write entry means read-only. */
  tools?: ToolGrant;
}

/** A named group of roles that can be dispatched together. */
export interface Team {
  name: string;
  roles: Role[];
  /** Names of skills inherited by all roles in this team at spawn. Additive; absent means none. */
  skills?: string[];
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
  /** Set when state === "awaiting-approval"; cleared when the approval is resolved. */
  approvalDetail?: ApprovalDetail;
  /** Capabilities carried from the adapter so the UI can degrade without adapter access. */
  engineCapabilities?: { approvals: boolean; steerable: boolean };
  workspace?: Workspace;
}

/** Minimal record persisted per agent so the orchestrator can rehydrate after a reload. */
export interface PersistedAgentRecord {
  /** Full agent snapshot at the last persisted state. */
  agent: Agent;
  /** Absolute path to the agent's worktree, if one was created. */
  workspacePath?: string;
  /** Branch name, e.g. "agent/fix-tests". */
  workspaceBranch?: string;
}

/** Events the orchestrator emits for a UI to render. */
export type OrchestratorEvent =
  | { kind: "agent-added"; agent: Agent }
  | { kind: "agent-updated"; agent: Agent }
  | { kind: "agent-event"; agentId: string; event: AgentEvent };

export interface OrchestratorConfig {
  maxParallelAgents: number;
}

/** Per-dispatch overrides applied without mutating the registered Role. */
export interface SpawnOptions { goal?: string; engineId?: string; model?: string; }

/** A single-agent dispatch: either a preset roleName or a free-text newRoleName, plus the task. */
export interface DispatchSpec { roleName?: string; newRoleName?: string; engineId?: string; model?: string; goal?: string; description: string; }

/** Async resolver injected by the extension to avoid fs imports in core. */
export type PreambleResolver = (role: Role) => Promise<{ soulDoc?: SoulDoc; skillBodies?: string[] }>;
