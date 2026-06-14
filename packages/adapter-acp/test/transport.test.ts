import { describe, expect, it } from "vitest";
import { ProcessAcpTransport } from "../src/transport.js";
import type { AcpChildHandle } from "../src/transport.js";
import type { AcpMessage } from "../src/types.js";

/** A controllable fake of a Node child process satisfying AcpChildHandle. */
class FakeChild implements AcpChildHandle {
  private dataListener?: (chunk: Buffer | string) => void;
  private closeListener?: (code: number | null) => void;
  private errorListener?: (err: Error) => void;
  killed = false;
  readonly written: string[] = [];
  readonly stdout = {
    on: (_event: "data", listener: (chunk: Buffer | string) => void): void => {
      this.dataListener = listener;
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
  kill(): void {
    this.killed = true;
  }
  emit(chunk: string): void {
    this.dataListener?.(chunk);
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
