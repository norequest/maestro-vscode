import type { AgentState, ApprovalDetail, Diff, EngineCapabilitiesLite } from "@hallucinate/core";
import type { ComposerOptions } from "./composer.js";

/** Which column on the Board this card belongs to. */
export type Lane = "working" | "needsYou" | "conflict" | "done";

/** A single agent's renderable state in the cockpit. Pure data; the UI renders it verbatim. */
export interface CardVM {
  id: string;
  roleName: string;
  engineId: string;
  state: AgentState;
  /** Capped, accumulated `output` text the engine streamed. */
  output: string;
  /**
   * The last up to 3 non-empty lines of `output`, derived in the reducer for
   * the live activity preview on the card. Bounded by construction (at most 3
   * lines); empty when there is no output yet.
   */
  tail?: string[];
  summary?: string;
  diff?: Diff;
  diffError?: string;
  conflictFiles?: string[];
  error?: string;
  pendingApprovalId?: string;
  /** Human-readable detail of the pending approval; set while pendingApprovalId is set. */
  approvalDetail?: ApprovalDetail;
  /** Engine capabilities carried to the UI for graceful degradation. */
  engineCapabilities?: EngineCapabilitiesLite;
  /**
   * True when this card needs a human decision. Set by the core predicate
   * `stateNeedsAttention`, true for: awaiting-approval, done, error, conflict,
   * detached, merge-cleanup-failed.
   */
  attention: boolean;
  /**
   * Unix ms when this card first entered an attention state (per
   * `stateNeedsAttention`); preserved across updates while it stays in
   * attention, cleared when it leaves. Orders the attention queue (oldest
   * waiting first) and drives a "waiting" hint. Undefined when not waiting.
   */
  needsYouSince?: number;
  /** Which lane on the Board this card belongs to. */
  lane: Lane;
  /** The active task's description text. */
  taskDescription: string;
  /** The agent's role instructions markdown (role .md), shown in the drawer Instructions tab. */
  instructions?: string;
  /** The "why" from task.goal; shown as a faint italic line on the card. */
  goal?: string;
  /** Counts of added/deleted lines in the diff patch, excluding file headers. */
  diffStat?: { adds: number; dels: number };
  /**
   * Diff GROWTH on the most recent update: the non-negative delta of `diffStat`
   * versus the previous card, with `at` (Unix ms) marking when it was observed.
   * SET when the diff grew on this update; CLEARED (undefined) on an update where
   * it did not grow, so a present `momentum` reads as "growing right now". An
   * `agent-event` output tick does not recompute the card, so momentum persists
   * between successive diff updates. The Floor renders a faint eqbar-style
   * "growing" pulse on a working card while momentum is set.
   */
  momentum?: { adds: number; dels: number; at: number };
  /** Unix ms timestamp of the first time this card entered "working" state. */
  startedAt?: number;
  /** P4 anatomy: whether a Soul is attached (false when no soul). */
  soul?: boolean;
  /** P4 anatomy: total number of tools granted to this agent. */
  toolsCount?: number;
  /** P4 anatomy: number of tools that carry write permission. */
  toolsCanWrite?: number;
  /** P4 anatomy: skill names attached to this agent. */
  skills?: string[];
  /** Set when this agent was delegated by a lead: the lead agent's id, so the board can group it under the lead. */
  parentId?: string;
  /**
   * True for a stream-derived fleet sub-agent: nested under its lead, no own
   * worktree/branch/session, and READ-ONLY. The board renders it without any
   * action affordances (no Merge/Discard/Review/Approve/Steer); the lead
   * stays the single reviewable/mergeable unit.
   */
  virtual?: boolean;
}

/** A pending delegation: a lead asked to bring a teammate in, awaiting the lead's approve/deny. */
export interface DelegationVM {
  id: string;
  /** The lead agent that asked for this teammate. */
  leadAgentId: string;
  /** Teammate role the lead wants to spawn. */
  roleName: string;
  /** The self-contained subtask the teammate would receive. */
  task: string;
}

/**
 * One item in the attention queue: an agent that needs a human decision now.
 * The attention bar shows one of these at a time (most-urgent first) and reuses
 * existing messages (`focus` to jump; approve / resolve-conflict / open-review
 * to act). No new host message is introduced.
 */
export interface AttentionVM {
  /** The agent id; the bar reuses `focus` to jump to it. */
  id: string;
  roleName: string;
  /** The agent's state, used to choose the inline primary action. */
  state: AgentState;
  /**
   * The kind of attention, for the bar's label and primary action:
   * approval -> awaiting-approval, conflict -> conflict, review -> done,
   * error -> error, detached -> detached, cleanup -> merge-cleanup-failed.
   */
  kind: "approval" | "conflict" | "review" | "error" | "detached" | "cleanup";
  /** For approvals: the pending approval id (to post approve / deny). */
  pendingApprovalId?: string;
  /** For approvals: human-readable detail of what is being approved. */
  approvalDetail?: ApprovalDetail;
  /** Unix ms the agent entered attention; for a "waiting" hint. */
  since?: number;
}

