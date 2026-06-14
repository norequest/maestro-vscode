import { describe, expect, it } from "vitest";
import * as core from "../src/index.js";

describe("public API", () => {
  it("exports the orchestrator and test doubles", () => {
    expect(typeof core.Orchestrator).toBe("function");
    expect(typeof core.FakeEngineAdapter).toBe("function");
    expect(typeof core.FakeWorkspaceProvider).toBe("function");
    expect(typeof core.FakeWorkspaceManager).toBe("function");
    expect(typeof core.isWorkspaceManager).toBe("function");
    expect(typeof core.Emitter).toBe("function");
    expect(typeof core.isTerminalState).toBe("function");
  });

  it("exports the AgentState policy predicates (T8)", () => {
    expect(typeof core.isDiscardableState).toBe("function");
    expect(typeof core.stateNeedsAttention).toBe("function");
  });
});
