import { describe, expect, it } from "vitest";
import type { AgentEvent } from "@maestro/core";
import { CopilotSession } from "../src/copilot-session.js";
import { FakeChild } from "./fake-spawn.js";

async function collect(events: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const e of events) out.push(e);
  return out;
}

function outputs(events: AgentEvent[]): string[] {
  return events.filter((e) => e.kind === "output").map((e) => (e as { text: string }).text);
}

describe("CopilotSession (json mode)", () => {
  it("maps assistant/text JSON lines to plain output text", async () => {
    const child = new FakeChild();
    const session = new CopilotSession(child, { outputFormat: "json" });
    session.start();
    const events = collect(session.events);

    child.out(JSON.stringify({ type: "assistant", text: "thinking about the cache" }) + "\n");
    child.out(JSON.stringify({ type: "text", text: "here is the plan" }) + "\n");
    child.close(0);

    const result = await events;
    expect(outputs(result)).toEqual(["thinking about the cache", "here is the plan"]);
    expect(result.at(-1)).toEqual({ kind: "done", summary: "here is the plan" });
  });

  it("formats a tool JSON line so the tool name and target are visible", async () => {
    const child = new FakeChild();
    const session = new CopilotSession(child, { outputFormat: "json" });
    session.start();
    const events = collect(session.events);

    child.out(JSON.stringify({ type: "tool", name: "edit", input: { path: "src/cache.ts" } }) + "\n");
    child.out(
      JSON.stringify({ type: "tool_call", name: "shell", input: { command: "npm test" } }) + "\n",
    );
    child.close(0);

    const lines = outputs(await events);
    expect(lines).toEqual(["▸ edit: src/cache.ts", "▸ shell: npm test"]);
    // The tool name is plainly readable in the rendered output.
    expect(lines[0]).toContain("edit");
    expect(lines[1]).toContain("shell");
  });

  it("falls back to the raw cleaned line for a non-JSON line without throwing", async () => {
    const child = new FakeChild();
    const session = new CopilotSession(child, { outputFormat: "json" });
    session.start();
    const events = collect(session.events);

    // A line that is not valid JSON at all (e.g. an interleaved human-readable log).
    child.out("not json, just a plain log line\n");
    child.close(0);

    const result = await events;
    // Raw fallback: the unparseable line is emitted as-is, keeping its newline.
    expect(outputs(result)).toEqual(["not json, just a plain log line\n"]);
    // The stream still completes cleanly.
    expect(result.at(-1)).toMatchObject({ kind: "done" });
  });

  it("falls back to the raw line for an unrecognized JSON shape, never dropping the stream", async () => {
    const child = new FakeChild();
    const session = new CopilotSession(child, { outputFormat: "json" });
    session.start();
    const events = collect(session.events);

    // Valid JSON, but a shape this adapter does not model (no known type/text).
    const weird = JSON.stringify({ kind: "telemetry", phase: "warmup", n: 3 });
    child.out(weird + "\n");
    // A bare JSON value (not even an object) must also degrade gracefully.
    child.out("42\n");
    child.close(0);

    const result = await events;
    // Raw fallback returns the cleaned line verbatim, including its newline.
    expect(outputs(result)).toEqual([weird + "\n", "42\n"]);
    expect(result.at(-1)).toMatchObject({ kind: "done" });
  });

  it("tolerates a malformed line mid-stream and keeps parsing the rest", async () => {
    const child = new FakeChild();
    const session = new CopilotSession(child, { outputFormat: "json" });
    session.start();
    const events = collect(session.events);

    child.out(JSON.stringify({ type: "assistant", text: "before" }) + "\n");
    child.out('{"type":"assistant","text": broken\n'); // truncated / invalid JSON
    child.out(JSON.stringify({ type: "assistant", text: "after" }) + "\n");
    child.close(0);

    const lines = outputs(await events);
    // Parsed assistant lines yield just their text; the malformed middle line
    // degrades to its raw cleaned text, which keeps its trailing newline.
    expect(lines[0]).toBe("before");
    expect(lines[1]).toBe('{"type":"assistant","text": broken\n'); // raw fallback
    expect(lines[2]).toBe("after");
  });

  it("never throws and propagates a non-zero exit error in json mode", async () => {
    const child = new FakeChild();
    const session = new CopilotSession(child, { outputFormat: "json" });
    session.start();
    const events = collect(session.events);

    child.out("garbage line\n");
    child.close(1);

    const result = await events;
    expect(result.at(-1)).toMatchObject({ kind: "error" });
  });
});
