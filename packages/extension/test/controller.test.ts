import { describe, expect, it, vi } from "vitest";
import type { Agent, DispatchSpec, OrchestratorEvent } from "@hallucinate/core";
import type { CockpitState } from "@hallucinate/cockpit";
import { createCockpit, type OrchestratorLike } from "../src/controller.js";

function fakeOrch() {
  let listener: ((e: OrchestratorEvent) => void) | undefined;
  const calls: string[] = [];
  const spawnArgs: Array<[string, string, { goal?: string; engineId?: string; model?: string } | undefined]> = [];
  const dispatchArgs: DispatchSpec[] = [];
  const orch: OrchestratorLike = {
    on(l) { listener = l; return () => { listener = undefined; }; },
    spawn: (r, d, opts?) => { calls.push(`spawn:${r}:${d}`); spawnArgs.push([r, d, opts]); return {} as Agent; },
    dispatch: (spec: DispatchSpec) => { calls.push(`dispatch`); dispatchArgs.push(spec); return {} as Agent; },
    steer: (id, i) => { calls.push(`steer:${id}:${i}`); },
    approve: (id, ap, dec) => { calls.push(`approve:${id}:${ap}:${dec}`); },
    stop: (id) => { calls.push(`stop:${id}`); },
    merge: vi.fn(async (id: string) => { calls.push(`merge:${id}`); return { status: "clean" as const }; }),
    discard: vi.fn(async (id: string) => { calls.push(`discard:${id}`); }),
    sendBack: (id: string, fb: string) => { calls.push(`sendBack:${id}:${fb}`); return {} as Agent; },
    retryCleanup: async (id: string) => { calls.push(`retryCleanup:${id}`); },
    markPrCreated: async (id: string) => { calls.push(`markPrCreated:${id}`); },
    approveDelegation: (id: string) => { calls.push(`approveDelegation:${id}`); return {} as Agent; },
    denyDelegation: (id: string) => { calls.push(`denyDelegation:${id}`); },
  };
  return { orch, calls, spawnArgs, dispatchArgs, emit: (e: OrchestratorEvent) => listener?.(e) };
}
const agent = (id: string): Agent => ({
  id, task: { id: `t-${id}`, description: "x", roleName: "Implementer" },
  role: { name: "Implementer", instructions: "", engine: { id: "copilot" }, autonomy: "auto-approve-safe" },
  state: "working", log: [],
});

