import { spawn as nodeSpawn } from "node:child_process";
import { AsyncMessageQueue } from "./async-queue.js";
import { parseAcpLine } from "./messages.js";
import type { AcpMessage, AcpTransport, AcpTransportFn } from "./types.js";

/** Keep at most the last ~8 KB of stderr so a failing run yields a diagnostic
 *  tail without letting a chatty child flood memory. Mirrors the copilot adapter. */
const STDERR_RING_BYTES = 8 * 1024;

/** Grace period after SIGTERM before escalating to SIGKILL. Exported so the
 *  escalation is testable with fake timers without duplicating the magic number. */
export const ACP_KILL_GRACE_MS = 2000;

/** Minimal handle over a spawned child. Node's ChildProcess satisfies this. */
export interface AcpChildHandle {
  readonly stdout: {
    on(event: "data", listener: (chunk: Buffer | string) => void): void;
  };
  /**
   * The child's stderr. Optional only so pre-existing fakes that never produce
   * stderr keep compiling; a real piped child always has it, and when present it
   * MUST be drained or the OS pipe buffer fills and the child deadlocks.
   */
  readonly stderr?: {
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
  /** Bounded tail of stderr, surfaced on the exit/error path for diagnostics. */
  private stderrTail = "";
  /** Set the moment the child emits close/error, independent of `settled`, so a
   *  pending SIGKILL escalation can be cancelled even after terminate(). */
  private childExited = false;
  private killTimer?: ReturnType<typeof setTimeout>;

  constructor(private readonly child: AcpChildHandle) {
    child.stdout.on("data", (chunk) => {
      if (this.settled) return;
      this.buffer += chunk.toString();
      // Split on LF or CRLF so CRLF endings do not leave a stray carriage return.
      const lines = this.buffer.split(/\r?\n/);
      // The last element may be an incomplete line; keep it buffered.
      this.buffer = lines.pop() ?? "";
      for (const line of lines) {
        const msg = parseAcpLine(line);
        if (msg !== null) this.queue.push(msg);
      }
    });
    // Drain stderr into a bounded ring. Without this a chatty engine fills the
    // ~64 KB OS pipe buffer, blocks on its next write, stops emitting stdout, and
    // the transport's 'close' never fires (a stuck `working` card forever).
    child.stderr?.on("data", (chunk) => this.appendStderr(chunk.toString()));
    child.on("error", (err) => {
      this.childExited = true;
      this.clearKillTimer();
      if (this.settled) return;
      this.settled = true;
      this.flushBuffer();
      this.queue.push({
        jsonrpc: "2.0",
        method: "error",
        params: { message: this.withStderr(err.message) },
      });
      this.queue.end();
    });
    child.on("close", (code) => {
      this.childExited = true;
      this.clearKillTimer();
      if (this.settled) return;
      this.settled = true;
      this.flushBuffer();
      if (code !== 0) {
        this.queue.push({
          jsonrpc: "2.0",
          method: "error",
          params: {
            message: this.withStderr(`acp process exited with code ${code ?? "unknown"}`),
          },
        });
      }
      this.queue.end();
    });
  }

  private appendStderr(text: string): void {
    this.stderrTail += text;
    if (this.stderrTail.length > STDERR_RING_BYTES) {
      this.stderrTail = this.stderrTail.slice(-STDERR_RING_BYTES);
    }
  }

  /** Append the captured stderr tail (if any) to a base error message. */
  private withStderr(message: string): string {
    const tail = this.stderrTail.trim();
    return tail ? `${message}: ${tail}` : message;
  }

  private clearKillTimer(): void {
    if (this.killTimer !== undefined) {
      clearTimeout(this.killTimer);
      this.killTimer = undefined;
    }
  }

  /**
   * Flush any residual buffered text. An ACP child can write its final frame
   * (e.g. turn/complete) without a trailing newline and then exit; without this
   * the terminal frame is lost and a successful run is reported as a failure.
   */
  private flushBuffer(): void {
    const residual = this.buffer;
    this.buffer = "";
    if (residual.trim().length === 0) return;
    const msg = parseAcpLine(residual);
    if (msg !== null) this.queue.push(msg);
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
    this.killWithEscalation();
    this.queue.end();
  }

  /**
   * Send SIGTERM, then arm a grace timer; if the child has not emitted
   * close/error by then it is ignoring SIGTERM (and still mutating the worktree),
   * so escalate to SIGKILL. The timer is cleared the moment the child exits.
   */
  private killWithEscalation(): void {
    try {
      this.child.kill("SIGTERM");
    } catch {
      return; // already exited
    }
    if (this.childExited) return;
    this.killTimer = setTimeout(() => {
      this.killTimer = undefined;
      if (this.childExited) return;
      try {
        this.child.kill("SIGKILL");
      } catch {
        /* exited in the grace window */
      }
    }, ACP_KILL_GRACE_MS);
    // Do not let a pending escalation keep the event loop alive.
    (this.killTimer as { unref?: () => void }).unref?.();
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
