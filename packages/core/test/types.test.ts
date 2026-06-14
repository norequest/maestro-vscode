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
