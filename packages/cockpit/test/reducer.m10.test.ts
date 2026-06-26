import { describe, expect, it } from "vitest";
import type { Agent, OrchestratorEvent } from "@hallucinate/core";
import { initialModel, reduce, OUTPUT_CAP } from "../src/reducer.js";

function agent(over: Partial<Agent> = {}): Agent {
  const { task, ...rest } = over;
  return {
    id: "a1",
    task: { id: "t1", description: "do it", roleName: "Implementer", ...task },
    role: { name: "Implementer", instructions: "", engine: { id: "copilot" }, autonomy: "auto-approve-safe" },
    state: "preparing",
    log: [],
    ...rest,
  };
}
const added = (a: Agent): OrchestratorEvent => ({ kind: "agent-added", agent: a });
const out = (id: string, text: string): OrchestratorEvent => ({ kind: "agent-event", agentId: id, event: { kind: "output", text } });

describe("reducer M10: CardVM.tail (live activity preview)", () => {
  it("tail is the last 3 non-empty lines of output", () => {
    let m = reduce(initialModel(), added(agent()));
    m = reduce(m, out("a1", "a\nb\nc\nd\ne"));
    expect(m.cards.get("a1")!.tail).toEqual(["c", "d", "e"]);
  });

  it("drops empty and whitespace-only lines", () => {
    let m = reduce(initialModel(), added(agent()));
    m = reduce(m, out("a1", "a\n\n   \nb"));
    expect(m.cards.get("a1")!.tail).toEqual(["a", "b"]);
  });

  it("strips CRLF carriage returns from tail lines", () => {
    let m = reduce(initialModel(), added(agent()));
    m = reduce(m, out("a1", "a\r\nb\r\nc\r\n"));
    expect(m.cards.get("a1")!.tail).toEqual(["a", "b", "c"]);
  });

  it("returns at most 3 lines from a 50-line output", () => {
    let m = reduce(initialModel(), added(agent()));
    const lines = Array.from({ length: 50 }, (_, i) => `line${i}`);
    m = reduce(m, out("a1", lines.join("\n")));
    const tail = m.cards.get("a1")!.tail!;
    expect(tail.length).toBe(3);
    expect(tail).toEqual(["line47", "line48", "line49"]);
  });

  it("updates incrementally as agent-event output events append", () => {
    let m = reduce(initialModel(), added(agent()));
    m = reduce(m, out("a1", "a\nb\nc\n"));
    expect(m.cards.get("a1")!.tail).toEqual(["a", "b", "c"]);
    m = reduce(m, out("a1", "d\ne\n"));
    expect(m.cards.get("a1")!.tail).toEqual(["c", "d", "e"]);
  });

  it("empty output yields an empty tail", () => {
    const m = reduce(initialModel(), added(agent()));
    expect(m.cards.get("a1")!.output).toBe("");
    expect(m.cards.get("a1")!.tail).toEqual([]);
  });

  it("stays consistent with OUTPUT_CAP: tail reflects the last lines of the capped output", () => {
    let m = reduce(initialModel(), added(agent()));
    // Build output longer than the cap; the final lines carry known markers.
    const padded = "x".repeat(OUTPUT_CAP + 5000) + "\npenultimate\nlast";
    m = reduce(m, out("a1", padded));
    const c = m.cards.get("a1")!;
    expect(c.output.length).toBe(OUTPUT_CAP);
    const tail = c.tail!;
    expect(tail.length).toBeLessThanOrEqual(3);
    // The most recent lines survive the cap and surface in the tail.
    expect(tail[tail.length - 1]).toBe("last");
    expect(tail[tail.length - 2]).toBe("penultimate");
  });
});
