import { describe, expect, it } from "vitest";
import type { Agent, OrchestratorEvent } from "@maestro/core";
import { initialModel, reduce, setFocus } from "../src/reducer.js";

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

  it("carries goal, taskDescription, and lane onto the card", () => {
    const m = reduce(initialModel(), added(agent({ task: { id: "t1", description: "wire the board", roleName: "Implementer", goal: "so that the board is real" } })));
    const c = m.cards.get("a1")!;
    expect(c.goal).toBe("so that the board is real");
    expect(c.taskDescription).toBe("wire the board");
    expect(c.lane).toBe("working");
  });

  it("derives diffStat by counting + and - patch lines (ignoring +++/--- headers)", () => {
    const patch = ["--- a/x.ts", "+++ b/x.ts", "@@", "-old line", "+new line", "+second add", " ctx"].join("\n");
    const m = reduce(initialModel(), updated(agent({ state: "done", diff: { files: ["x.ts"], patch } })));
    expect(m.cards.get("a1")!.diffStat).toEqual({ adds: 2, dels: 1 });
  });

  it("has no diffStat until a diff exists", () => {
    const m = reduce(initialModel(), added(agent()));
    expect(m.cards.get("a1")!.diffStat).toBeUndefined();
  });

  it("stamps startedAt when the card first enters working and preserves it after", () => {
    let m = reduce(initialModel(), added(agent()));
    expect(m.cards.get("a1")!.startedAt).toBeUndefined();
    m = reduce(m, updated(agent({ state: "working" })));
    const started = m.cards.get("a1")!.startedAt;
    expect(typeof started).toBe("number");
    m = reduce(m, updated(agent({ state: "done", summary: "ok" })));
    expect(m.cards.get("a1")!.startedAt).toBe(started);
  });

  it("lane tracks state transitions (working -> needsYou on error, conflict on conflict)", () => {
    let m = reduce(initialModel(), added(agent({ state: "working" })));
    expect(m.cards.get("a1")!.lane).toBe("working");
    m = reduce(m, updated(agent({ state: "error", error: "boom" })));
    expect(m.cards.get("a1")!.lane).toBe("needsYou");
    m = reduce(m, updated(agent({ state: "conflict", conflict: { files: ["x.ts"] } })));
    expect(m.cards.get("a1")!.lane).toBe("conflict");
  });

  it("anatomy fields are always populated: bare role yields false/0/0/[] (P4 supersedes P1 placeholder)", () => {
    const c = reduce(initialModel(), added(agent())).cards.get("a1")!;
    expect(c.soul).toBe(false);
    expect(c.toolsCount).toBe(0);
    expect(c.toolsCanWrite).toBe(0);
    expect(c.skills).toEqual([]);
  });

  it("P4: populates soul/toolsCount/toolsCanWrite/skills from role with soul+tools+skills", () => {
    const a = agent({
      role: {
        name: "Reviewer",
        instructions: "",
        engine: { id: "copilot" },
        autonomy: "auto-approve-safe",
        soul: "reviewer",
        tools: { builtins: { read: ["Read"], write: ["Git"] } },
        skills: ["run-tests"],
      },
    });
    const c = reduce(initialModel(), added(a)).cards.get("a1")!;
    expect(c.soul).toBe(true);
    expect(c.toolsCount).toBe(2);
    expect(c.toolsCanWrite).toBe(1);
    expect(c.skills).toEqual(["run-tests"]);
  });

  it("P4: bare role (no soul/tools/skills) produces soul=false, toolsCount=0, toolsCanWrite=0, skills=[]", () => {
    const c = reduce(initialModel(), added(agent())).cards.get("a1")!;
    expect(c.soul).toBe(false);
    expect(c.toolsCount).toBe(0);
    expect(c.toolsCanWrite).toBe(0);
    expect(c.skills).toEqual([]);
  });

  it("auto-removes a card from the model when it transitions to merged", () => {
    let m = reduce(initialModel(), added(agent()));
    expect(m.cards.has("a1")).toBe(true);
    m = reduce(m, updated(agent({ state: "merged" })));
    expect(m.cards.has("a1")).toBe(false);
  });

  it("auto-removes a card from the model when it transitions to discarded", () => {
    let m = reduce(initialModel(), added(agent()));
    m = reduce(m, updated(agent({ state: "discarded" })));
    expect(m.cards.has("a1")).toBe(false);
  });

  it("auto-removes a card from the model when it transitions to pr-created", () => {
    let m = reduce(initialModel(), added(agent()));
    m = reduce(m, updated(agent({ state: "pr-created" })));
    expect(m.cards.has("a1")).toBe(false);
  });

  it("keeps a done (ready-to-review) card: only committed outcomes auto-leave", () => {
    let m = reduce(initialModel(), added(agent()));
    m = reduce(m, updated(agent({ state: "done", summary: "ok" })));
    expect(m.cards.has("a1")).toBe(true);
    expect(m.cards.get("a1")!.state).toBe("done");
  });

  it("clears focusedId when the focused card resolves (merged)", () => {
    let m = reduce(initialModel(), added(agent()));
    m = setFocus(m, "a1");
    expect(m.focusedId).toBe("a1");
    m = reduce(m, updated(agent({ state: "merged" })));
    expect(m.focusedId).toBeUndefined();
  });

  it("leaves focusedId on another card untouched when a different card resolves", () => {
    let m = reduce(initialModel(), added(agent({ id: "a1" })));
    m = reduce(m, added(agent({ id: "a2" })));
    m = setFocus(m, "a2");
    m = reduce(m, updated(agent({ id: "a1", state: "merged" })));
    expect(m.focusedId).toBe("a2");
  });

  it("creates no card for an agent added directly in a resolved state (rehydrate guard)", () => {
    const m = reduce(initialModel(), added(agent({ state: "discarded" })));
    expect(m.cards.has("a1")).toBe(false);
    expect(m.cards.size).toBe(0);
  });

  it("clears focusedId when an agent added directly resolved was the focused id", () => {
    let m = reduce(initialModel(), added(agent({ id: "a1", state: "working" })));
    m = setFocus(m, "a1");
    // A rehydrate replays a1 already resolved: its card must not reappear and focus must drop.
    m = reduce(m, added(agent({ id: "a1", state: "merged" })));
    expect(m.cards.has("a1")).toBe(false);
    expect(m.focusedId).toBeUndefined();
  });

  it("carries role.instructions onto the card and preserves it across agent-updated (drawer Instructions tab)", () => {
    const instructions = "# Instructions\nYou are an implementer.\n# Skills\nfoo";
    const role = { name: "Implementer", instructions, engine: { id: "copilot" }, autonomy: "auto-approve-safe" as const };
    let m = reduce(initialModel(), added(agent({ role })));
    expect(m.cards.get("a1")!.instructions).toBe(instructions);
    // The reducer re-derives card fields from the Agent on update; instructions must survive too.
    m = reduce(m, updated(agent({ role, state: "working" })));
    expect(m.cards.get("a1")!.instructions).toBe(instructions);
  });

  it("maps agent.virtual onto CardVM.virtual (fleet sub-agent), and leaves a plain agent undefined", () => {
    const v = reduce(initialModel(), added(agent({ id: "sub1", parentId: "lead1", virtual: true }))).cards.get("sub1")!;
    expect(v.virtual).toBe(true);
    expect(v.parentId).toBe("lead1");
    const plain = reduce(initialModel(), added(agent({ id: "p1" }))).cards.get("p1")!;
    expect(plain.virtual).toBeUndefined();
  });
});
