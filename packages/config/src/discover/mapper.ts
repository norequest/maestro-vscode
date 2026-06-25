import type { Role } from "@hallucinate/core";
import { validateRole } from "../validator.js";
import { KNOWN_ENGINE_IDS } from "../types.js";
import type { DiscoveredItem } from "./types.js";
import type { McpInventory } from "./mcp.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface Provenance {
  sourcePath: string;
  upstreamSha?: string;
  adoptedAt: string;
}

export interface AdoptDraft {
  /** Validator-clean role: engine is always "copilot" or "acp". */
  role: Role;
  provenance: Provenance;
  /**
   * Skill chips proposed by the mapper (from declared write tools, etc.).
   * These are unverified suggestions; the adopt UI shows them for user review.
   */
  proposedSkills: string[];
  /**
   * Tools the source declared that have no backing MCP server in the current
   * workspace. Shown red in the UI; never granted to role.tools.
   */
  unavailableTools: string[];
  /**
   * Non-empty when the mapper clamped autonomy DOWN one notch.
   * Explains the reason so the adopt UI can show it to the user.
   */
  autonomyClampNote?: string;
}

// Re-export McpInventory so existing imports from mapper.ts continue to work.
export type { McpInventory };

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Write-capable builtin tool names (mirror validator.ts VALID_WRITE_BUILTINS). */
const WRITE_BUILTINS = new Set(["Edit", "Run", "Git"]);

/** Builtins that require a write grant. */
function isWriteTool(name: string): boolean {
  return WRITE_BUILTINS.has(name);
}

/**
 * Sanitize a name so it passes validateRole's name rules:
 * - trim whitespace
 * - strip leading dash (CLI injection guard, Issue 29 / S4)
 * - strip ASCII control characters
 * - fall back to filename stem when the result is empty
 */
function sanitizeName(raw: string, fallback: string): string {
  // Strip control chars.
  // eslint-disable-next-line no-control-regex
  let name = raw.trim().replace(/[\x00-\x1f]/g, "");
  // Strip a leading dash (argument-injection guard).
  if (name.startsWith("-")) {
    name = name.replace(/^-+/, "");
  }
  return name.trim() || fallback;
}

/**
 * Derive a filename stem from a source path for use as a fallback name.
 */
function sourceStem(source: string): string {
  const base = source.split("/").pop() ?? source;
  for (const ext of [".agent.md", ".chatmode.md", ".prompt.md", ".mdc", ".yaml", ".md"]) {
    if (base.endsWith(ext)) return base.slice(0, base.length - ext.length);
  }
  const dot = base.lastIndexOf(".");
  return dot >= 0 ? base.slice(0, dot) : base;
}

/**
 * Resolve the engine id from a DiscoveredItem.
 *
 * Rules (in order):
 * 1. hallucinate-role already has a known engine id in its engineHint: use it directly.
 * 2. engineHint starts with "copilot", source is under .github/, or kind is plugin-agent: -> "copilot"
 * 3. Everything else (claude*, gemini*, acp-leaning hints, continue, cursor): -> "acp"
 * 4. Unknown/missing: -> "acp" (safe default)
 *
 * INVARIANT: the returned id is always in KNOWN_ENGINE_IDS.
 */
function resolveEngine(item: DiscoveredItem): string {
  // native roles carry a valid engine id in their hint.
  if (item.kind === "hallucinate-role" && item.engineHint && KNOWN_ENGINE_IDS.has(item.engineHint)) {
    return item.engineHint;
  }

  // plugin-agent defaults to copilot.
  if (item.kind === "plugin-agent") return "copilot";

  // Copilot family: explicit hint or .github/ source pattern.
  const hint = item.engineHint ?? "";
  if (
    hint === "copilot" ||
    hint.startsWith("copilot") ||
    item.source.includes("/.github/") ||
    item.kind === "copilot-agent" ||
    item.kind === "copilot-chatmode"
  ) {
    return "copilot";
  }

  // All other hints (claude*, gemini*, acp, empty) map to acp.
  return "acp";
}

/**
 * Clamp autonomy DOWN one notch based on permissionHint and declared tools.
 *
 * - "bypassPermissions" -> "auto-approve-safe" (note added)
 * - "acceptEdits" or write tool declared -> "manual" (note added)
 * - read-only / no signal -> "manual" (conservative default for foreign agents)
 *
 * We NEVER raise autonomy above "manual" for untrusted foreign sources.
 */
