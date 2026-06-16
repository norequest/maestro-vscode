import { describe, expect, it } from "vitest";
import { Orchestrator } from "../src/orchestrator.js";
import { FakeEngineAdapter } from "../src/fake-adapter.js";
import { FakeWorkspaceProvider } from "../src/workspace.js";
import type { Role } from "../src/types.js";

function setup() {
  const orch = new Orchestrator({ maxParallelAgents: 4 }, new FakeWorkspaceProvider());
  const copilotAdapter = new FakeEngineAdapter({ id: "copilot", script: [] });
  const acpAdapter = new FakeEngineAdapter({ id: "acp", script: [] });
  orch.registerAdapter(copilotAdapter);
  orch.registerAdapter(acpAdapter);
  const implementerRole: Role = {
    name: "Implementer",
    instructions: "Implement the feature.",
    engine: { id: "copilot" },
    autonomy: "auto-approve-safe",
  };
  orch.registerRole(implementerRole);
  // Return roles map by capturing the registered role object for non-mutation asserts.
  // We expose the registered role reference so tests can verify it is not mutated.
  const roles = new Map<string, Role>();
  roles.set("Implementer", implementerRole);
  return { orch, roles };
}

describe("Orchestrator spawn opts bag + dispatch", () => {
  it("keeps the two-arg spawn working (back-compat)", () => {
    const { orch } = setup();
    const a = orch.spawn("Implementer", "do the thing");
    expect(a.role.name).toBe("Implementer");
    expect(a.task.description).toBe("do the thing");
  });

  it("threads goal onto the task", () => {
    const { orch } = setup();
    const a = orch.spawn("Implementer", "do it", { goal: "so checkout cannot break" });
    expect(a.task.goal).toBe("so checkout cannot break");
  });

  it("applies an engine override without mutating the registered role", () => {
    const { orch, roles } = setup();
    const a = orch.spawn("Implementer", "do it", { engineId: "acp", model: "gemini" });
    expect(a.role.engine).toEqual({ id: "acp", model: "gemini" });
    // The registered role must not have been mutated.
    expect(roles.get("Implementer")!.engine.id).toBe("copilot");
  });

  it("dispatch registers an ad-hoc role then spawns it", () => {
    const { orch } = setup();
    const a = orch.dispatch({ newRoleName: "Doc Writer", engineId: "copilot", description: "write docs", goal: "so docs exist" });
    expect(a.role.name).toBe("Doc Writer");
    expect(a.role.engine.id).toBe("copilot");
    expect(a.task.goal).toBe("so docs exist");
    expect(orch.getAgent(a.id)).toBeDefined();
  });

  it("dispatch with a known roleName spawns that preset with overrides", () => {
    const { orch } = setup();
    const a = orch.dispatch({ roleName: "Implementer", model: "gpt-5", description: "do it" });
    expect(a.role.name).toBe("Implementer");
    expect(a.role.engine.model).toBe("gpt-5");
  });

  it("dispatch with neither roleName nor newRoleName throws", () => {
    const { orch } = setup();
    expect(() => orch.dispatch({ description: "do it" })).toThrow();
  });
});
