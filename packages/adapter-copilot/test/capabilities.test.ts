import { describe, expect, it } from "vitest";
import { COPILOT_CAPABILITIES } from "../src/capabilities.js";

describe("COPILOT_CAPABILITIES", () => {
  it("reports streaming only (no structured events, approvals, or steering in v1)", () => {
    expect(COPILOT_CAPABILITIES).toEqual({
      streaming: true,
      structuredEvents: false,
      approvals: false,
      steerable: false,
    });
  });
});
