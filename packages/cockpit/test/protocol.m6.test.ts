import { describe, it, expect } from "vitest";
import type { CardVM, WebviewToHost } from "../src/protocol.js";

describe("protocol M6 additions", () => {
  it("CardVM accepts approvalDetail + engineCapabilities", () => {
    const card: CardVM = {
      id: "a1",
      roleName: "Dev",
      engineId: "acp",
      state: "awaiting-approval",
      output: "",
      attention: true,
      pendingApprovalId: "req-1",
      approvalDetail: { tool: "bash", description: "Run: npm test" },
      engineCapabilities: { approvals: true, steerable: true },
    };
    expect(card.approvalDetail?.tool).toBe("bash");
    expect(card.approvalDetail?.description).toBe("Run: npm test");
    expect(card.engineCapabilities?.steerable).toBe(true);
  });

  it("WebviewToHost accepts a sendBack message", () => {
    const msg: WebviewToHost = { type: "sendBack", agentId: "a1", feedback: "try again" };
    expect(msg.type).toBe("sendBack");
  });
});
