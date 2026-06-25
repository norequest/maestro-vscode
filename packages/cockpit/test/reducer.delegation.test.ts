import { describe, expect, it } from "vitest";
import type { Agent, DelegationProposal, OrchestratorEvent } from "@maestro/core";
import { initialModel, reduce } from "../src/reducer.js";

function agent(over: Partial<Agent> = {}): Agent {
  const { task, ...rest } = over;
  return {
    id: "a1",
    task: { id: "t1", description: "do it", roleName: "Implementer", ...task },
    role: { name: "Implementer", instructions: "", engine: { id: "copilot" }, autonomy: "auto-approve-safe" },
    state: "preparing",
    log: [],
    ...rest,
  };
}

function proposal(over: Partial<DelegationProposal> = {}): DelegationProposal {
  return {
    id: "d1",
    leadAgentId: "lead-1",
    roleName: "coder",
    task: "implement the parser in src/parse.ts",
    state: "pending",
    ...over,
  };
}

const proposed = (p: DelegationProposal): OrchestratorEvent => ({ kind: "delegation-proposed", proposal: p });
const resolved = (p: DelegationProposal): OrchestratorEvent => ({ kind: "delegation-resolved", proposal: p });

describe("reduce: delegations", () => {
  it("delegation-proposed adds a pending DelegationVM (id/lead/role/task only)", () => {
    const m = reduce(initialModel(), proposed(proposal()));
    expect([...m.delegations.values()]).toEqual([
      { id: "d1", leadAgentId: "lead-1", roleName: "coder", task: "implement the parser in src/parse.ts" },
    ]);
  });

  it("a second distinct proposal appends in arrival order", () => {
    let m = reduce(initialModel(), proposed(proposal()));
    m = reduce(m, proposed(proposal({ id: "d2", roleName: "tester", task: "write tests for the parser" })));
    expect([...m.delegations.values()].map((d) => d.id)).toEqual(["d1", "d2"]);
  });

  it("delegation-resolved removes the proposal by id (approved or denied leaves pending)", () => {
    let m = reduce(initialModel(), proposed(proposal()));
    m = reduce(m, proposed(proposal({ id: "d2", roleName: "tester", task: "write tests" })));
    m = reduce(m, resolved(proposal({ id: "d1", state: "approved" })));
    expect([...m.delegations.values()].map((d) => d.id)).toEqual(["d2"]);
    m = reduce(m, resolved(proposal({ id: "d2", state: "denied" })));
    expect(m.delegations.size).toBe(0);
  });

  it("is pure: proposing does not mutate the input model", () => {
    const before = initialModel();
    reduce(before, proposed(proposal()));
    expect(before.delegations.size).toBe(0);
  });

  it("agent-added with parentId produces a CardVM carrying that parentId", () => {
    const m = reduce(initialModel(), { kind: "agent-added", agent: agent({ parentId: "lead-1" }) });
    expect(m.cards.get("a1")!.parentId).toBe("lead-1");
  });

  it("agent-added without a parent leaves parentId undefined", () => {
    const m = reduce(initialModel(), { kind: "agent-added", agent: agent() });
    expect(m.cards.get("a1")!.parentId).toBeUndefined();
  });
});
