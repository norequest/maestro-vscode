import { describe, expect, it } from "vitest";
import { Orchestrator } from "../src/orchestrator.js";
import { FakeEngineAdapter } from "../src/fake-adapter.js";
import { FakeWorkspaceProvider } from "../src/workspace.js";

describe("Orchestrator Task.goal", () => {
  it("threads an optional goal onto the spawned task", () => {
    const orch = new Orchestrator({ maxParallelAgents: 1 }, new FakeWorkspaceProvider());
    orch.registerAdapter(new FakeEngineAdapter({ script: [] }));
    orch.registerRole({ name: "Impl", instructions: "", engine: { id: "fake" }, autonomy: "manual" });
    const a = orch.spawn("Impl", "do the thing", "so that checkout cannot silently break");
    expect(a.task.goal).toBe("so that checkout cannot silently break");
  });

  it("omits goal when not provided (back-compatible)", () => {
    const orch = new Orchestrator({ maxParallelAgents: 1 }, new FakeWorkspaceProvider());
    orch.registerAdapter(new FakeEngineAdapter({ script: [] }));
    orch.registerRole({ name: "Impl", instructions: "", engine: { id: "fake" }, autonomy: "manual" });
    const a = orch.spawn("Impl", "do the thing");
    expect(a.task.goal).toBeUndefined();
  });
});
