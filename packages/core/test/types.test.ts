import { describe, it, expect } from "vitest";
import type { ApprovalDetail, Agent } from "../src/types.js";

describe("ApprovalDetail", () => {
  it("is assignable to Agent.approvalDetail (tool + description)", () => {
    const detail: ApprovalDetail = { tool: "bash", description: "Run: npm test" };
    const partial: Pick<Agent, "approvalDetail"> = { approvalDetail: detail };
    expect(partial.approvalDetail?.tool).toBe("bash");
    expect(partial.approvalDetail?.description).toBe("Run: npm test");
  });

  it("is optional on Agent", () => {
    const partial: Pick<Agent, "approvalDetail"> = {};
    expect(partial.approvalDetail).toBeUndefined();
  });
});

import { describe as describeStates, it as itStates, expect as expectStates } from "vitest";
import type { AgentState as AgentStateT, PersistedAgentRecord, Agent as AgentT } from "../src/types.js";

describeStates("M7 types", () => {
  itStates("AgentState includes detached", () => {
    const s: AgentStateT = "detached";
    expectStates(s).toBe("detached");
  });
  itStates("PersistedAgentRecord wraps an Agent snapshot", () => {
    const agent = {
      id: "a1",
      task: { id: "t1", description: "x", roleName: "R" },
      role: { name: "R", instructions: "", engine: { id: "fake" }, autonomy: "manual" as const },
      state: "done" as AgentStateT,
      log: [],
    } satisfies AgentT;
    const rec: PersistedAgentRecord = { agent, workspacePath: "/wt/a1", workspaceBranch: "agent/a1" };
    expectStates(rec.agent.id).toBe("a1");
  });
});
