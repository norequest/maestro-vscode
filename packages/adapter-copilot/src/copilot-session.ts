import type { AgentEvent, AgentSession, ApprovalDecision } from "@maestro/core";
import { EventQueue } from "@maestro/core";
import { cleanOutput, type OutputFormat } from "./args.js";
import { FleetLineParser } from "./fleet-json.js";
import { renderJsonLine } from "./json-output.js";
import type { ChildHandle } from "./types.js";

/** Keep at most the last ~8 KB of stderr so a failing run yields a diagnostic
 *  tail without letting an unbounded child flood memory. */
const STDERR_RING_BYTES = 8 * 1024;

export interface CopilotSessionOptions {
  /** Wire format Copilot streams on stdout. Defaults to `"text"` (v1 behavior).
   *  In `"json"` mode each complete line is parsed as JSON and mapped to a
   *  structured output event, with a tolerant fallback to the raw line. */
  outputFormat?: OutputFormat;
}

export class CopilotSession implements AgentSession {
  private readonly queue = new EventQueue();
  private readonly outputFormat: OutputFormat;
  /** The last non-empty COMPLETE line seen across the whole run (not just the
   *  last chunk), so summary() is correct regardless of chunk boundaries. */
  private lastText = "";
  /** Partial trailing line not yet terminated by a newline. */
  private stdoutTail = "";
  /** Bounded tail of stderr for diagnostics on a non-zero exit. */
  private stderrTail = "";
  private settled = false;
  /** In fleet mode, set once the parser emits a terminal event (done/error) from
   *  a `result` line, so the `close` handler ends the queue without doubling it. */
  private terminalEmitted = false;
  /** In fleet mode, ONE stateful parser for the whole session: it tracks which
   *  toolCallIds belong to sub-agents so later output is attributed correctly
   *  (the conductor's own narration stays top-level). */
  private readonly fleetParser = new FleetLineParser();

  constructor(
    private readonly child: ChildHandle,
    opts: CopilotSessionOptions = {},
  ) {
    this.outputFormat = opts.outputFormat ?? "text";
  }

  get events(): AsyncIterable<AgentEvent> {
    return this.queue;
  }

  /** Begin consuming the child's streams. Call once, right after construction. */
  start(): void {
    this.child.stdout.on("data", (chunk) => {
      if (this.settled) return; // ignore late output after done/error/stop
      this.consumeStdout(this.decode(chunk));
    });
    // stderr is piped; read it so the pipe never back-pressures the child and so
    // a failing copilot can report a diagnostic, not just an exit code.
    this.child.stderr.on("data", (chunk) => {
      this.appendStderr(this.decode(chunk));
    });
    this.child.on("error", (err) => this.fail(`Failed to run copilot: ${err.message}`));
    this.child.on("close", (code) => {
      if (this.settled) return;
      this.settled = true;
      this.flushStdoutTail();
      // In fleet mode the parser may already have emitted the terminal event from
      // a `result` line; if so, just end the queue (no doubled done/error).
      if (this.terminalEmitted) {
        this.queue.end();
        return;
      }
      if (code === 0) {
        this.queue.push({ kind: "done", summary: this.summary() });
      } else {
        const tail = this.stderrTail.trim();
        const suffix = tail ? `: ${tail}` : "";
        this.queue.push({
          kind: "error",
          message: `copilot exited with code ${code ?? "unknown"}${suffix}`,
        });
      }
      this.queue.end();
    });
  }

  private decode(chunk: Buffer | string): string {
    return Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
  }

  /** Split accumulated stdout on newlines, emitting one output event per
   *  complete line and retaining the partial remainder. The trailing "\n" is
   *  kept on each emitted line so that concatenating the output-event texts
   *  faithfully reconstructs the original stream, including its line breaks.
   *  Downstream consumers (the orchestrator's run-on buffer, the delegate-block
   *  parser) depend on those newlines surviving. */
  private consumeStdout(text: string): void {
    this.stdoutTail += text;
    let nl = this.stdoutTail.indexOf("\n");
    while (nl !== -1) {
      const rawLine = this.stdoutTail.slice(0, nl + 1); // include the "\n"
      this.stdoutTail = this.stdoutTail.slice(nl + 1);
      this.emitLine(rawLine);
      nl = this.stdoutTail.indexOf("\n");
    }
  }

  /** Emit the partial trailing line, if any, when the stream ends. */
  private flushStdoutTail(): void {
    if (this.stdoutTail.length > 0) {
      const remainder = this.stdoutTail;
      this.stdoutTail = "";
      this.emitLine(remainder);
    }
  }

  private emitLine(rawLine: string): void {
    const cleaned = cleanOutput(rawLine);
    if (cleaned.trim().length === 0) return; // skip spinner-only / blank lines
    // Fleet mode: route the line through the fleet JSON parser, which maps it to
    // zero-or-one event (sub-agent lifecycle, output, or a terminal done/error
    // from a `result` line). An unparseable / unmodeled line degrades to a raw
    // output event, so the stream is never dropped and this never throws.
    if (this.outputFormat === "fleet") {
      this.emitFleetLine(cleaned);
      return;
    }
    // In json mode, parse the line into a structured event; an invalid or
    // unrecognized line degrades to the raw cleaned text (never throws, never
    // drops the stream). In text mode this is exactly the v1 behavior.
    const text = this.outputFormat === "json" ? renderJsonLine(cleaned) : cleaned;
    this.lastText = text;
    this.queue.push({ kind: "output", text });
  }

  /** Map one cleaned fleet line to an event and enqueue it. A `result` line
   *  produces the terminal done/error here; the `close` handler then only ends
   *  the queue (see {@link terminalEmitted}). */
  private emitFleetLine(cleaned: string): void {
    const event = this.fleetParser.parse(cleaned);
    if (!event) return; // ignored frame (background-task churn, tool lifecycle)
    if (event.kind === "output" || event.kind === "subagent-output") {
      this.lastText = event.text;
    }
    if (event.kind === "done" || event.kind === "error") {
      this.terminalEmitted = true;
    }
    this.queue.push(event);
  }

  private appendStderr(text: string): void {
    this.stderrTail += text;
    if (this.stderrTail.length > STDERR_RING_BYTES) {
      this.stderrTail = this.stderrTail.slice(-STDERR_RING_BYTES);
    }
  }

  private summary(): string {
    const tail = this.lastText.trim().split("\n").filter(Boolean).pop();
    return tail && tail.length > 0 ? tail.slice(0, 200) : "Copilot run completed";
  }

  private fail(message: string): void {
    if (this.settled) return;
    this.settled = true;
    this.queue.push({ kind: "error", message });
    this.queue.end();
  }

  send(_input: string): void {
    /* v1: `copilot -p` is one-shot; mid-run steering awaits the ACP upgrade. */
  }

  respond(_approvalId: string, _decision: ApprovalDecision): void {
    /* v1: no interactive approvals (the agent runs --allow-all in its worktree). */
  }

  stop(): void {
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