/** A Floor tile's relative prominence: large (attention), medium (working), small (idle). */
export type TileSize = "lg" | "md" | "sm";

/**
 * A Floor tile's "warmth" (how much it wants your eyes), derived purely from the
 * agent's state:
 *   hot  -> an urgent problem (conflict, error, merge-cleanup-failed),
 *   warm -> waiting on you (awaiting-approval, detached, done/ready-to-review),
 *   live -> actively progressing (working, preparing),
 *   idle -> quiet (stopped).
 * The CSS maps each to an accent so a busy Floor reads at a glance.
 */
export type TileWarmth = "hot" | "warm" | "live" | "idle";

/**
 * One tile on the Floor: a presentation projection over a CardVM. Carries only
 * the card id plus its derived size + warmth + child flag, so the Floor payload
 * stays lean (the full card is resolved from `CockpitState.cards` by id at render
 * time, never duplicated here). `child` is true for a delegated sub-agent, which
 * the Floor renders nested under its lead. Produced by `selectFloor`,
 * salience-ordered (most-urgent first), each lead immediately followed by its
 * children.
 */
export interface FloorTileVM {
  /** The agent id; the card is resolved from CockpitState.cards. */
  id: string;
  size: TileSize;
  warmth: TileWarmth;
  /** True for a delegated child tile, rendered nested under its lead. */
  child: boolean;
}

/**
 * One lead-coordinated team: a lead agent and the ids of its delegated children
 * (cards whose `parentId` is the lead). Id-based (cards resolved from
 * `CockpitState.cards`), so the grouping is lean. Produced by `selectTeams`,
 * which emits a group only for leads that actually have children. The Floor
 * renders each team as a labeled "tray" that visually encloses the lead and its
 * children as one unit; the header fields below populate that tray's header.
 *
 * The header fields are OPTIONAL on the type so the contract can land before
 * `selectTeams` populates them, but `selectTeams` sets all of them in practice;
 * render treats a missing field defensively.
 */
export interface TeamGroupVM {
  /** The lead agent id. */
  leadId: string;
  /** Child agent ids (parentId === leadId), in id order. */
  memberIds: string[];
  /** The lead's role label, shown as the tray's title. */
  leadRoleName?: string;
  /** The lead's engine id (e.g. "copilot-fleet"), shown faint in the tray header. */
  leadEngineId?: string;
  /** Rolled-up one-line status across the lead and its members, e.g. "2 ready to review". */
  statusLabel?: string;
  /** Most-urgent warmth across the lead and its members; drives the header status dot. */
  tone?: TileWarmth;
  /**
   * A stable hue (0-359) derived deterministically from `leadId`, for a subtle
   * team-identity accent on the tray header. Same team always gets the same hue;
   * it is an identity cue, never a status signal (status stays on `tone`).
   */
  hue?: number;
}

/**
 * One entry in the in-session activity history: a single orchestrator event the
 * reducer folded, projected to a render-ready one-liner. The history is a bounded
 * ring (oldest dropped past the cap) and is surfaced newest-first by
 * `selectHistory`. In-session ONLY: it is rebuilt from the live event stream,
 * never persisted; replaying a prior session's on-disk log is deferred. Lean and
 * id-based (the agent, if any, is resolved from `CockpitState.cards`).
 */
export interface HistoryEntryVM {
  /** Monotonic fold index (also a stable render key); rises by one per recorded event. */
  seq: number;
  /** Unix ms when the event was folded. */
  at: number;
  /** The orchestrator event kind, for a per-kind icon/accent (e.g. "agent-updated"). */
  kind: string;
  /** A short human one-liner for the timeline row (the render layer escapes it). */
  label: string;
  /** The agent the entry concerns, when applicable, for a focus jump back to the board. */
  agentId?: string;
  /** The agent's role label, when resolvable, for display. */
  roleName?: string;
}

/** The whole cockpit, a pure function of orchestrator events. `cards` are pre-ordered. */
export interface CockpitState {
  cards: CardVM[];
  focusedId?: string;
  /** Pending delegation proposals, in arrival order. Resolved ones are dropped. */
  delegations: DelegationVM[];
  /**
   * The attention queue: agents needing a human decision, most-urgent first
   * (conflict before approval; oldest `needsYouSince` wins ties). The webview's
   * attention bar shows one at a time with an "n of m" counter. Omitted/empty
   * when nothing needs you.
   */
  attention?: AttentionVM[];
  /**
   * The Floor layout: salience-ordered tiles (size + warmth) over `cards`, with
   * children nested under leads. The default board layout; the "Status" toggle
   * falls back to the lane columns. Omitted/empty before any agent exists.
   */
  floor?: FloorTileVM[];
  /**
   * Lead-coordinated teams: each lead with its delegated children, for nesting
   * and (Phase E) connectors. Omitted/empty when no delegation has occurred.
   */
  teams?: TeamGroupVM[];
  /**
   * In-session activity history: a bounded, newest-first list of folded
   * orchestrator events for the History tab. In-session only (rebuilt from the
   * live stream, never persisted). Omitted/empty before any event is recorded.
   */
  history?: HistoryEntryVM[];
}