function resolveAutonomy(
  item: DiscoveredItem,
): { autonomy: Role["autonomy"]; note?: string } {
  const hint = item.permissionHint ?? "";

  if (hint === "bypassPermissions") {
    return {
      autonomy: "auto-approve-safe",
      note: 'permission hint "bypassPermissions" clamped to auto-approve-safe (yolo not granted to adopted agents)',
    };
  }

  const hasWriteTool = item.declaredTools.some((t) => isWriteTool(t));
  if (hint === "acceptEdits" || hasWriteTool) {
    return {
      autonomy: "manual",
      note: hasWriteTool
        ? "declared write tools require manual approval; autonomy set to manual"
        : 'permission hint "acceptEdits" requires manual approval; autonomy set to manual',
    };
  }

  // Conservative default: manual for all foreign agents.
  return { autonomy: "manual" };
}

// ---------------------------------------------------------------------------
// Public mapper
// ---------------------------------------------------------------------------

/**
 * Map a DiscoveredItem to an AdoptDraft containing a validator-clean Role.
 *
 * Guarantees:
 * - `validateRole(draft.role).ok === true` for every produced draft.
 * - engine.id is always in KNOWN_ENGINE_IDS ("copilot" or "acp").
 * - Autonomy is clamped DOWN only; never raised.
 * - Write tools are NEVER silently granted.
 *   - Declared write tools with a backing MCP server: moved to proposedSkills.
 *   - Declared write tools without a backing MCP server: moved to unavailableTools.
 * - role.provenance is set from the provenance argument.
 */
export function mapToRole(
  item: DiscoveredItem,
  mcp: McpInventory,
  provenance: Provenance,
): AdoptDraft {
  // --- 1. Sanitize name ---
  const stem = sourceStem(item.source);
  const name = sanitizeName(item.name, stem);

  // --- 2. Resolve engine ---
  const engineId = resolveEngine(item);

  // --- 3. Resolve autonomy ---
  const { autonomy, note: autonomyClampNote } = resolveAutonomy(item);

  // --- 4. Instructions: body first, fall back to description ---
  const instructions = item.body.trim() || item.description.trim() || `Adopted from ${item.source}`;

  // --- 5. Write-gate: split declared tools into unavailable vs proposed ---
  const serverNames = new Set(mcp.servers.map((s) => s.name));
  const unavailableTools: string[] = [];
  const proposedSkills: string[] = [];

  for (const tool of item.declaredTools) {
    if (isWriteTool(tool)) {
      // Write builtin: never grant; propose as a skill chip instead.
      proposedSkills.push(tool);
    } else {
      // Non-write tool: check if it maps to an MCP server.
      // If the tool name matches a known MCP server name, it's available.
      // If not, it goes to unavailableTools (we cannot grant what we don't have).
      if (!serverNames.has(tool)) {
        unavailableTools.push(tool);
      }
      // Available read-only MCP tools are noted but not auto-granted to role.tools
      // (the adopt UI handles grants explicitly).
    }
  }

  // Also check write-capable MCP servers declared in the source.
  // Write-capable MCP servers that are available go to proposedSkills.
  // (We look at declaredTools that match server names with writeCapable=true.)
  for (const tool of item.declaredTools) {
    const server = mcp.servers.find((s) => s.name === tool);
    if (server?.writeCapable && !proposedSkills.includes(tool)) {
      proposedSkills.push(tool);
    }
  }

  // --- 6. Build the role (no write grants) ---
  const role: Role = {
    name,
    instructions,
    engine: { id: engineId },
    autonomy,
    provenance: {
      source: provenance.sourcePath,
      ...(provenance.upstreamSha !== undefined ? { sha: provenance.upstreamSha } : {}),
      adoptedAt: provenance.adoptedAt,
    },
  };

  // --- 7. Paranoid validation: MUST always pass ---
  const validation = validateRole(role);
  if (!validation.ok) {
    // This should never happen if the mapper logic is correct.
    // If it does, return a safe fallback rather than propagating invalid state.
    const safeRole: Role = {
      name: stem || "adopted-agent",
      instructions: `Adopted from ${item.source}. (Name or instructions could not be sanitized.)`,
      engine: { id: "acp" },
      autonomy: "manual",
      provenance: {
        source: provenance.sourcePath,
        adoptedAt: provenance.adoptedAt,
      },
    };
    return {
      role: safeRole,
      provenance,
      proposedSkills,
      unavailableTools,
      autonomyClampNote: `Mapper fallback: ${validation.errors.join("; ")}`,
    };
  }

  return {
    role: validation.value,
    provenance,
    proposedSkills,
    unavailableTools,
    autonomyClampNote,
  };
}
