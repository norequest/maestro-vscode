import { spawn as nodeSpawn } from "node:child_process";
import { AsyncMessageQueue } from "./async-queue.js";
import { parseAcpLine } from "./messages.js";
import type { AcpMessage, AcpTransport, AcpTransportFn } from "./types.js";

/** Minimal handle over a spawned child. Node's ChildProcess satisfies this. */
export interface AcpChildHandle {
  readonly stdout: {
    on(event: "data", listener: (chunk: Buffer | string) => void): void;
  };
  readonly stdin: {
    write(data: string): void;
  };
  on(event: "close", listener: (code: number | null) => void): void;
  on(event: "error", listener: (err: Error) => void): void;
  kill(signal?: NodeJS.Signals): void;
}

/** Wraps a real child process, parsing its stdout as NDJSON ACP messages. */
export class ProcessAcpTransport implements AcpTransport {
  private readonly queue = new AsyncMessageQueue<AcpMessage>();
  private settled = false;
  private buffer = "";

  constructor(private readonly child: AcpChildHandle) {
    child.stdout.on("data", (chunk) => {
      if (this.settled) return;
      this.buffer += chunk.toString();
      const lines = this.buffer.split("\n");
      // The last element may be an incomplete line; keep it buffered.
      this.buffer = lines.pop() ?? "";
      for (const line of lines) {
        const msg = parseAcpLine(line);
        if (msg !== null) this.queue.push(msg);
      }
    });
    child.on("error", (err) => {
      if (this.settled) return;
      this.settled = true;
      this.queue.push({ jsonrpc: "2.0", method: "error", params: { message: err.message } });
      this.queue.end();
    });
    child.on("close", (code) => {
      if (this.settled) return;
      this.settled = true;
      if (code !== 0) {
        this.queue.push({
          jsonrpc: "2.0",
          method: "error",
          params: { message: `acp process exited with code ${code ?? "unknown"}` },
        });
      }
      this.queue.end();
    });
  }

  get messages(): AsyncIterable<AcpMessage> {
    return this.queue;
  }

  send(msg: AcpMessage): void {
    if (this.settled) return;
    this.child.stdin.write(JSON.stringify(msg) + "\n");
  }

  terminate(): void {
    if (this.settled) return;
    this.settled = true;
    try {
      this.child.kill("SIGTERM");
    } catch {
      /* already exited */
    }
    this.queue.end();
  }
}

/** Default transport factory: spawns a real subprocess with piped stdio. */
export const defaultAcpTransportFn: AcpTransportFn = (command, args, options) => {
  const child = nodeSpawn(command, [...args], {
    cwd: options.cwd,
    env: options.env,
    stdio: ["pipe", "pipe", "pipe"],
  }) as unknown as AcpChildHandle;
  return new ProcessAcpTransport(child);
};
