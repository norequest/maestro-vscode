import type { FsReader } from "../loader.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface McpServerInfo {
  name: string;
  description?: string;
  writeCapable: boolean;
}

export interface McpInventory {
  servers: McpServerInfo[];
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

// "fs" alone catches server names like "fs-server"; "file" catches "filesystem", "file-writer" etc.
const WRITE_SIGNAL = /write|edit|fs\b|file/i;

/**
 * Returns true when the server name or any string in its args signals
 * write/edit/fs capability (case-insensitive).
 */
function inferWriteCapable(name: string, args: string[]): boolean {
  if (WRITE_SIGNAL.test(name)) return true;
  return args.some((a) => WRITE_SIGNAL.test(a));
}

/**
 * Parse `.mcp.json` format:
 * ```json
 * { "mcpServers": { "<name>": { "description"?: "...", "args"?: [...] } } }
 * ```
 * Returns an empty array on any error.
 */
function parseDotMcpJson(text: string): McpServerInfo[] {
  try {
    const obj = JSON.parse(text) as unknown;
    if (typeof obj !== "object" || obj === null) return [];
    const servers = (obj as Record<string, unknown>)["mcpServers"];
    if (typeof servers !== "object" || servers === null) return [];
    const result: McpServerInfo[] = [];
    for (const [name, value] of Object.entries(servers as Record<string, unknown>)) {
      const entry = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
      const description =
        typeof entry["description"] === "string" ? entry["description"] : undefined;
      const rawArgs = Array.isArray(entry["args"]) ? (entry["args"] as unknown[]) : [];
      const args = rawArgs.filter((a): a is string => typeof a === "string");
      result.push({ name, description, writeCapable: inferWriteCapable(name, args) });
    }
    return result;
  } catch {
    return [];
  }
}

/**
 * Parse `.vscode/mcp.json` format:
 * ```json
 * { "servers": [ { "name": "...", "description"?: "...", "args"?: [...] } ] }
 * ```
 * Returns an empty array on any error.
 */
function parseVscodeMcpJson(text: string): McpServerInfo[] {
  try {
    const obj = JSON.parse(text) as unknown;
    if (typeof obj !== "object" || obj === null) return [];
    const servers = (obj as Record<string, unknown>)["servers"];
    if (!Array.isArray(servers)) return [];
    const result: McpServerInfo[] = [];
    for (const item of servers) {
      if (typeof item !== "object" || item === null) continue;
      const entry = item as Record<string, unknown>;
      const name = entry["name"];
      if (typeof name !== "string" || name.trim() === "") continue;
      const description =
        typeof entry["description"] === "string" ? entry["description"] : undefined;
      const rawArgs = Array.isArray(entry["args"]) ? (entry["args"] as unknown[]) : [];
      const args = rawArgs.filter((a): a is string => typeof a === "string");
      result.push({ name, description, writeCapable: inferWriteCapable(name, args) });
    }
    return result;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Reads MCP server inventory from two optional config files and unions them
 * by server name (first occurrence wins for description and writeCapable).
 *
 * Sources (in order):
 *   1. `{root}/.mcp.json`          key `mcpServers` (object keyed by name)
 *   2. `{root}/.vscode/mcp.json`   key `servers` (array of objects)
 *
 * This function never throws and never starts a server. Missing or malformed
 * files contribute an empty list.
 */
export async function readMcpInventory(root: string, fs: FsReader): Promise<McpInventory> {
  const seen = new Map<string, McpServerInfo>();

  async function readSource(path: string, parse: (text: string) => McpServerInfo[]): Promise<void> {
    try {
      const exists = await fs.exists(path);
      if (!exists) return;
      const text = await fs.readFile(path);
      const entries = parse(text);
      for (const entry of entries) {
        if (!seen.has(entry.name)) {
          seen.set(entry.name, entry);
        }
      }
    } catch {
      // Silently ignore I/O errors; missing/malformed files contribute nothing.
    }
  }

  const dotMcpPath = `${root}/.mcp.json`;
  const vscodeMcpPath = `${root}/.vscode/mcp.json`;

  await readSource(dotMcpPath, parseDotMcpJson);
  await readSource(vscodeMcpPath, parseVscodeMcpJson);

  return { servers: Array.from(seen.values()) };
}
