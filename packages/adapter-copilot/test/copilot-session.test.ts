import { describe, expect, it } from "vitest";
import type { AgentEvent } from "@maestro/core";
import { CopilotSession } from "../src/copilot-session.js";
import { FakeChild } from "./fake-spawn.js";

async function collect(events: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const e of events) out.push(e);
  return out;
}

describe("CopilotSession", () => {
  it("streams stdout as output, then done on exit 0", async () => {
    const child = new FakeChild();
    const session = new CopilotSession(child);
    session.start();

    const events = collect(session.events);
    child.out("working on it\n");
    child.out("done editing files\n");
    child.close(0);

    // Each line's trailing newline is preserved on its output event so the
    // concatenated stream is faithful; summary() trims, so it is unchanged.
    expect(await events).toEqual([
      { kind: "output", text: "working on it\n" },
      { kind: "output", text: "done editing files\n" },
      { kind: "done", summary: "done editing files" },
    ]);
  });

  it("emits error on a non-zero exit", async () => {
    const child = new FakeChild();
    const session = new CopilotSession(child);
    session.start();
    const events = collect(session.events);
    child.out("partial\n");
    child.close(1);
    const result = await events;
    expect(result.at(-1)).toMatchObject({ kind: "error" });
    expect((result.at(-1) as { message: string }).message).toContain("code 1");
  });

  it("emits error when the process fails to spawn", async () => {
    const child = new FakeChild();
    const session = new CopilotSession(child);
    session.start();
    const events = collect(session.events);
    child.error(new Error("ENOENT"));
    const result = await events;
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ kind: "error" });
    expect((result[0] as { message: string }).message).toContain("ENOENT");
  });

  it("drops whitespace-only chunks (spinner frames)", async () => {
    const child = new FakeChild();
    const session = new CopilotSession(child);
    session.start();
    const events = collect(session.events);
    child.out("⠇⠋\n"); // pure spinner -> empty after cleaning -> dropped
    child.out("real output\n");
    child.close(0);
    const result = await events;
    expect(result.filter((e) => e.kind === "output")).toEqual([
      { kind: "output", text: "real output\n" },
    ]);
  });

  it("stop() kills the child and ends the stream without a terminal event", async () => {
    const child = new FakeChild();
    const session = new CopilotSession(child);
    session.start();
    const events = collect(session.events);
    child.out("starting\n");
    session.stop();
    expect(child.killed).toBe(true);
    const result = await events;
    expect(result).toEqual([{ kind: "output", text: "starting\n" }]);
  });

  it("swallows output emitted after stop()", async () => {
    const child = new FakeChild();
    const session = new CopilotSession(child);
    session.start();
    const events = collect(session.events);
    session.stop();
    child.out("late output\n"); // arrives after stop -> ignored
    expect(await events).toEqual([]);
  });

  it("ignores a stray error after a clean exit", async () => {
    const child = new FakeChild();
    const session = new CopilotSession(child);
    session.start();
    const events = collect(session.events);
    child.close(0);
    child.error(new Error("late")); // guarded by settled -> no second terminal event
    const result = await events;
    expect(result).toEqual([{ kind: "done", summary: "Copilot run completed" }]);
  });

  it("emits one output event per complete line in a multi-line chunk", async () => {
    const child = new FakeChild();
    const session = new CopilotSession(child);
    session.start();
    const events = collect(session.events);
    // A single raw chunk that carries two complete lines. Chunk boundaries are
    // not line boundaries, so each line must surface as its own event.
    child.out("first line\nsecond line\n");
    child.close(0);
    // Still one event per line; the newline that delimited them is kept on each.
    expect(await events).toEqual([
      { kind: "output", text: "first line\n" },
      { kind: "output", text: "second line\n" },
      { kind: "done", summary: "second line" },
    ]);
  });

  it("joins a line split across two chunks into one output event", async () => {
    const child = new FakeChild();
    const session = new CopilotSession(child);
    session.start();
    const events = collect(session.events);
    // The newline lands in the second chunk, so the line is only complete then.
    child.out("edited cac");
    child.out("he.ts\n");
    child.close(0);
    // Still a single joined event; the terminating newline is preserved.
    expect(await events).toEqual([
      { kind: "output", text: "edited cache.ts\n" },
      { kind: "done", summary: "edited cache.ts" },
    ]);
  });

  it("flushes a trailing line with no newline on close", async () => {
    const child = new FakeChild();
    const session = new CopilotSession(child);
    session.start();
    const events = collect(session.events);
    child.out("no trailing newline here");
    child.close(0);
    expect(await events).toEqual([
      { kind: "output", text: "no trailing newline here" },
      { kind: "done", summary: "no trailing newline here" },
    ]);
  });

  it("decodes Buffer chunks (not just strings)", async () => {
    const child = new FakeChild();
    const session = new CopilotSession(child);
    session.start();
    const events = collect(session.events);
    child.out(Buffer.from("from a buffer\n", "utf8"));
    child.close(0);
    expect(await events).toEqual([
      { kind: "output", text: "from a buffer\n" },
      { kind: "done", summary: "from a buffer" },
    ]);
  });

  // TG17: send() and respond() are v1 no-ops (called by Orchestrator.steer()
  // and Orchestrator.approve()). They must not throw and must do nothing
  // observable, since `copilot -p` is one-shot with no interactive channel.
  it("send() is a no-op that does not throw and emits nothing", async () => {
    const child = new FakeChild();
    const session = new CopilotSession(child);
    session.start();
    const events = collect(session.events);

    expect(() => session.send("please focus on the failing test")).not.toThrow();

    child.close(0);
    const result = await events;
    // No output came from send(); only the clean-exit done event is present.
    expect(result).toEqual([{ kind: "done", summary: "Copilot run completed" }]);
  });

  it("respond() is a no-op that does not throw and emits nothing", async () => {
    const child = new FakeChild();
    const session = new CopilotSession(child);
    session.start();
    const events = collect(session.events);

    expect(() => session.respond("approval-1", "allow")).not.toThrow();
    expect(() => session.respond("approval-2", "deny")).not.toThrow();

    child.close(0);
    const result = await events;
    expect(result).toEqual([{ kind: "done", summary: "Copilot run completed" }]);
  });

  it("preserves newlines so concatenated output reconstructs a multi-line delegate block", async () => {
    const child = new FakeChild();
    const session = new CopilotSession(child);
    session.start();
    const events = collect(session.events);
    // A complete, multi-line fenced delegate block as a real model would stream
    // it. The downstream orchestrator concatenates output-event texts with no
    // separator, so the emitted texts must carry their own line terminators or
    // the block flattens into one run-on line and the delegation parser (which
    // requires newlines) never matches.
    const block = "```delegate\nrole: writer\ntask: say hello world\n```";
    // Deliver the bytes the way a real stream does: split across multiple
    // chunks at arbitrary, mid-line boundaries.
    child.out("```dele");
    child.out("gate\nrole: wri");
    child.out("ter\ntask: say hel");
    child.out("lo world\n``");
    child.out("`");
    child.close(0);
    const result = await events;
    const reconstructed = result
      .filter((e) => e.kind === "output")
      .map((e) => (e as { text: string }).text)
      .join("");
    expect(reconstructed).toBe(block);
  });

  it("includes the stderr tail in the error message on a non-zero exit", async () => {
    const child = new FakeChild();
    const session = new CopilotSession(child);
    session.start();
    const events = collect(session.events);
    child.err("fatal: not a git repository\n");
    child.close(2);
    const result = await events;
    expect(result.at(-1)).toMatchObject({ kind: "error" });
    const message = (result.at(-1) as { message: string }).message;
    expect(message).toContain("code 2");
    expect(message).toContain("fatal: not a git repository");
  });

  it("bounds the stderr ring buffer to roughly the last 8 KB", async () => {
    const child = new FakeChild();
    const session = new CopilotSession(child);
    session.start();
    const events = collect(session.events);
    const filler = "x".repeat(9000); // exceeds the 8 KB cap
    const tail = "REAL_TAIL_MARKER";
    child.err(filler + tail);
    child.close(1);
    const message = ((await events).at(-1) as { message: string }).message;
    expect(message).toContain(tail);
    // The early filler must have been dropped to keep the buffer bounded.
    expect(message.length).toBeLessThan(9000);
  });
});
