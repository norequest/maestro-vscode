import { describe, expect, it } from "vitest";
import { EventQueue } from "../src/event-queue.js";
import type { AgentEvent } from "../src/types.js";

async function drain(q: EventQueue): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const e of q) out.push(e);
  return out;
}

describe("EventQueue", () => {
  it("yields buffered events pushed before consumption, then ends", async () => {
    const q = new EventQueue();
    q.push({ kind: "output", text: "a" });
    q.push({ kind: "output", text: "b" });
    q.end();
    expect(await drain(q)).toEqual([
      { kind: "output", text: "a" },
      { kind: "output", text: "b" },
    ]);
  });

  it("delivers events pushed after the consumer is already waiting", async () => {
    const q = new EventQueue();
    const collected = drain(q);
    q.push({ kind: "output", text: "late" });
    q.end();
    expect(await collected).toEqual([{ kind: "output", text: "late" }]);
  });

  it("ignores pushes after end", async () => {
    const q = new EventQueue();
    q.push({ kind: "output", text: "kept" });
    q.end();
    q.push({ kind: "output", text: "dropped" });
    expect(await drain(q)).toEqual([{ kind: "output", text: "kept" }]);
  });
});
