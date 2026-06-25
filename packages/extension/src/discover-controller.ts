/**
 * Discover controller: handles inbound scan/adopt/browse messages from the
 * Library webview's Discover tab. Wires the workspace/plugin scanners to the
 * adopt flow (anatomy editor for agents, writeSkill + skill editor for skills).
 *
 * Cache policy:
 *   - Map<string, DiscoveredItem> keyed by item.source
 *   - scan-repo and scan-plugins each MERGE into the cache (no wipe)
 *   - emit always sends ALL cached items combined
 *
 * NO vscode imports. NO node imports. Pure TS with injected deps.
 */

import type { DiscoverResult, DiscoveredItem, AdoptDraft, McpInventory, Provenance } from "@maestro/config";
import { mapToRole } from "@maestro/config";
import type { HostToLibrary, LibraryToHost } from "./library-protocol.js";

// ─── DiscoverDeps ─────────────────────────────────────────────────────────────

export interface DiscoverDeps {
  /** Scan the workspace root for agent/role/skill files. */
  scanWorkspace(): Promise<DiscoverResult>;
  /** Scan installed plugins. Resolves to an empty result when opt-in is off. */
  scanPlugins(): Promise<DiscoverResult>;
  /** Returns the current HEAD SHA, or undefined in a repo-less workspace. */
  headSha(): Promise<string | undefined>;
  /** Persist an adopted skill file. */
  writeSkill(name: string, item: DiscoveredItem): Promise<void>;
  /** Return the live MCP inventory (already loaded by the extension host). */
  mcpInventory(): McpInventory;
  /**
   * Adopt the role: the host persists it to `.conductor/roles/`, refreshes the
   * Library so the Agents tab lists it, then opens the Anatomy editor on the saved
   * role for optional tuning. The controller itself never touches disk.
   */
  openAnatomyEditor(draft: AdoptDraft): void;
  /** Open the skill editor pre-filled with the discovered skill item. */
  openSkillEditor(item: DiscoveredItem, provenance: Provenance): void;
  /** Returns an ISO date string used as `adoptedAt`. */
  now(): string;
  /** Emit a discover-results message into the webview. */
  emit(msg: Extract<HostToLibrary, { type: "discover-results" }>): void;
}

// ─── createDiscoverController ─────────────────────────────────────────────────

export function createDiscoverController(deps: DiscoverDeps): {
  handle(
    msg: Extract<LibraryToHost, { type: "scan-repo" | "scan-plugins" | "adopt-agent" | "adopt-skill" | "browse-source" }>
  ): Promise<void>;
} {
  /** Merged cache of all scanned items, keyed by item.source. */
  const cache = new Map<string, DiscoveredItem>();

  /** Sources already adopted this session, so re-emits keep the card marked. */
  const adopted = new Set<string>();

  /** MCP from the most recent scan. Falls back to deps.mcpInventory(). */
  let lastMcp: McpInventory = { servers: [] };

  function emitAll(mcp: McpInventory, scanError?: string): void {
    deps.emit({
      type: "discover-results",
      items: Array.from(cache.values()),
      mcp,
      scanError,
      adoptedSources: Array.from(adopted),
    });
  }

  function mergeItems(items: DiscoveredItem[]): void {
    for (const item of items) {
      cache.set(item.source, item);
    }
  }

  async function buildProvenance(item: DiscoveredItem): Promise<Provenance> {
    return {
      sourcePath: item.source,
      upstreamSha: await deps.headSha(),
      adoptedAt: deps.now(),
    };
  }

  async function handle(
    msg: Extract<LibraryToHost, { type: "scan-repo" | "scan-plugins" | "adopt-agent" | "adopt-skill" | "browse-source" }>
  ): Promise<void> {
    switch (msg.type) {
      case "scan-repo": {
        try {
          const result = await deps.scanWorkspace();
          mergeItems(result.items);
          lastMcp = result.mcp;
          emitAll(result.mcp);
        } catch (err) {
          const scanError = err instanceof Error ? err.message : String(err);
          emitAll(lastMcp, scanError);
        }
        return;
      }

      case "scan-plugins": {
        try {
          const result = await deps.scanPlugins();
          mergeItems(result.items);
          lastMcp = result.mcp;
          emitAll(result.mcp);
        } catch (err) {
          const scanError = err instanceof Error ? err.message : String(err);
          emitAll(lastMcp, scanError);
        }
        return;
      }

      case "adopt-agent": {
        const item = cache.get(msg.itemId);
        if (!item) return;
        const provenance = await buildProvenance(item);
        const draft = mapToRole(item, deps.mcpInventory(), provenance);
        deps.openAnatomyEditor(draft);
        // Mark adopted and re-emit so the Discover card shows the adopted state
        // (green tick) instead of still inviting another adopt.
        adopted.add(item.source);
        emitAll(lastMcp);
        return;
      }

      case "adopt-skill": {
        const item = cache.get(msg.itemId);
        if (!item) return;
        const provenance = await buildProvenance(item);
        await deps.writeSkill(item.name, item);
        deps.openSkillEditor(item, provenance);
        adopted.add(item.source);
        emitAll(lastMcp);
        return;
      }

      case "browse-source": {
        // Handled by the extension layer via a separate vscode.open call.
        return;
      }

      default: {
        // Exhaustiveness guard.
        const _exhaustive: never = msg;
        void _exhaustive;
        return;
      }
    }
  }

  return { handle };
}
