import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACP_KILL_GRACE_MS, ProcessAcpTransport } from "../src/transport.js";
import type { AcpChildHandle } from "../src/transport.js";
import type { AcpMessage } from "../src/types.js";

/** A controllable fake of a Node child process satisfying AcpChildHandle. */
class FakeChild implements AcpChildHandle {
  private dataListener?: (chunk: Buffer | string) => void;
  private stderrListener?: (chunk: Buffer | string) => void;
  private closeListener?: (code: number | null) => void;
  private errorListener?: (err: Error) => void;
  killed = false;
  /** Every signal passed to kill(), in order, so an escalation is observable. */
  readonly killSignals: NodeJS.Signals[] = [];
  readonly written: string[] = [];
  readonly stdout = {
    on: (_event: "data", listener: (chunk: Buffer | string) => void): void => {
      this.dataListener = listener;
    },
  };
  readonly stderr = {
    on: (_event: "data", listener: (chunk: Buffer | string) => void): void => {
      this.stderrListener = listener;
    },
  };
  readonly stdin = {
    write: (data: string): void => {
      this.written.push(data);
    },
  };
  on(
    event: "close" | "error",
    listener: ((code: number | null) => void) & ((err: Error) => void),
  ): void {
    if (event === "close") this.closeListener = listener;
    else this.errorListener = listener;
  }
  kill(signal?: NodeJS.Signals): void {
    this.killed = true;
    if (signal) this.killSignals.push(signal);
  }
  emit(chunk: string): void {
    this.dataListener?.(chunk);
  }
  emitErr(chunk: Buffer | string): void {
    this.stderrListener?.(chunk);
  }
  close(code: number | null): void {
    this.closeListener?.(code);
  }
  fail(err: Error): void {
    this.errorListener?.(err);
  }
}

async function collect(t: ProcessAcpTransport): Promise<AcpMessage[]> {
  const out: AcpMessage[] = [];
  for await (const m of t.messages) out.push(m);
  return out;
}

describe("ProcessAcpTransport NDJSON buffering", () => {
  it("reassembles a message split across two chunks", async () => {
    const child = new FakeChild();
    const transport = new ProcessAcpTransport(child);
    const collected = collect(transport);
    const line = JSON.stringify({ jsonrpc: "2.0", method: "turn/complete", params: { summary: "ok" } });
    child.emit(line.slice(0, 10));
    child.emit(line.slice(10) + "\n");
    child.close(0);
    const msgs = await collected;
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.method).toBe("turn/complete");
  });

  it("parses multiple newline-delimited messages in one chunk", async () => {
    const child = new FakeChild();
    const transport = new ProcessAcpTransport(child);
    const collected = collect(transport);
    const a = JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: {} });
    const b = JSON.stringify({ jsonrpc: "2.0", method: "turn/complete", params: { summary: "done" } });
    child.emit(a + "\n" + b + "\n");
    child.close(0);
    const msgs = await collected;
    expect(msgs.map((m) => m.method)).toEqual(["session/update", "turn/complete"]);
  });

  it("emits a synthetic error message on non-zero exit", async () => {
    const child = new FakeChild();
    const transport = new ProcessAcpTransport(child);
    const collected = collect(transport);
    child.close(1);
    const msgs = await collected;
    expect(msgs.at(-1)!.method).toBe("error");
  });

  it("emits a synthetic error message on child error then ends", async () => {
    const child = new FakeChild();
    const transport = new ProcessAcpTransport(child);
    const collected = collect(transport);
    child.fail(new Error("spawn failed"));
    const msgs = await collected;
    expect(msgs.at(-1)!.method).toBe("error");
    expect((msgs.at(-1)!.params as any).message).toContain("spawn failed");
  });

  it("flushes a trailing buffered line with no newline when the child closes", async () => {
    const child = new FakeChild();
    const transport = new ProcessAcpTransport(child);
    const collected = collect(transport);
    const line = JSON.stringify({
      jsonrpc: "2.0",
      method: "turn/complete",
      params: { summary: "ok" },
    });
    // Final frame written WITHOUT a trailing newline, then a clean exit.
    child.emit(line);
    child.close(0);
    const msgs = await collected;
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.method).toBe("turn/complete");
  });

  it("flushes a trailing buffered line when the child errors", async () => {
    const child = new FakeChild();
    const transport = new ProcessAcpTransport(child);
    const collected = collect(transport);
    const line = JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: {} });
    child.emit(line);
    child.fail(new Error("boom"));
    const msgs = await collected;
    // The buffered frame is delivered before the synthetic error.
    expect(msgs.map((m) => m.method)).toEqual(["session/update", "error"]);
  });

  it("parses CRLF-delimited lines without leaving a stray carriage return", async () => {
    const child = new FakeChild();
    const transport = new ProcessAcpTransport(child);
    const collected = collect(transport);
    const a = JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: {} });
    const b = JSON.stringify({ jsonrpc: "2.0", method: "turn/complete", params: { summary: "d" } });
    child.emit(a + "\r\n" + b + "\r\n");
    child.close(0);
    const msgs = await collected;
    expect(msgs.map((m) => m.method)).toEqual(["session/update", "turn/complete"]);
  });

  it("send() writes a JSON line to stdin; terminate() kills the child", () => {
    const child = new FakeChild();
    const transport = new ProcessAcpTransport(child);
    transport.send({ jsonrpc: "2.0", method: "user_turn", params: { content: "hi" } });
    expect(child.written[0]).toContain('"user_turn"');
    expect(child.written[0]!.endsWith("\n")).toBe(true);
    transport.terminate();
    expect(child.killed).toBe(true);
  });
});

