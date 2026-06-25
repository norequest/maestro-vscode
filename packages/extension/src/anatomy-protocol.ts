/**
 * Anatomy editor protocol: messages between the anatomy webview and the host.
 *
 * This is its OWN webview/protocol, separate from the Stage or Library.
 * It mirrors the shape of library-protocol.ts: types first, guard at the end.
 *
 * NO node imports in this file.
 */

import type { Autonomy, ToolGrant } from "@maestro/core";
import { AUTONOMY_VALUES as AUTONOMY_LEVELS } from "@maestro/core";
import type { GrantGap } from "@maestro/config";

// ─── View-model ───────────────────────────────────────────────────────────────

/**
 * The renderable anatomy of one role, sent from host to the anatomy webview.
 * Uses `roleName` (the reusable template), never `agentId`.
 */
export interface AnatomyVM {
  roleName: string;
  instructions: string;
  engineId: string;
  model?: string;
  autonomy: Autonomy;
  /** The name of the soul referenced by role.soul, if any. */
  soulName?: string;
  /** Resolved soul.md raw text, or "" if none. */
  soulBody: string;
  tools?: ToolGrant;
  /** Precomputed counts from countGrants(role.tools). */
  toolsSummary: { granted: number; canWrite: number };
  /** Each attached/attachable skill with its grant gap precomputed. */
  skills: { name: string; allowedTools?: string[]; gap?: GrantGap | null }[];
  /** Known skills NOT currently attached to this role, for the "+ Add skill" picker. */
  availableSkills: { name: string; allowedTools?: string[] }[];
}

// ─── Message types ────────────────────────────────────────────────────────────

/** Host -> anatomy webview. */
export type HostToAnatomy = { type: "anatomy-state"; vm: AnatomyVM };

/** Anatomy webview -> host. */
export type AnatomyToHost =
  | { type: "open-anatomy"; roleName: string }
  | { type: "role-set-soul"; roleName: string; soul: string }
  | { type: "role-set-instructions"; roleName: string; instructions: string }
  | { type: "role-set-tools"; roleName: string; tools: ToolGrant }
  | { type: "role-set-engine"; roleName: string; engineId: string; model?: string }
  | { type: "role-set-autonomy"; roleName: string; autonomy: Autonomy }
  | { type: "grant-tool"; roleName: string; tool: string; write: boolean }
  | { type: "role-attach-skill"; roleName: string; skillName: string }
  | { type: "role-detach-skill"; roleName: string; skillName: string };

// ─── Autonomy value set ───────────────────────────────────────────────────────

const AUTONOMY_VALUES = new Set<string>(AUTONOMY_LEVELS);

// ─── Runtime guard ────────────────────────────────────────────────────────────

function isString(value: unknown): value is string {
  return typeof value === "string";
}

/**
 * Pure runtime guard for the anatomy webview->host boundary. The webview is a
 * separate, potentially-compromised JS context, so its postMessage payloads are
 * untrusted `unknown`. This narrows them to a real AnatomyToHost, letting the
 * host drop anything malformed before it reaches the controller.
 *
 * Mirrors isLibraryMessage exactly. Every variant requires roleName: string.
 */
export function isAnatomyMessage(msg: unknown): msg is AnatomyToHost {
  if (msg === null || typeof msg !== "object") return false;
  const m = msg as Record<string, unknown>;
  if (!isString(m["type"])) return false;
  const type = m["type"];

  switch (type) {
    case "open-anatomy":
      return isString(m["roleName"]);

    case "role-set-soul":
      return isString(m["roleName"]) && isString(m["soul"]);

    case "role-set-instructions":
      return isString(m["roleName"]) && isString(m["instructions"]);

    case "role-set-tools":
      return (
        isString(m["roleName"]) &&
        m["tools"] !== null &&
        typeof m["tools"] === "object" &&
        !Array.isArray(m["tools"])
      );

    case "role-set-engine":
      return (
        isString(m["roleName"]) &&
        isString(m["engineId"]) &&
        (m["model"] === undefined || isString(m["model"]))
      );

    case "role-set-autonomy":
      return (
        isString(m["roleName"]) &&
        isString(m["autonomy"]) &&
        AUTONOMY_VALUES.has(m["autonomy"] as string)
      );

    case "grant-tool":
      return (
        isString(m["roleName"]) &&
        isString(m["tool"]) &&
        typeof m["write"] === "boolean"
      );

    case "role-attach-skill":
      return isString(m["roleName"]) && isString(m["skillName"]);

    case "role-detach-skill":
      return isString(m["roleName"]) && isString(m["skillName"]);

    default:
      return false;
  }
}
