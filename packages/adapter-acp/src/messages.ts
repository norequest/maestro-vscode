import type { ApprovalDecision } from "@maestro/core";
import type { AcpMessage, AcpPermissionMode } from "./types.js";

/** Parse one NDJSON line from ACP stdout. Returns null on empty/invalid lines. */
export function parseAcpLine(line: string): AcpMessage | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      "jsonrpc" in parsed &&
      "method" in parsed
    ) {
      return parsed as AcpMessage;
    }
    return null;
  } catch {
    return null;
  }
}

let _nextId = 1;

/** Build an ACP `initialize` request to kick off a session. */
export function buildInitialize(opts: {
  instructions: string;
  permissionMode: AcpPermissionMode;
  model?: string;
}): AcpMessage {
  return {
    jsonrpc: "2.0",
    id: _nextId++,
    method: "initialize",
    params: {
      systemPrompt: opts.instructions,
      permissionMode: opts.permissionMode,
      ...(opts.model ? { model: opts.model } : {}),
    },
  };
}

/** Build an ACP `permission_response` notification. */
export function buildPermissionResponse(
  approvalId: string,
  decision: ApprovalDecision,
): AcpMessage {
  return {
    jsonrpc: "2.0",
    method: "permission_response",
    params: {
      id: approvalId,
      granted: decision === "allow",
    },
  };
}

/** Build an ACP `user_turn` notification to inject a follow-up prompt. */
export function buildUserTurn(content: string): AcpMessage {
  return {
    jsonrpc: "2.0",
    method: "user_turn",
    params: { content },
  };
}
