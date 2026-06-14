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
    child.out("⠇⠋"); // pure spinner -> empty after cleaning -> dropped
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
});
