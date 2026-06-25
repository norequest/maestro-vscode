import { describe, expect, it } from "vitest";
import { Orchestrator } from "../src/orchestrator.js";
import { FakeWorkspaceProvider, FakeWorkspaceManager } from "../src/workspace.js";
import type { Agent, OrchestratorEvent } from "../src/types.js";

function mkAgent(over: Partial<Agent> = {}): Agent {
  return {
    id: "a1",
    task: { id: "t1", description: "fix tests", roleName: "Implementer" },
    role: { name: "Implementer", instructions: "", engine: { id: "copilot" }, autonomy: "auto-approve-safe" },
    state: "done",
    log: [],
    ...over,
  };
}

describe("Orchestrator.hydrate", () => {
  it("restores a terminal (done) agent as-is and emits agent-added", () => {
    const orch = new Orchestrator({ maxParallelAgents: 3 }, new FakeWorkspaceProvider());
    const events: OrchestratorEvent[] = [];
    orch.on((e) => events.push(e));
    orch.hydrate([{ agent: mkAgent({ state: "done", summary: "fixed 3 tests" }) }]);
    expect(events).toHaveLength(1);
    expect(events[0]!.kind).toBe("agent-added");
    expect(orch.getAgent("a1")).toMatchObject({ state: "done", summary: "fixed 3 tests" });
  });

  it("transitions a mid-run (working) agent to detached", () => {
    const orch = new Orchestrator({ maxParallelAgents: 3 }, new FakeWorkspaceProvider());
    const events: OrchestratorEvent[] = [];
    orch.on((e) => events.push(e));
    orch.hydrate([{ agent: mkAgent({ id: "a2", state: "working" }) }]);
    expect(events.map((e) => e.kind)).toEqual(["agent-added", "agent-updated"]);
    expect(orch.getAgent("a2")?.state).toBe("detached");
  });

  it("preserves a conflict agent on hydrate (does NOT detach it)", () => {
    const orch = new Orchestrator({ maxParallelAgents: 3 }, new FakeWorkspaceProvider());
    orch.hydrate([{ agent: mkAgent({ id: "a3", state: "conflict", conflict: { files: ["x.ts"] } }) }]);
    expect(orch.getAgent("a3")?.state).toBe("conflict");
  });

  it("replays the persisted event log as agent-event so scrollback survives", () => {
    const orch = new Orchestrator({ maxParallelAgents: 3 }, new FakeWorkspaceProvider());
    const events: OrchestratorEvent[] = [];
    orch.on((e) => events.push(e));
    orch.hydrate([{ agent: mkAgent({
      id: "a4",
      state: "done",
      summary: "ok",
      log: [{ kind: "output", text: "hello" }, { kind: "done", summary: "ok" }],
    }) }]);
    const agentEvents = events.filter((e) => e.kind === "agent-event");
    expect(agentEvents).toHaveLength(2);
    expect(agentEvents[0]).toMatchObject({ kind: "agent-event", agentId: "a4", event: { kind: "output", text: "hello" } });
  });

  it("restores workspace from workspacePath/workspaceBranch when absent on the snapshot", () => {
    const orch = new Orchestrator({ maxParallelAgents: 3 }, new FakeWorkspaceProvider());
    orch.hydrate([{ agent: mkAgent({ id: "a5", state: "done" }), workspacePath: "/repo/.hallucinate/wt/a5", workspaceBranch: "agent/x" }]);
    expect(orch.getAgent("a5")?.workspace).toEqual({ agentId: "a5", path: "/repo/.hallucinate/wt/a5", branch: "agent/x" });
  });

  it("hydrate([]) is a no-op", () => {
    const orch = new Orchestrator({ maxParallelAgents: 3 }, new FakeWorkspaceProvider());
    const events: OrchestratorEvent[] = [];
    orch.on((e) => events.push(e));
    orch.hydrate([]);
    expect(events).toHaveLength(0);
  });

  it("allows merge from a detached agent", async () => {
    const manager = new FakeWorkspaceManager();
    const orch = new Orchestrator({ maxParallelAgents: 1 }, manager);
    orch.hydrate([{ agent: mkAgent({ id: "a6", state: "working", workspace: { agentId: "a6", path: "/wt/a6", branch: "agent/a6" } }) }]);
    expect(orch.getAgent("a6")?.state).toBe("detached");
    const result = await orch.merge("a6");
    expect(result).toEqual({ status: "clean" });
    expect(orch.getAgent("a6")?.state).toBe("merged");
  });

  it("allows discard from a detached agent", async () => {
    const manager = new FakeWorkspaceManager();
    const orch = new Orchestrator({ maxParallelAgents: 1 }, manager);
    orch.hydrate([{ agent: mkAgent({ id: "a7", state: "working", workspace: { agentId: "a7", path: "/wt/a7", branch: "agent/a7" } }) }]);
    expect(orch.getAgent("a7")?.state).toBe("detached");
    await orch.discard("a7");
    expect(orch.getAgent("a7")?.state).toBe("discarded");
  });

  it("does not block new spawns (hydrate never increments running)", async () => {
    const orch = new Orchestrator({ maxParallelAgents: 1 }, new FakeWorkspaceProvider());
    const { FakeEngineAdapter } = await import("../src/fake-adapter.js");
    orch.registerAdapter(new FakeEngineAdapter({ id: "fake", script: [{ kind: "done", summary: "ok" }] }));
    orch.registerRole({ name: "Implementer", instructions: "", engine: { id: "fake" }, autonomy: "manual" });
    orch.hydrate([{ agent: mkAgent({ id: "a8", state: "done" }) }]);
    const spawned = orch.spawn("Implementer", "new task");
    expect(spawned.state).toBe("preparing");
  });
});
