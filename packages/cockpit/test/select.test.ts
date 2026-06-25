import { describe, expect, it } from "vitest";
import type { Agent, OrchestratorEvent } from "@maestro/core";
import { initialModel, reduce } from "../src/reducer.js";
import { selectState } from "../src/select.js";

function agent(id: string, state: Agent["state"]): Agent {
  return {
    id, task: { id: `t-${id}`, description: "x", roleName: "Implementer" },
    role: { name: "Implementer", instructions: "", engine: { id: "copilot" }, autonomy: "auto-approve-safe" },
    state, log: [],
  };
}
const add = (a: Agent): OrchestratorEvent => ({ kind: "agent-added", agent: a });

describe("selectState", () => {
  it("floats attention cards to the top, stable by id otherwise", () => {
    let m = initialModel();
    m = reduce(m, add(agent("a3", "working")));
    m = reduce(m, add(agent("a1", "done")));     // attention
    m = reduce(m, add(agent("a2", "working")));
    const ids = selectState(m).cards.map((c) => c.id);
    expect(ids).toEqual(["a1", "a2", "a3"]); // a1 (attention) first; then a2,a3 by id
  });

  it("passes focusedId through", () => {
    const m = reduce(initialModel(), add(agent("a1", "working")));
    expect(selectState({ ...m, focusedId: "a1" }).focusedId).toBe("a1");
  });

  it("includes an empty delegations array when none are pending (both branches)", () => {
    const m = reduce(initialModel(), add(agent("a1", "working")));
    expect(selectState(m).delegations).toEqual([]);
    expect(selectState({ ...m, focusedId: "a1" }).delegations).toEqual([]);
  });

  it("keeps id-stable order inside the done lane", () => {
    // Resolved states (merged/discarded/pr-created) auto-leave the model, so the
    // only residents of the done lane are ready-to-review `done` cards. They all
    // carry attention=true, so ordering inside the lane is purely id-stable.
    let m = initialModel();
    m = reduce(m, add(agent("a3", "done")));
    m = reduce(m, add(agent("a1", "done")));
    m = reduce(m, add(agent("a2", "done")));
    const doneLane = selectState(m).cards.filter((c) => c.lane === "done").map((c) => c.id);
    expect(doneLane).toEqual(["a1", "a2", "a3"]);
  });

  it("puts every card in a lane derived from its state", () => {
    let m = initialModel();
    m = reduce(m, add(agent("w", "working")));
    m = reduce(m, add(agent("n", "awaiting-approval")));
    m = reduce(m, add(agent("c", "conflict")));
    const byId = new Map(selectState(m).cards.map((c) => [c.id, c.lane]));
    expect(byId.get("w")).toBe("working");
    expect(byId.get("n")).toBe("needsYou");
    expect(byId.get("c")).toBe("conflict");
  });
});
