import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Agent, OrchestratorEvent } from "@hallucinate/core";
import { initialModel, reduce, OUTPUT_CAP, HISTORY_CAP } from "../src/reducer.js";

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
const updated = (a: Agent): OrchestratorEvent => ({ kind: "agent-updated", agent: a });
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

describe("reducer M10: CardVM.needsYouSince (attention-queue ordering clock)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("is set to the current time when a card first enters an attention state", () => {
    vi.setSystemTime(1_000);
    let m = reduce(initialModel(), added(agent({ state: "working" })));
    // A plain working card is not waiting on anyone.
    expect(m.cards.get("a1")!.needsYouSince).toBeUndefined();

    vi.setSystemTime(5_000);
    m = reduce(m, updated(agent({ state: "awaiting-approval" })));
    expect(m.cards.get("a1")!.needsYouSince).toBe(5_000);
  });

  it("preserves the original needsYouSince across a later update while still in attention", () => {
    vi.setSystemTime(5_000);
    let m = reduce(initialModel(), added(agent({ state: "awaiting-approval" })));
    expect(m.cards.get("a1")!.needsYouSince).toBe(5_000);

    // Clock advances and the card moves to a DIFFERENT attention state; the
    // original "waiting since" timestamp must not be reset.
    vi.setSystemTime(9_000);
    m = reduce(m, updated(agent({ state: "conflict" })));
    expect(m.cards.get("a1")!.needsYouSince).toBe(5_000);
  });

  it("clears needsYouSince when the card leaves attention", () => {
    vi.setSystemTime(5_000);
    let m = reduce(initialModel(), added(agent({ state: "awaiting-approval" })));
    expect(m.cards.get("a1")!.needsYouSince).toBe(5_000);

    vi.setSystemTime(9_000);
    m = reduce(m, updated(agent({ state: "working" })));
    expect(m.cards.get("a1")!.needsYouSince).toBeUndefined();
  });
});

// Build a Diff whose diffStat is exactly { adds, dels }: `adds` "+x" lines and
// `dels` "-y" lines, none of which look like the "+++"/"---" file headers
// diffStatFromPatch excludes.
function diff(adds: number, dels: number) {
  const patch = [...Array(adds)].map(() => "+x").join("\n") + "\n" + [...Array(dels)].map(() => "-y").join("\n");
  return { patch, files: ["f.ts"] };
}

describe("reducer M10: CardVM.momentum (diff growth pulse)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("is undefined for a freshly added agent with no diff", () => {
    const m = reduce(initialModel(), added(agent({ state: "working" })));
    expect(m.cards.get("a1")!.momentum).toBeUndefined();
  });

  it("sets momentum to the full diffStat when the first diff appears", () => {
    vi.setSystemTime(1_000);
    let m = reduce(initialModel(), added(agent({ state: "working" })));
    vi.setSystemTime(2_000);
    m = reduce(m, updated(agent({ state: "working", diff: diff(10, 0) })));
    expect(m.cards.get("a1")!.momentum).toEqual({ adds: 10, dels: 0, at: 2_000 });
  });

  it("sets momentum to the growth delta when the diff grows", () => {
    vi.setSystemTime(1_000);
    let m = reduce(initialModel(), added(agent({ state: "working" })));
    m = reduce(m, updated(agent({ state: "working", diff: diff(10, 0) })));
    vi.setSystemTime(3_000);
    m = reduce(m, updated(agent({ state: "working", diff: diff(25, 3) })));
    expect(m.cards.get("a1")!.momentum).toEqual({ adds: 15, dels: 3, at: 3_000 });
  });

  it("clears momentum when the diff is unchanged across an update", () => {
    vi.setSystemTime(1_000);
    let m = reduce(initialModel(), added(agent({ state: "working" })));
    m = reduce(m, updated(agent({ state: "working", diff: diff(25, 3) })));
    vi.setSystemTime(4_000);
    m = reduce(m, updated(agent({ state: "working", diff: diff(25, 3) })));
    expect(m.cards.get("a1")!.momentum).toBeUndefined();
  });

  it("clamps a growth-only-in-deletions update to adds 0", () => {
    vi.setSystemTime(1_000);
    let m = reduce(initialModel(), added(agent({ state: "working" })));
    m = reduce(m, updated(agent({ state: "working", diff: diff(10, 0) })));
    vi.setSystemTime(5_000);
    m = reduce(m, updated(agent({ state: "working", diff: diff(10, 4) })));
    const momentum = m.cards.get("a1")!.momentum!;
    expect(momentum.adds).toBe(0);
    expect(momentum.dels).toBe(4);
  });

  it("clears momentum when the diff shrinks", () => {
    vi.setSystemTime(1_000);
    let m = reduce(initialModel(), added(agent({ state: "working" })));
    m = reduce(m, updated(agent({ state: "working", diff: diff(25, 3) })));
    vi.setSystemTime(6_000);
    m = reduce(m, updated(agent({ state: "working", diff: diff(10, 0) })));
    expect(m.cards.get("a1")!.momentum).toBeUndefined();
  });

  it("preserves momentum across an output tick (agent-event does not recompute)", () => {
    vi.setSystemTime(1_000);
    let m = reduce(initialModel(), added(agent({ state: "working" })));
    vi.setSystemTime(2_000);
    m = reduce(m, updated(agent({ state: "working", diff: diff(10, 0) })));
    expect(m.cards.get("a1")!.momentum).toEqual({ adds: 10, dels: 0, at: 2_000 });

    // An output tick advances the clock but must not recompute momentum.
    vi.setSystemTime(9_000);
    m = reduce(m, out("a1", "still streaming\n"));
    expect(m.cards.get("a1")!.momentum).toEqual({ adds: 10, dels: 0, at: 2_000 });
  });

  it("stamps `at` with Date.now() at the growth moment", () => {
    vi.setSystemTime(1_000);
    let m = reduce(initialModel(), added(agent({ state: "working" })));
    m = reduce(m, updated(agent({ state: "working", diff: diff(10, 0) })));
    vi.setSystemTime(7_777);
    m = reduce(m, updated(agent({ state: "working", diff: diff(12, 0) })));
    expect(m.cards.get("a1")!.momentum!.at).toBe(7_777);
  });
});