// H2: the child's stderr is piped, so it MUST be drained or a chatty engine
// (e.g. gemini --acp) eventually fills the ~64 KB OS pipe buffer, blocks on its
// next stderr write, stops writing stdout, and the transport never closes.
describe("ProcessAcpTransport stderr draining", () => {
  it("drains a large multi-chunk stderr stream without blocking and surfaces its tail on a non-zero exit", async () => {
    const child = new FakeChild();
    const transport = new ProcessAcpTransport(child);
    const collected = collect(transport);
    // Many chunks, far more than any OS pipe buffer would hold. A real child
    // would have blocked long ago if nobody were reading; the fake just proves
    // every chunk is consumed without the transport stalling.
    for (let i = 0; i < 5000; i++) child.emitErr(`stderr line ${i}\n`);
    const tail = "FINAL_DIAGNOSTIC: gemini crashed";
    child.emitErr(tail + "\n");
    child.close(7);
    const msgs = await collected;
    const last = msgs.at(-1)!;
    expect(last.method).toBe("error");
    const message = (last.params as { message: string }).message;
    expect(message).toContain("code 7");
    expect(message).toContain(tail);
  });

  it("bounds the captured stderr to roughly the last 8 KB", async () => {
    const child = new FakeChild();
    const transport = new ProcessAcpTransport(child);
    const collected = collect(transport);
    const filler = "x".repeat(9000); // exceeds the 8 KB cap
    const tail = "REAL_TAIL_MARKER";
    child.emitErr(filler + tail);
    child.close(1);
    const message = ((await collected).at(-1)!.params as { message: string }).message;
    expect(message).toContain(tail);
    // The early filler must have been dropped to keep the buffer bounded.
    expect(message.length).toBeLessThan(9000);
  });

  it("includes the stderr tail in the synthetic error on a spawn/runtime error", async () => {
    const child = new FakeChild();
    const transport = new ProcessAcpTransport(child);
    const collected = collect(transport);
    child.emitErr("permission denied opening pty\n");
    child.fail(new Error("spawn EACCES"));
    const message = ((await collected).at(-1)!.params as { message: string }).message;
    expect(message).toContain("spawn EACCES");
    expect(message).toContain("permission denied opening pty");
  });

  it("decodes Buffer stderr chunks (not just strings)", async () => {
    const child = new FakeChild();
    const transport = new ProcessAcpTransport(child);
    const collected = collect(transport);
    child.emitErr(Buffer.from("boom from a buffer", "utf8"));
    child.close(1);
    const message = ((await collected).at(-1)!.params as { message: string }).message;
    expect(message).toContain("boom from a buffer");
  });

  it("leaves stdout parsing and clean-exit handling unchanged while stderr flows", async () => {
    const child = new FakeChild();
    const transport = new ProcessAcpTransport(child);
    const collected = collect(transport);
    const a = JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: {} });
    const b = JSON.stringify({ jsonrpc: "2.0", method: "turn/complete", params: { summary: "ok" } });
    child.emitErr("warning: noisy diagnostics\n");
    child.emit(a + "\n");
    child.emitErr("more noise\n");
    child.emit(b + "\n");
    child.close(0);
    const msgs = await collected;
    // No synthetic error on a clean exit, and both stdout frames still parsed.
    expect(msgs.map((m) => m.method)).toEqual(["session/update", "turn/complete"]);
  });
});

// M3: terminate() must escalate to SIGKILL if the child ignores SIGTERM, so a
// stuck engine cannot keep mutating the worktree the user is about to merge.
describe("ProcessAcpTransport terminate() SIGKILL escalation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("escalates to SIGKILL when the child ignores SIGTERM past the grace window", () => {
    const child = new FakeChild();
    const transport = new ProcessAcpTransport(child);
    transport.terminate();
    expect(child.killSignals).toEqual(["SIGTERM"]);
    // Child never emits close; advance past the grace window.
    vi.advanceTimersByTime(ACP_KILL_GRACE_MS);
    expect(child.killSignals).toEqual(["SIGTERM", "SIGKILL"]);
  });

  it("does NOT escalate when the child exits within the grace window", () => {
    const child = new FakeChild();
    const transport = new ProcessAcpTransport(child);
    transport.terminate();
    expect(child.killSignals).toEqual(["SIGTERM"]);
    child.close(0); // exits promptly in response to SIGTERM
    vi.advanceTimersByTime(ACP_KILL_GRACE_MS * 2);
    expect(child.killSignals).toEqual(["SIGTERM"]); // no SIGKILL
  });

  it("does not escalate after a child that had already exited is terminated", () => {
    const child = new FakeChild();
    const transport = new ProcessAcpTransport(child);
    child.close(0);
    transport.terminate(); // settled already, so this is a no-op
    vi.advanceTimersByTime(ACP_KILL_GRACE_MS * 2);
    expect(child.killSignals).toEqual([]);
  });
});
