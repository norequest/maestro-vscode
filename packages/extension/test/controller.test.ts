import { describe, expect, it, vi } from "vitest";
import type { Agent, OrchestratorEvent } from "@maestro/core";
import type { CockpitState } from "@maestro/cockpit";
import { createCockpit, type OrchestratorLike } from "../src/controller.js";

function fakeOrch() {
  let listener: ((e: OrchestratorEvent) => void) | undefined;
  const calls: string[] = [];
  const orch: OrchestratorLike = {
    on(l) { listener = l; return () => { listener = undefined; }; },
    spawn: (r, d) => { calls.push(`spawn:${r}:${d}`); return {} as Agent; },
    steer: (id, i) => { calls.push(`steer:${id}:${i}`); },
    approve: (id, ap, dec) => { calls.push(`approve:${id}:${ap}:${dec}`); },
    stop: (id) => { calls.push(`stop:${id}`); },
    merge: vi.fn(async (id: string) => { calls.push(`merge:${id}`); return { status: "clean" as const }; }),
    discard: vi.fn(async (id: string) => { calls.push(`discard:${id}`); }),
    sendBack: (id: string, fb: string) => { calls.push(`sendBack:${id}:${fb}`); return {} as Agent; },
    retryCleanup: async (id: string) => { calls.push(`retryCleanup:${id}`); },
  };
  return { orch, calls, emit: (e: OrchestratorEvent) => listener?.(e) };
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
});
