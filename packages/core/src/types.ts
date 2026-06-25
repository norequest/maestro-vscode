/** A reference to a skill: advertised by name in the preamble, body materialized into the worktree. */
export interface SkillRef {
  /** Skill folder name, e.g. "task-coordination-strategies". */
  name: string;
  /** One-line description from the skill's frontmatter, used to advertise it. */
  description?: string;
  /** Full original SKILL.md file text (frontmatter + body), for materialization into the worktree. */
  content: string;
}

/** A Copilot custom-agent profile: a slug plus the full .agent.md text materialized into the worktree. */
export interface AgentProfile {
  /** The agent slug, e.g. "scribe". */
  name: string;
  /** The full .agent.md file text. */
  content: string;
}

/** A unit of work assigned to a role. */
export interface Task {
  id: string;
  description: string;
  roleName: string;
  /** The "why" for this dispatch, shown as the faint italic goal line on the card. */
  goal?: string;
  /** Resolved at spawn; not persisted. */
  soulDoc?: SoulDoc;
  /** Resolved skills at spawn (advertised by name, materialized as files); not persisted. */
  skills?: SkillRef[];
  /** Agent profiles to materialize into this agent's worktree (.github/agents/<name>.agent.md); not persisted. */
  agentProfiles?: AgentProfile[];
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

/**
 * The capability subset carried onto an agent (and its card) so the UI can
 * degrade without adapter access. The single source of truth for this shape;
 * the cockpit `CardVM` reuses it rather than re-declaring it.
 */
export type EngineCapabilitiesLite = Pick<Capabilities, "approvals" | "steerable">;

/**
 * How much an agent may do without asking. The single source of truth for the
 * autonomy levels; every other package imports this type (and the runtime
 * `AUTONOMY_VALUES` companion in constants.ts) rather than re-spelling the union.
 */
export type Autonomy = "manual" | "auto-approve-safe" | "yolo";

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
  | { kind: "error"; message: string }
  // Fleet sub-agent lifecycle, emitted on a lead's own session when its
  // engine (e.g. Copilot's /fleet) runs named sub-agents inside one session.
  // The orchestrator surfaces these as read-only virtual children; no process
  // or worktree is created for them.
  /** A named sub-agent started inside the lead's session. callId is the engine's toolCallId used to correlate later events; name is the custom-agent name (e.g. "writer-alpha"). */
  | { kind: "subagent-started"; callId: string; name: string; description?: string }
  /** Output text from a running sub-agent. callId correlates it to the subagent-started event. */
  | { kind: "subagent-output"; callId: string; text: string }
  /** A sub-agent finished. callId correlates it to the subagent-started event; summary is its closing note, if any. */
  | { kind: "subagent-done"; callId: string; summary?: string };

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
  autonomy: Autonomy;
  /** Names of skills resolved to .hallucinate/skills/<name>/SKILL.md at spawn. Additive; absent means none. */
  skills?: string[];
  /** Name of a soul file resolved to .hallucinate/souls/<soul>.md at spawn. */
  soul?: string;
  /** Tool grants for this role; absence of a write entry means read-only. */
  tools?: ToolGrant;
  /**
   * Adopt audit trail: set by the discover/adopt flow to record where this role
   * was originally found. Absent on hand-authored roles; never required for a
   * role to be valid.
   */
  provenance?: { source: string; sha?: string; adoptedAt: string };
}

/** A named group of roles that can be dispatched together. */
export interface Team {
  name: string;
  roles: Role[];
  /** Names of skills inherited by all roles in this team at spawn. Additive; absent means none. */
  skills?: string[];
  /**
   * Role name (must be one of `roles`) that leads this team: the only member
   * launched when the team is dispatched. The lead delegates to teammates via
   * delegation directives. Defaults to the first role when absent.
   */
  lead?: string;
}

/**
 * A lead's request to bring a teammate in, parsed from a ```delegate block in the
 * lead's output. Pending until the lead approves or denies it; approval
 * spawns the teammate as a child of the lead.
 */
export interface DelegationProposal {
  id: string;
  /** The lead agent that asked for this teammate. */
  leadAgentId: string;
  /** Teammate role to spawn (a role in the lead's team, never the lead itself). */
  roleName: string;
  /** Self-contained subtask the teammate receives as its task description. */
  task: string;
  state: "pending" | "approved" | "denied";
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
  engineCapabilities?: EngineCapabilitiesLite;
  workspace?: Workspace;
  /** Set when this agent was delegated by a lead: the lead's agent id. */
  parentId?: string;
  /** True for a stream-derived fleet sub-agent: nested under its lead, shares the lead worktree, has no own engine session or branch, and is read-only (no merge/approve/steer). */
  virtual?: boolean;
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
  | { kind: "agent-event"; agentId: string; event: AgentEvent }
  /** A lead asked to bring a teammate in; pending the lead's approval. */
  | { kind: "delegation-proposed"; proposal: DelegationProposal }
  /** A delegation moved out of pending (approved or denied). */
  | { kind: "delegation-resolved"; proposal: DelegationProposal };

export interface OrchestratorConfig {
  maxParallelAgents: number;
}

/**
 * A config-driven DEFAULT layer composed into agent preambles at spawn.
 * `instructions` and `skills` apply to EVERY agent (the general layer);
 * `leadSkills` applies ONLY to the agent that holds a team roster (the lead).
 * All fields optional, so an unset defaults block leaves spawn behavior unchanged.
 */
export interface AgentDefaults {
  /** Standing instructions composed into EVERY agent (before the role's own). */
  instructions?: string;
  /** Skill names composed into EVERY agent. */
  skills?: string[];
  /** Skill names composed ONLY into the lead (the agent holding a team roster). */
  leadSkills?: string[];
}

/** Per-dispatch overrides applied without mutating the registered Role. */
export interface SpawnOptions {
  goal?: string;
  engineId?: string;
  model?: string;
  /** Prepended to the role's instructions for THIS agent only (e.g. a lead brief). */
  instructionsPrefix?: string;
  /** Links this agent to the lead that delegated it. */
  parentId?: string;
  /** Agent profiles materialized into the spawned agent's worktree (Copilot custom agents). */
  agentProfiles?: AgentProfile[];
  /**
   * Internal spawn detail (NOT exposed on the public dispatch API): true only for
   * the lead spawned by launchTeam. When true, defaults.leadSkills ride into the
   * effective role on top of the general defaults. A plain dispatch never sets it,
   * so a non-team agent gets only the general defaults, never leadSkills.
   */
  isLead?: boolean;
}

/** A single-agent dispatch: either a preset roleName or a free-text newRoleName, plus the task. */
export interface DispatchSpec { roleName?: string; newRoleName?: string; engineId?: string; model?: string; goal?: string; description: string; }

/** Async resolver injected by the extension to avoid fs imports in core. */
export type PreambleResolver = (role: Role) => Promise<{ soulDoc?: SoulDoc; skills?: SkillRef[] }>;
