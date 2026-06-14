import { describe, expect, it } from "vitest";
import type { Agent, OrchestratorEvent } from "@maestro/core";
import { initialModel, reduce, setFocus } from "../src/reducer.js";

function agent(over: Partial<Agent> = {}): Agent {
  return {
    id: "a1",
    task: { id: "t1", description: "do it", roleName: "Implementer" },
    role: { name: "Implementer", instructions: "", engine: { id: "copilot" }, autonomy: "auto-approve-safe" },
    state: "preparing",
    log: [],
    ...over,
  };
}
const added = (a: Agent): OrchestratorEvent => ({ kind: "agent-added", agent: a });
const updated = (a: Agent): OrchestratorEvent => ({ kind: "agent-updated", agent: a });
const out = (id: string, text: string): OrchestratorEvent => ({ kind: "agent-event", agentId: id, event: { kind: "output", text } });

describe("reduce", () => {
  it("agent-added creates a card", () => {
    const m = reduce(initialModel(), added(agent()));
    const c = m.cards.get("a1")!;
    expect(c.roleName).toBe("Implementer");
    expect(c.engineId).toBe("copilot");
    expect(c.state).toBe("preparing");
    expect(c.attention).toBe(false);
    expect(c.output).toBe("");
  });

  it("accumulates output across agent-event(output)", () => {
    let m = reduce(initialModel(), added(agent()));
    m = reduce(m, out("a1", "hello "));
    m = reduce(m, out("a1", "world"));
    expect(m.cards.get("a1")!.output).toBe("hello world");
  });

  it("agent-updated re-derives state but preserves accumulated output", () => {
    let m = reduce(initialModel(), added(agent()));
    m = reduce(m, out("a1", "log line\n"));
    m = reduce(m, updated(agent({ state: "working" })));
    const c = m.cards.get("a1")!;
    expect(c.state).toBe("working");
    expect(c.output).toBe("log line\n");
  });

  it("marks attention on done/error/conflict/awaiting-approval and captures their fields", () => {
    let m = reduce(initialModel(), added(agent()));
    m = reduce(m, updated(agent({ state: "done", summary: "all done", diff: { files: ["a.ts"], patch: "P" } })));
    const c = m.cards.get("a1")!;
    expect(c.attention).toBe(true);
    expect(c.summary).toBe("all done");
    expect(c.diff).toEqual({ files: ["a.ts"], patch: "P" });
  });

  it("captures conflict files and error tail", () => {
    let m = reduce(initialModel(), added(agent()));
    m = reduce(m, updated(agent({ state: "conflict", conflict: { files: ["x.ts"] } })));
    expect(m.cards.get("a1")!.conflictFiles).toEqual(["x.ts"]);
    m = reduce(m, updated(agent({ state: "error", error: "boom" })));
    expect(m.cards.get("a1")!.error).toBe("boom");
  });

  it("caps output to the last 16000 chars, keeping the TAIL not the head (TG16)", () => {
    let m = reduce(initialModel(), added(agent()));
    // Build output longer than the cap whose final chars are a known marker.
    // The cap must preserve the most recent chars (slice from the end), so the
    // card output must END WITH the marker, proving slice(len - CAP) not slice(0, CAP).
    const marker = "TAILMARKER";
    const padded = "x".repeat(20000) + marker;
    m = reduce(m, out("a1", padded));
    const output = m.cards.get("a1")!.output;
    expect(output.length).toBe(16000);
    expect(output.endsWith(marker)).toBe(true);
    // The head must be dropped: the very first 'x' chars are gone (only the tail survives).
    expect(output).toBe(padded.slice(padded.length - 16000));
  });

  it("ignores output for an unknown agent", () => {
    const m = reduce(initialModel(), out("ghost", "nope"));
    expect(m.cards.size).toBe(0);
  });

  it("setFocus records the focused id immutably", () => {
    const m0 = reduce(initialModel(), added(agent()));
    const m1 = setFocus(m0, "a1");
    expect(m1.focusedId).toBe("a1");
    expect(m0.focusedId).toBeUndefined();
  });
});
