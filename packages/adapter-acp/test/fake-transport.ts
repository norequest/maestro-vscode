import { AsyncMessageQueue } from "../src/async-queue.js";
import type { AcpMessage, AcpTransport } from "../src/types.js";

/**
 * A fake AcpTransport that accepts a pre-scripted sequence of inbound messages
 * and records outbound messages. No subprocess involved.
 */
export class FakeAcpTransport implements AcpTransport {
  private readonly queue = new AsyncMessageQueue<AcpMessage>();
  readonly sent: AcpMessage[] = [];

  get messages(): AsyncIterable<AcpMessage> {
    return this.queue;
  }

  /** Push a pre-scripted inbound message (simulates the ACP agent sending it). */
  receive(msg: AcpMessage): void {
    this.queue.push(msg);
  }

  /** End the inbound message stream (simulates the subprocess exiting cleanly). */
  end(): void {
    this.queue.end();
  }

  /** End with a synthetic error message. */
  endWithError(message: string): void {
    this.queue.push({ jsonrpc: "2.0", method: "error", params: { message } });
    this.queue.end();
  }

  send(msg: AcpMessage): void {
    this.sent.push(msg);
  }

  terminate(): void {
    this.queue.end();
  }
}

/** Convenience builder for a scripted ACP text-delta session update. */
export function acpSessionUpdate(text: string): AcpMessage {
  return {
    jsonrpc: "2.0",
    method: "session/update",
    params: { delta: { type: "text", text } },
  };
}

export function acpRequestPermission(
  id: number | string,
  tool: string,
  description: string,
  args?: Record<string, unknown>,
): AcpMessage {
  return {
    jsonrpc: "2.0",
    id,
    method: "requestPermission",
    params: { tool, description, ...(args ? { args } : {}) },
  };
}

export function acpTurnComplete(summary: string): AcpMessage {
  return { jsonrpc: "2.0", method: "turn/complete", params: { summary } };
}

export function acpError(message: string): AcpMessage {
  return { jsonrpc: "2.0", method: "error", params: { message } };
}

/** A JSON-RPC error RESPONSE frame (no method), e.g. a failed initialize. */
export function acpErrorResponse(id: number | string, code: number, message: string): AcpMessage {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

/** A slash-namespaced permission request, the form real ACP engines use. */
export function acpSessionRequestPermission(
  id: number | string | undefined,
  tool: string,
  description: string,
  args?: Record<string, unknown>,
): AcpMessage {
  return {
    jsonrpc: "2.0",
    ...(id !== undefined ? { id } : {}),
    method: "session/request_permission",
    params: { tool, description, ...(args ? { args } : {}) },
  };
}
