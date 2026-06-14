import { describe, it, expect } from "vitest";
import { renderCardHTML } from "../src/render.js";
import type { CardVM } from "@maestro/cockpit";

function baseCard(overrides: Partial<CardVM> = {}): CardVM {
  return {
    id: "a1",
    roleName: "Dev",
    engineId: "acp",
    state: "working",
    output: "",
    attention: false,
    ...overrides,
  };
}

describe("render.ts M6: approval panel", () => {
  it("renders approve/deny buttons when awaiting-approval and approvals capable", () => {
    const html = renderCardHTML(baseCard({
      state: "awaiting-approval",
      pendingApprovalId: "req-1",
      engineCapabilities: { approvals: true, steerable: false },
      attention: true,
    }));
    expect(html).toContain('data-action="approve"');
    expect(html).toContain('data-action="deny"');
    expect(html).toContain('data-approval-id="req-1"');
  });

  it("renders approval detail (tool + description)", () => {
    const html = renderCardHTML(baseCard({
      state: "awaiting-approval",
      pendingApprovalId: "req-1",
      approvalDetail: { tool: "bash", description: "Run: npm test" },
      engineCapabilities: { approvals: true, steerable: false },
      attention: true,
    }));
    expect(html).toContain("bash");
    expect(html).toContain("Run: npm test");
  });

  it("escapes XSS in approval detail", () => {
    const html = renderCardHTML(baseCard({
      state: "awaiting-approval",
      pendingApprovalId: "req-1",
      approvalDetail: { tool: "<script>", description: "alert('xss')" },
      engineCapabilities: { approvals: true, steerable: false },
      attention: true,
    }));
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("does NOT render approve/deny when engineCapabilities.approvals is false", () => {
    const html = renderCardHTML(baseCard({
      state: "awaiting-approval",
      pendingApprovalId: "req-1",
      engineCapabilities: { approvals: false, steerable: false },
      attention: true,
    }));
    expect(html).not.toContain('data-action="approve"');
    expect(html).not.toContain('data-action="deny"');
  });
});

describe("render.ts M6: steering input", () => {
  it("renders a steer form when steerable and working", () => {
    const html = renderCardHTML(baseCard({
      state: "working",
      engineCapabilities: { approvals: false, steerable: true },
    }));
    expect(html).toContain('data-action="steer"');
    expect(html).toContain("<input");
  });

  it("does NOT render a steer form when steerable is false", () => {
    const html = renderCardHTML(baseCard({
      state: "working",
      engineCapabilities: { approvals: false, steerable: false },
    }));
    expect(html).not.toContain('data-action="steer"');
  });

  it("renders a steer form when awaiting-approval and steerable", () => {
    const html = renderCardHTML(baseCard({
      state: "awaiting-approval",
      pendingApprovalId: "req-1",
      engineCapabilities: { approvals: true, steerable: true },
      attention: true,
    }));
    expect(html).toContain('data-action="steer"');
  });
});

describe("render.ts M6: send-back box", () => {
  it("renders a send-back form on a done card", () => {
    const html = renderCardHTML(baseCard({ state: "done", summary: "All done", attention: true }));
    expect(html).toContain('data-action="sendBack"');
    expect(html).toContain("<textarea");
  });

  it("renders a send-back form on a conflict card", () => {
    const html = renderCardHTML(baseCard({ state: "conflict", conflictFiles: ["src/foo.ts"], attention: true }));
    expect(html).toContain('data-action="sendBack"');
    expect(html).toContain("<textarea");
  });

  it("does NOT render a send-back form on a working card", () => {
    const html = renderCardHTML(baseCard({ state: "working" }));
    expect(html).not.toContain('data-action="sendBack"');
  });
});
