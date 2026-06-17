import { describe, it, expect, vi } from "vitest";
import { Orchestrator } from "../src/orchestrator.js";
import { FakeEngineAdapter } from "../src/fake-adapter.js";
import { FakeWorkspaceProvider } from "../src/workspace.js";
import type { PreambleResolver, SoulDoc } from "../src/types.js";

function waitForState(orch: Orchestrator, agentId: string, target: string): Promise<void> {
  return new Promise((resolve) => {
    let unsub: (() => void) | undefined;
    const check = () => {
      if (orch.getAgent(agentId)?.state === target) { unsub?.(); resolve(); }
    };
    unsub = orch.on(check);
    check();
  });
}

describe("Orchestrator preamble resolver", () => {
  it("populates task.soulDoc and task.skillBodies when a resolver is set", async () => {
    const fakeSoul: SoulDoc = { redLines: "never lie", raw: "## Red lines\nnever lie" };
    const resolver: PreambleResolver = vi.fn(async () => ({
      soulDoc: fakeSoul,
      skillBodies: ["skill body A"],
    }));

    const adapter = new FakeEngineAdapter({ script: [{ kind: "done", summary: "ok" }] });
    const orch = new Orchestrator({ maxParallelAgents: 1 }, new FakeWorkspaceProvider());
    orch.registerAdapter(adapter);
    orch.registerRole({ name: "R", instructions: "do it", engine: { id: "fake" }, autonomy: "yolo" });
    orch.setPreambleResolver(resolver);

    const agent = orch.spawn("R", "my task");
    await waitForState(orch, agent.id, "done");

    // The task passed to the adapter must have soulDoc and skillBodies populated
    expect(adapter.startedTasks).toHaveLength(1);
    const started = adapter.startedTasks[0]!;
    expect(started.soulDoc).toEqual(fakeSoul);
    expect(started.skillBodies).toEqual(["skill body A"]);
    expect(resolver).toHaveBeenCalledWith(expect.objectContaining({ name: "R" }));
  });

  it("leaves soulDoc and skillBodies undefined when no resolver is set", async () => {
    const adapter = new FakeEngineAdapter({ script: [{ kind: "done", summary: "ok" }] });
    const orch = new Orchestrator({ maxParallelAgents: 1 }, new FakeWorkspaceProvider());
    orch.registerAdapter(adapter);
    orch.registerRole({ name: "R", instructions: "do it", engine: { id: "fake" }, autonomy: "yolo" });
    // No setPreambleResolver call

    const agent = orch.spawn("R", "my task");
    await waitForState(orch, agent.id, "done");

    const started = adapter.startedTasks[0]!;
    expect(started.soulDoc).toBeUndefined();
    expect(started.skillBodies).toBeUndefined();
  });

  it("continues without soul/skills when resolver throws", async () => {
    const resolver: PreambleResolver = async () => { throw new Error("fs unavailable"); };
    const adapter = new FakeEngineAdapter({ script: [{ kind: "done", summary: "ok" }] });
    const orch = new Orchestrator({ maxParallelAgents: 1 }, new FakeWorkspaceProvider());
    orch.registerAdapter(adapter);
    orch.registerRole({ name: "R", instructions: "do it", engine: { id: "fake" }, autonomy: "yolo" });
    orch.setPreambleResolver(resolver);

    const agent = orch.spawn("R", "my task");
    await waitForState(orch, agent.id, "done");

    const started = adapter.startedTasks[0]!;
    expect(started.soulDoc).toBeUndefined();
    expect(started.skillBodies).toBeUndefined();
  });
});
