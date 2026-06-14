import { describe, expect, it } from "vitest";
import * as core from "../src/index.js";
import type { Team } from "../src/index.js";

// Compile-time guard: Team must remain part of the package's public type surface,
// since consumers pass Team objects to Orchestrator.launchTeam. A type-only import
// like this fails typecheck if the re-export is ever dropped.
const _teamExportCheck: Team = { name: "t", roles: [] };
void _teamExportCheck;

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
