import { describe, it, expect } from "vitest";
import { stateNeedsAttention, type Agent } from "@hallucinate/core";
import { initialModel, reduce } from "../src/reducer.js";

function agent(state: Agent["state"]): Agent {
  return {
    id: "a1",
    task: { id: "t1", description: "x", roleName: "R" },
    role: { name: "R", instructions: "", engine: { id: "fake" }, autonomy: "manual" },
    state,
    log: [],
  };
}

describe("reducer attention is driven by the core predicate", () => {
  it("flags a detached card as needing attention (matching stateNeedsAttention)", () => {
    const model = reduce(initialModel(), { kind: "agent-added", agent: agent("detached") });
    const card = model.cards.get("a1")!;
    expect(card.attention).toBe(true);
    expect(card.attention).toBe(stateNeedsAttention("detached"));
  });

  it("does NOT flag a plain working card (matching stateNeedsAttention)", () => {
    const model = reduce(initialModel(), { kind: "agent-added", agent: agent("working") });
    const card = model.cards.get("a1")!;
    expect(card.attention).toBe(false);
    expect(card.attention).toBe(stateNeedsAttention("working"));
  });
});
