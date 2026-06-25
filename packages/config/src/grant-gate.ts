import type { ToolGrant } from "@maestro/core";

/** What a skill needs that its role's grant does not cover. */
export interface GrantGap {
  /** Write-builtin names that are needed but not in the grant's write list. */
  missingWrite: string[];
  /** Read-builtin names that are needed but not in the grant's read list. */
  missingRead: string[];
  /** MCP server names that are needed but not listed in the grant's mcp array. */
  missingMcp: string[];
}

/**
 * Parse a single allowed-tool token into a structured need.
 *
 * Token forms:
 *   "Git(write)"   -> needs Git write
 *   "Read"         -> needs Read read
 *   "mcp:sec-kit"  -> needs MCP server "sec-kit"
 */
type ToolNeed =
  | { kind: "read"; name: string }
  | { kind: "write"; name: string }
  | { kind: "mcp"; server: string };

function parseToken(token: string): ToolNeed {
  const trimmed = token.trim();

  // MCP server: "mcp:<server-name>"
  if (trimmed.startsWith("mcp:")) {
    return { kind: "mcp", server: trimmed.slice(4) };
  }

  // Write builtin: "Name(write)"
  const writeMatch = trimmed.match(/^(.+)\(write\)$/i);
  if (writeMatch) {
    return { kind: "write", name: writeMatch[1]!.trim() };
  }

  // Default: read builtin
  return { kind: "read", name: trimmed };
}

/**
 * Compare a skill's declared allowedTools against a role's ToolGrant.
 * Returns a GrantGap describing what is missing, or null when fully covered.
 *
 * Write needs are satisfied ONLY by a write grant. A read grant does NOT satisfy
 * a write need (write is off by default; seam R5).
 */
export function skillNeedsGrant(
  allowedTools: string[] | undefined,
  tools: ToolGrant | undefined,
): GrantGap | null {
  if (!allowedTools || allowedTools.length === 0) {
    return null;
  }

  const grantReadSet = new Set<string>(tools?.builtins?.read ?? []);
  const grantWriteSet = new Set<string>(tools?.builtins?.write ?? []);
  const grantMcpSet = new Set<string>((tools?.mcp ?? []).map((m) => m.server));

  const missingRead: string[] = [];
  const missingWrite: string[] = [];
  const missingMcp: string[] = [];

  for (const token of allowedTools) {
    const need = parseToken(token);
    if (need.kind === "mcp") {
      if (!grantMcpSet.has(need.server)) {
        missingMcp.push(need.server);
      }
    } else if (need.kind === "write") {
      // Write is strictly separate from read; a read grant does not cover a write need.
      if (!grantWriteSet.has(need.name)) {
        missingWrite.push(need.name);
      }
    } else {
      // read need
      if (!grantReadSet.has(need.name)) {
        missingRead.push(need.name);
      }
    }
  }

  if (missingRead.length === 0 && missingWrite.length === 0 && missingMcp.length === 0) {
    return null;
  }

  return { missingRead, missingWrite, missingMcp };
}
