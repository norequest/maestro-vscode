/** The minimal shape of an ACP JSON-RPC message we care about. */
export interface AcpMessage {
  jsonrpc: "2.0";
  id?: number | string;
  method: string;
  params?: Record<string, unknown>;
  error?: { code: number; message: string };
}

/**
 * The concrete approval detail shape emitted in AgentEvent approval.detail.
 * This is the documented M5 -> M6 downstream contract.
 */
export interface AcpApprovalDetail {
  /** Human-readable description of what the agent wants to do. */
  description: string;
  /** The ACP tool name (e.g. "bash", "write_file"). */
  tool: string;
  /** Raw args from the ACP requestPermission message, if present. */
  args?: Record<string, unknown>;
}

/** Autonomy-to-ACP permission mode mapping. */
export type AcpPermissionMode = "ask" | "auto-approve-safe" | "allow-all";

export function autonomyToPermissionMode(
  autonomy: "manual" | "auto-approve-safe" | "yolo",
): AcpPermissionMode {
  switch (autonomy) {
    case "manual":
      return "ask";
    case "auto-approve-safe":
      return "auto-approve-safe";
    case "yolo":
      return "allow-all";
  }
}

/**
 * Injectable transport abstraction. In production, ProcessAcpTransport wraps a
 * child process. In tests, FakeAcpTransport scripts messages without a subprocess.
 */
export interface AcpTransport {
  /** Async-iterate incoming ACP messages parsed from stdout NDJSON. */
  readonly messages: AsyncIterable<AcpMessage>;
  /** Write an outgoing ACP message as a JSON line to stdin. */
  send(msg: AcpMessage): void;
  /** Kill the subprocess (or end the fake) and close the message stream. */
  terminate(): void;
}

/**
 * Mirrors SpawnFn in adapter-copilot: a factory that creates an AcpTransport for
 * a given subprocess invocation. Injectable for offline testing.
 */
export type AcpTransportFn = (
  command: string,
  args: readonly string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv },
) => AcpTransport;
