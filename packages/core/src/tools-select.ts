import type { ToolGrant } from "./types.js";

export interface GrantCount {
  granted: number;
  canWrite: number;
}

/**
 * Count granted tools across builtins and mcp entries.
 *
 * Write is tracked separately from read; absence of a write entry means
 * read-only (canWrite stays 0 for that tool).
 */
export function countGrants(tools: ToolGrant | undefined): GrantCount {
  if (!tools) return { granted: 0, canWrite: 0 };

  const reads = new Set(tools.builtins?.read ?? []);
  const writes = new Set(tools.builtins?.write ?? []);
  const mcp = tools.mcp ?? [];

  // Unique builtin names across both read and write sets
  const uniqueBuiltins = new Set<string>([...reads, ...writes]);
  const mcpGranted = mcp.filter((m) => m.read || m.write);
  const mcpWriteable = mcp.filter((m) => m.write);

  const granted = uniqueBuiltins.size + mcpGranted.length;
  const canWrite = writes.size + mcpWriteable.length;

  return { granted, canWrite };
}

/**
 * Render grants as constraint lines for the preamble.
 *
 * Read-only tools are listed without annotation; write grants are tagged
 * "(write)". Returns empty string when there is nothing to render.
 */
export function renderToolsForPreamble(tools: ToolGrant | undefined): string {
  if (!tools) return "";

  const lines: string[] = [];

  const reads = new Set(tools.builtins?.read ?? []);
  const writes = new Set(tools.builtins?.write ?? []);

  // Emit each builtin read entry (read-only, no tag)
  for (const name of reads) {
    lines.push(name);
  }

  // Emit each builtin write entry (tagged)
  for (const name of writes) {
    lines.push(`${name} (write)`);
  }

  // Emit mcp entries
  const mcp = tools.mcp ?? [];
  for (const entry of mcp) {
    if (!entry.read && !entry.write) continue;
    if (entry.write) {
      lines.push(`mcp:${entry.server} (write)`);
    } else {
      lines.push(`mcp:${entry.server}`);
    }
  }

  return lines.join("\n");
}
