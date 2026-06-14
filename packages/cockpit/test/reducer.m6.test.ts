import { describe, it, expect } from "vitest";
import { initialModel, reduce } from "../src/reducer.js";
import type { Agent, OrchestratorEvent } from "@maestro/core";

function agent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "a1",
    task: { id: "t1", description: "task", roleName: "Dev" },
    role: { name: "Dev", instructions: "", engine: { id: "acp" }, autonomy: "manual" },
    state: "preparing",
    log: [],
    ...overrides,
  };
}

describe("reducer M6: approval detail + capabilities", () => {
  it("carries approvalDetail from agent into the card", () => {
    let model = initialModel();
    model = reduce(model, { kind: "agent-added", agent: agent() });
    const updated: OrchestratorEvent = {
      kind: "agent-updated",
      agent: agent({
        state: "awaiting-approval",
        pendingApprovalId: "req-1",
        approvalDetail: { tool: "bash", description: "Run: npm test" },
      }),
    };
    model = reduce(model, updated);
    const card = model.cards.get("a1")!;
    expect(card.approvalDetail).toEqual({ tool: "bash", description: "Run: npm test" });
    expect(card.pendingApprovalId).toBe("req-1");
  });

  it("clears approvalDetail when the agent transitions back to working", () => {
    let model = initialModel();
    model = reduce(model, { kind: "agent-added", agent: agent() });
    model = reduce(model, {
      kind: "agent-updated",
      agent: agent({ state: "working", pendingApprovalId: undefined, approvalDetail: undefined }),
    });
    const card = model.cards.get("a1")!;
    expect(card.approvalDetail).toBeUndefined();
    expect(card.pendingApprovalId).toBeUndefined();
  });

  it("carries engineCapabilities from agent into the card", () => {
    let model = initialModel();
    model = reduce(model, {
      kind: "agent-added",
      agent: agent({ engineCapabilities: { approvals: true, steerable: true } }),
    });
    const card = model.cards.get("a1")!;
    expect(card.engineCapabilities).toEqual({ approvals: true, steerable: true });
  });
});