describe("createCockpit", () => {
  it("pushes a state snapshot when an orchestrator event arrives", () => {
    const { orch, emit } = fakeOrch();
    const states: CockpitState[] = [];
    createCockpit(orch, (s) => states.push(s));
    emit({ kind: "agent-added", agent: agent("a1") });
    expect(states.at(-1)!.cards.map((c) => c.id)).toEqual(["a1"]);
  });

  it("ready re-pushes current state without an orchestrator event", () => {
    const { orch, emit } = fakeOrch();
    const states: CockpitState[] = [];
    const cockpit = createCockpit(orch, (s) => states.push(s));
    emit({ kind: "agent-added", agent: agent("a1") });
    const before = states.length;
    cockpit.handle({ type: "ready" });
    expect(states.length).toBe(before + 1);
  });

  it("dispatches webview messages to orchestrator calls", () => {
    const { orch, calls } = fakeOrch();
    const cockpit = createCockpit(orch, () => {});
    cockpit.handle({ type: "spawn", roleName: "Implementer", description: "fix bug" });
    cockpit.handle({ type: "stop", agentId: "a1" });
    cockpit.handle({ type: "merge", agentId: "a1" });
    cockpit.handle({ type: "discard", agentId: "a2" });
    expect(calls).toContain("spawn:Implementer:fix bug");
    expect(calls).toContain("stop:a1");
    expect(calls).toContain("merge:a1");
    expect(calls).toContain("discard:a2");
  });

  it("routes a rejected merge to onError", async () => {
    const { orch } = fakeOrch();
    (orch.merge as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("conflict abort failed"));
    const onError = vi.fn();
    const cockpit = createCockpit(orch, () => {}, onError);
    cockpit.handle({ type: "merge", agentId: "a1" });
    await new Promise((r) => setTimeout(r, 0));
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("conflict abort failed"));
  });

  it("dispatches sendBack to the orchestrator", () => {
    const { orch, calls } = fakeOrch();
    const cockpit = createCockpit(orch, () => {});
    cockpit.handle({ type: "sendBack", agentId: "a1", feedback: "please add tests" });
    expect(calls).toContain("sendBack:a1:please add tests");
  });

  it("dispatches retry-cleanup to the orchestrator", () => {
    const { orch, calls } = fakeOrch();
    const cockpit = createCockpit(orch, () => {});
    cockpit.handle({ type: "retry-cleanup", agentId: "a1" });
    expect(calls).toContain("retryCleanup:a1");
  });

  it("routes resolve-conflict/finish-merge/create-pr to the onMergeAction callback", () => {
    const { orch } = fakeOrch();
    const seen: string[] = [];
    const cockpit = createCockpit(orch, () => {}, undefined, (msg) => seen.push(msg.type));
    cockpit.handle({ type: "resolve-conflict", agentId: "a1" });
    cockpit.handle({ type: "finish-merge", agentId: "a1" });
    cockpit.handle({ type: "create-pr", agentId: "a1" });
    expect(seen).toEqual(["resolve-conflict", "finish-merge", "create-pr"]);
  });

  it("does not let a thrown sync handler escape handle(); routes it to onError", () => {
    const { orch } = fakeOrch();
    orch.spawn = () => { throw new Error("spawn blew up"); };
    const onError = vi.fn();
    const cockpit = createCockpit(orch, () => {}, onError);
    expect(() => cockpit.handle({ type: "spawn", roleName: "R", description: "d" })).not.toThrow();
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("spawn blew up"));
  });

  it("forwards goal to orch.spawn when provided", () => {
    const { orch, spawnArgs } = fakeOrch();
    const cockpit = createCockpit(orch, () => {});
    cockpit.handle({ type: "spawn", roleName: "Implementer", description: "fix", goal: "why" });
    expect(spawnArgs).toHaveLength(1);
    expect(spawnArgs[0]).toEqual(["Implementer", "fix", { goal: "why" }]);
  });

  it("forwards undefined goal to orch.spawn when goal is omitted", () => {
    const { orch, spawnArgs } = fakeOrch();
    const cockpit = createCockpit(orch, () => {});
    cockpit.handle({ type: "spawn", roleName: "Implementer", description: "fix" });
    expect(spawnArgs).toHaveLength(1);
    expect(spawnArgs[0]).toEqual(["Implementer", "fix", undefined]);
  });

  it("focus updates state and dispose unsubscribes", () => {
    const { orch, emit } = fakeOrch();
    const states: CockpitState[] = [];
    const cockpit = createCockpit(orch, (s) => states.push(s));
    emit({ kind: "agent-added", agent: agent("a1") });
    cockpit.handle({ type: "focus", agentId: "a1" });
    expect(states.at(-1)!.focusedId).toBe("a1");
    cockpit.dispose();
    const after = states.length;
    emit({ kind: "agent-added", agent: agent("a2") });
    expect(states.length).toBe(after); // no more pushes after dispose
  });

  it("routes a preset dispatch to orch.dispatch", () => {
    const { orch, dispatchArgs } = fakeOrch();
    const cockpit = createCockpit(orch, () => {});
    cockpit.handle({ type: "dispatch", roleName: "Test Author", description: "write tests", goal: "so it is tested" });
    expect(dispatchArgs).toHaveLength(1);
    expect(dispatchArgs[0]).toMatchObject({
      roleName: "Test Author",
      description: "write tests",
      goal: "so it is tested",
    });
  });

  it("routes an ad-hoc dispatch (newRoleName) to orch.dispatch", () => {
    const { orch, dispatchArgs } = fakeOrch();
    const cockpit = createCockpit(orch, () => {});
    cockpit.handle({ type: "dispatch", newRoleName: "Doc Writer", engineId: "copilot", description: "docs" });
    expect(dispatchArgs).toHaveLength(1);
    expect(dispatchArgs[0]).toMatchObject({
      newRoleName: "Doc Writer",
      engineId: "copilot",
      description: "docs",
    });
  });

  it("a throwing dispatch is routed to onError, not thrown", () => {
    const { orch } = fakeOrch();
    (orch as any).dispatch = () => { throw new Error("Unknown role: Ghost"); };
    const onError = vi.fn();
    const cockpit = createCockpit(orch, () => {}, onError);
    cockpit.handle({ type: "dispatch", roleName: "Ghost", description: "x" });
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("Unknown role"));
  });

  // ─── Decision-bar dispatch lock-down tests ────────────────────────────────

  it("sendBack dispatches to orch.sendBack with id and feedback", () => {
    const { orch, calls } = fakeOrch();
    const cockpit = createCockpit(orch, () => {});
    cockpit.handle({ type: "sendBack", agentId: "a7", feedback: "needs more tests" });
    expect(calls).toContain("sendBack:a7:needs more tests");
  });

  it("merge dispatches to orch.merge with id", async () => {
    const { orch, calls } = fakeOrch();
    const cockpit = createCockpit(orch, () => {});
    cockpit.handle({ type: "merge", agentId: "a2" });
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toContain("merge:a2");
  });

  it("discard dispatches to orch.discard with id", async () => {
    const { orch, calls } = fakeOrch();
    const cockpit = createCockpit(orch, () => {});
    cockpit.handle({ type: "discard", agentId: "a3" });
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toContain("discard:a3");
  });

  it("retry-cleanup dispatches to orch.retryCleanup with id", async () => {
    const { orch, calls } = fakeOrch();
    const cockpit = createCockpit(orch, () => {});
    cockpit.handle({ type: "retry-cleanup", agentId: "a4" });
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toContain("retryCleanup:a4");
  });

  it("create-pr routes to onMergeAction with type create-pr", () => {
    const { orch } = fakeOrch();
    const seen: string[] = [];
    const cockpit = createCockpit(orch, () => {}, undefined, (msg) => seen.push(msg.type));
    cockpit.handle({ type: "create-pr", agentId: "a5" });
    expect(seen).toContain("create-pr");
  });

  it("finish-merge routes to onMergeAction with type finish-merge", () => {
    const { orch } = fakeOrch();
    const seen: string[] = [];
    const cockpit = createCockpit(orch, () => {}, undefined, (msg) => seen.push(msg.type));
    cockpit.handle({ type: "finish-merge", agentId: "a5" });
    expect(seen).toContain("finish-merge");
  });

  it("resolve-conflict routes to onMergeAction with type resolve-conflict", () => {
    const { orch } = fakeOrch();
    const seen: string[] = [];
    const cockpit = createCockpit(orch, () => {}, undefined, (msg) => seen.push(msg.type));
    cockpit.handle({ type: "resolve-conflict", agentId: "a5" });
    expect(seen).toContain("resolve-conflict");
  });

  it("open-review calls the injected onOpenReview with the agent id", () => {
    const { orch } = fakeOrch();
    const reviewed: string[] = [];
    const cockpit = createCockpit(orch, () => {}, undefined, undefined, (id) => reviewed.push(id));
    cockpit.handle({ type: "open-review", agentId: "a9" });
    expect(reviewed).toEqual(["a9"]);
  });

  it("open-review is a no-op when no onOpenReview callback is provided", () => {
    const { orch } = fakeOrch();
    const cockpit = createCockpit(orch, () => {});
    // Should not throw when no callback is provided
    expect(() => cockpit.handle({ type: "open-review", agentId: "a9" })).not.toThrow();
  });

  // ─── Lead-coordinated teams: delegation approve / deny ───────────────────

  it("approve-delegation calls orch.approveDelegation with the delegation id", () => {
    const { orch, calls } = fakeOrch();
    const cockpit = createCockpit(orch, () => {});
    cockpit.handle({ type: "approve-delegation", id: "d1" });
    expect(calls).toContain("approveDelegation:d1");
  });

  it("deny-delegation calls orch.denyDelegation with the delegation id", () => {
    const { orch, calls } = fakeOrch();
    const cockpit = createCockpit(orch, () => {});
    cockpit.handle({ type: "deny-delegation", id: "d2" });
    expect(calls).toContain("denyDelegation:d2");
  });

  // ─── Clear-done-lane: bulk discard of ready-to-review (done) cards ─────────

  /** A done agent with a non-empty diff so it lands in the "done" lane/state. */
  const doneAgent = (id: string): Agent => ({
    ...agent(id),
    state: "done",
    diff: { files: ["a.ts"], patch: "P" },
  });

  it("clear-done-lane with confirm=true discards EVERY done agent", async () => {
    const { orch, calls, emit } = fakeOrch();
    const confirmClearDone = vi.fn(async () => true);
    const cockpit = createCockpit(orch, () => {}, undefined, undefined, undefined, confirmClearDone);
    // Two done agents + one working agent on the board.
    emit({ kind: "agent-added", agent: doneAgent("d1") });
    emit({ kind: "agent-added", agent: doneAgent("d2") });
    emit({ kind: "agent-added", agent: agent("w1") });
    cockpit.handle({ type: "clear-done-lane" });
    await new Promise((r) => setTimeout(r, 0));
    // Confirmed with the count of done cards (2), then discarded each done id.
    expect(confirmClearDone).toHaveBeenCalledWith(2);
    expect(calls).toContain("discard:d1");
    expect(calls).toContain("discard:d2");
    // The working agent is NOT discarded.
    expect(calls).not.toContain("discard:w1");
  });

  it("clear-done-lane with confirm=false is a no-op (discards nothing)", async () => {
    const { orch, calls, emit } = fakeOrch();
    const confirmClearDone = vi.fn(async () => false);
    const cockpit = createCockpit(orch, () => {}, undefined, undefined, undefined, confirmClearDone);
    emit({ kind: "agent-added", agent: doneAgent("d1") });
    cockpit.handle({ type: "clear-done-lane" });
    await new Promise((r) => setTimeout(r, 0));
    expect(confirmClearDone).toHaveBeenCalledWith(1);
    expect(calls.some((c) => c.startsWith("discard:"))).toBe(false);
  });

  it("clear-done-lane with no done cards never asks to confirm and discards nothing", async () => {
    const { orch, calls, emit } = fakeOrch();
    const confirmClearDone = vi.fn(async () => true);
    const cockpit = createCockpit(orch, () => {}, undefined, undefined, undefined, confirmClearDone);
    emit({ kind: "agent-added", agent: agent("w1") }); // working only
    cockpit.handle({ type: "clear-done-lane" });
    await new Promise((r) => setTimeout(r, 0));
    expect(confirmClearDone).not.toHaveBeenCalled();
    expect(calls.some((c) => c.startsWith("discard:"))).toBe(false);
  });

  it("clear-done-lane is a safe no-op when no confirm dependency is injected", async () => {
    const { orch, calls, emit } = fakeOrch();
    const cockpit = createCockpit(orch, () => {});
    emit({ kind: "agent-added", agent: doneAgent("d1") });
    cockpit.handle({ type: "clear-done-lane" });
    await new Promise((r) => setTimeout(r, 0));
    expect(calls.some((c) => c.startsWith("discard:"))).toBe(false);
  });

  // ─── pr-created forgets the persisted log (no ghost card on reload) ─────────

  it("a pr-created transition is observed via the orchestrator subscription", () => {
    // The persistence forget for pr-created lives at the extension wire site
    // (extension.ts), but the controller must still reduce a pr-created
    // agent-updated event into a clean state push without throwing.
    const { orch, emit } = fakeOrch();
    const states: CockpitState[] = [];
    createCockpit(orch, (s) => states.push(s));
    emit({ kind: "agent-added", agent: doneAgent("p1") });
    expect(() =>
      emit({ kind: "agent-updated", agent: { ...doneAgent("p1"), state: "pr-created" } }),
    ).not.toThrow();
    expect(states.length).toBeGreaterThan(0);
  });

  // ─── Read-only virtual (fleet) sub-agent guard ─────────────────────────────

  it("drops a mutating action aimed at a read-only virtual sub-agent before core sees it", () => {
    const { orch, calls, emit } = fakeOrch();
    const cockpit = createCockpit(orch, () => {});
    // A done virtual sub-agent is on the board.
    emit({
      kind: "agent-added",
      agent: { ...doneAgent("sub1"), parentId: "lead1", virtual: true },
    });
    // Every mutating verb against the virtual card is silently dropped.
    cockpit.handle({ type: "merge", agentId: "sub1" });
    cockpit.handle({ type: "discard", agentId: "sub1" });
    cockpit.handle({ type: "stop", agentId: "sub1" });
    cockpit.handle({ type: "steer", agentId: "sub1", input: "go" });
    cockpit.handle({ type: "approve", agentId: "sub1", approvalId: "x", decision: "allow" });
    cockpit.handle({ type: "sendBack", agentId: "sub1", feedback: "redo" });
    expect(calls.some((c) => c.includes("sub1"))).toBe(false);
  });

  it("still routes mutating actions for a NON-virtual agent (the guard is virtual-only)", () => {
    const { orch, calls, emit } = fakeOrch();
    const cockpit = createCockpit(orch, () => {});
    emit({ kind: "agent-added", agent: doneAgent("real1") });
    cockpit.handle({ type: "merge", agentId: "real1" });
    expect(calls).toContain("merge:real1");
  });

  it("a virtual card's merge action is NOT forwarded to onMergeAction (create-pr dropped)", () => {
    const { orch, emit } = fakeOrch();
    const seen: string[] = [];
    const cockpit = createCockpit(orch, () => {}, undefined, (msg) => seen.push(msg.type));
    emit({
      kind: "agent-added",
      agent: { ...doneAgent("sub1"), parentId: "lead1", virtual: true },
    });
    cockpit.handle({ type: "create-pr", agentId: "sub1" });
    expect(seen).toEqual([]);
  });
});