// Delegation events for the history ring. The proposal shape matches the core
// DelegationProposal; the lead's task text is irrelevant to the recorded label.
const proposed = (p: { id: string; leadAgentId: string; roleName: string; task: string }): OrchestratorEvent => ({
  kind: "delegation-proposed",
  proposal: { ...p, state: "pending" },
});
const resolved = (p: { id: string; leadAgentId: string; roleName: string; task: string }): OrchestratorEvent => ({
  kind: "delegation-resolved",
  proposal: { ...p, state: "approved" },
});

describe("reducer M10 Phase F: in-session history ring", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("records exactly one entry for agent-added (kind, role, id, label, seq 1)", () => {
    vi.setSystemTime(1_234);
    const m = reduce(initialModel(), added(agent({ state: "working" })));
    expect(m.history).toHaveLength(1);
    const e = m.history[0]!;
    expect(e.kind).toBe("agent-added");
    expect(e.roleName).toBe("Implementer");
    expect(e.agentId).toBe("a1");
    expect(e.label.length).toBeGreaterThan(0);
    expect(e.seq).toBe(1);
    expect(e.at).toBe(1_234);
  });

  it("records NO entry for an agent-event output tick", () => {
    let m = reduce(initialModel(), added(agent({ state: "working" })));
    const before = m.history.length;
    m = reduce(m, out("a1", "still streaming\n"));
    expect(m.history.length).toBe(before);
  });

  it("records a real state transition but ignores a no-op same-state update", () => {
    let m = reduce(initialModel(), added(agent({ state: "working" })));
    const afterAdd = m.history.length;
    m = reduce(m, updated(agent({ state: "awaiting-approval" })));
    expect(m.history.length).toBe(afterAdd + 1);
    expect(m.history[m.history.length - 1]!.kind).toBe("agent-updated");
    // A second update to the SAME state records nothing (ring is transitions, not spam).
    m = reduce(m, updated(agent({ state: "awaiting-approval" })));
    expect(m.history.length).toBe(afterAdd + 1);
  });

  it("bounds the ring at HISTORY_CAP, dropping oldest while seq stays monotonic", () => {
    vi.setSystemTime(1_000);
    let m = reduce(initialModel(), added(agent({ state: "working" })));
    const total = HISTORY_CAP + 5;
    // total - 1 more recordable updates, alternating state so each is a real transition.
    for (let i = 1; i < total; i++) {
      const state = i % 2 === 1 ? "preparing" : "working";
      m = reduce(m, updated(agent({ state })));
    }
    expect(m.history.length).toBe(HISTORY_CAP);
    // seq keeps climbing past the cap; it is not reset by the drop.
    expect(m.history[m.history.length - 1]!.seq).toBe(total);
    // The oldest entries fell off: the surviving first seq is total - HISTORY_CAP + 1.
    expect(m.history[0]!.seq).toBe(total - HISTORY_CAP + 1);
  });

  it("never mutates the prior history array (a new array reference per record)", () => {
    let m = reduce(initialModel(), added(agent({ state: "working" })));
    const prevRef = m.history;
    const prevCopy = [...m.history];
    m = reduce(m, updated(agent({ state: "awaiting-approval" })));
    // The OLD array is untouched (same length and contents).
    expect(prevRef.length).toBe(prevCopy.length);
    expect(prevRef).toEqual(prevCopy);
    // The new model holds a DIFFERENT array.
    expect(m.history).not.toBe(prevRef);
  });

  it("records delegation-proposed and delegation-resolved with the right kind/label", () => {
    let m = reduce(initialModel(), added(agent({ id: "lead", state: "working" })));
    m = reduce(m, proposed({ id: "d1", leadAgentId: "lead", roleName: "Reviewer", task: "review it" }));
    const propEntry = m.history[m.history.length - 1]!;
    expect(propEntry.kind).toBe("delegation-proposed");
    expect(propEntry.label).toContain("Reviewer");

    m = reduce(m, resolved({ id: "d1", leadAgentId: "lead", roleName: "Reviewer", task: "review it" }));
    const resEntry = m.history[m.history.length - 1]!;
    expect(resEntry.kind).toBe("delegation-resolved");
    expect(resEntry.label).toBe("delegation resolved");
  });
});