/** Messages the extension host sends INTO the webview. */
export type HostToWebview =
  | { type: "state"; state: CockpitState }
  | { type: "composer-options"; options: ComposerOptions };

/** Messages the webview sends OUT to the extension host. */
export type WebviewToHost =
  | { type: "ready" }
  // The board "+ New task" button: the host decides the team funnel (launch a
  // team, or steer the user to create a team / add agents) from a fresh read of
  // .hallucinate/, since the webview can't reliably know team/agent counts.
  | { type: "new-task" }
  | { type: "focus"; agentId: string }
  | { type: "spawn"; roleName: string; description: string; goal?: string }
  | { type: "steer"; agentId: string; input: string }
  | { type: "approve"; agentId: string; approvalId: string; decision: "allow" | "deny" }
  | { type: "stop"; agentId: string }
  | { type: "merge"; agentId: string }
  | { type: "discard"; agentId: string }
  | { type: "sendBack"; agentId: string; feedback: string }
  | { type: "resolve-conflict"; agentId: string }
  | { type: "finish-merge"; agentId: string }
  | { type: "create-pr"; agentId: string }
  | { type: "retry-cleanup"; agentId: string }
  | { type: "open-review"; agentId: string }
  /** Discard and clear every ready-to-review (done) card from the board. */
  | { type: "clear-done-lane" }
  // Lead delegation approve/deny. These carry a delegation `id`, not an agentId.
  | { type: "approve-delegation"; id: string }
  | { type: "deny-delegation"; id: string }
  | {
      type: "dispatch";
      /** A registered/preset role to spawn. */
      roleName?: string;
      /** A free-text ad-hoc role name to register then spawn. */
      newRoleName?: string;
      /** Engine family id; validated against KNOWN_ENGINE_IDS host-side. */
      engineId?: string;
      /** Engine model variant, e.g. "claude-sonnet-4.5" | "gpt-5" | "o3" | "gemini". */
      model?: string;
      /** The "why" (so that ...); the faint italic card line. */
      goal?: string;
      /** The concrete task instruction. */
      description: string;
    };

/** Messages that carry an `agentId: string`. */
const AGENT_ID_TYPES = new Set([
  "focus",
  "steer",
  "approve",
  "stop",
  "merge",
  "discard",
  "sendBack",
  "resolve-conflict",
  "finish-merge",
  "create-pr",
  "retry-cleanup",
  "open-review",
]);

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isOptString(value: unknown): boolean {
  return value === undefined || isString(value);
}

/**
 * Pure runtime guard for the webview->host boundary. The webview is a separate,
 * potentially-compromised JS context, so its postMessage payloads are untrusted
 * `unknown`. This narrows them to a real WebviewToHost (object with a known
 * `type` literal and the per-type string fields the host dispatcher reads),
 * letting the host drop anything malformed before it reaches the controller.
 */
export function isWebviewMessage(msg: unknown): msg is WebviewToHost {
  if (msg === null || typeof msg !== "object") return false;
  const m = msg as Record<string, unknown>;
  if (!isString(m["type"])) return false;
  const type = m["type"];

  // Every message except "ready" carries an agentId string.
  if (type !== "ready" && AGENT_ID_TYPES.has(type) && !isString(m["agentId"])) {
    return false;
  }

  switch (type) {
    case "ready":
    case "new-task":
    case "clear-done-lane":
      return true;
    case "focus":
    case "stop":
    case "merge":
    case "discard":
    case "resolve-conflict":
    case "finish-merge":
    case "create-pr":
    case "retry-cleanup":
    case "open-review":
      return isString(m["agentId"]);
    case "approve-delegation":
    case "deny-delegation":
      return isString(m["id"]);
    case "spawn":
      return isString(m["roleName"]) && isString(m["description"]) && (m["goal"] === undefined || isString(m["goal"]));
    case "steer":
      return isString(m["agentId"]) && isString(m["input"]);
    case "sendBack":
      return isString(m["agentId"]) && isString(m["feedback"]);
    case "approve":
      return (
        isString(m["agentId"]) &&
        isString(m["approvalId"]) &&
        (m["decision"] === "allow" || m["decision"] === "deny")
      );
    case "dispatch":
      return (
        isString(m["description"]) &&
        isOptString(m["roleName"]) &&
        isOptString(m["newRoleName"]) &&
        isOptString(m["engineId"]) &&
        isOptString(m["model"]) &&
        isOptString(m["goal"])
      );
    default:
      return false;
  }
}
