import type { AgentState } from "@maestro/core";
import type { ComposerOptions } from "./composer.js";

/** Which column on the Conducting Board this card belongs to. */
export type Lane = "working" | "needsYou" | "conflict" | "done";

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
  /**
   * True when this card needs a human decision. Set by the core predicate
   * `stateNeedsAttention`, true for: awaiting-approval, done, error, conflict,
   * detached, merge-cleanup-failed.
   */
  attention: boolean;
  /** Which lane on the Conducting Board this card belongs to. */
  lane: Lane;
  /** The active task's description text. */
  taskDescription: string;
  /** The "why" from task.goal; shown as a faint italic line on the card. */
  goal?: string;
  /** Counts of added/deleted lines in the diff patch, excluding file headers. */
  diffStat?: { adds: number; dels: number };
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
}

/** The whole cockpit, a pure function of orchestrator events. `cards` are pre-ordered. */
export interface CockpitState {
  cards: CardVM[];
  focusedId?: string;
}

/** Messages the extension host sends INTO the webview. */
export type HostToWebview =
  | { type: "state"; state: CockpitState }
  | { type: "composer-options"; options: ComposerOptions };

/** Messages the webview sends OUT to the extension host. */
export type WebviewToHost =
  | { type: "ready" }
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
