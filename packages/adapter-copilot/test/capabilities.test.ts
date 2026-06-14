import { describe, expect, it } from "vitest";
import { COPILOT_CAPABILITIES, capabilitiesFor } from "../src/capabilities.js";

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

describe("capabilitiesFor", () => {
  it("text mode equals the shared default and reports no structured events", () => {
    expect(capabilitiesFor("text")).toEqual(COPILOT_CAPABILITIES);
    expect(capabilitiesFor("text").structuredEvents).toBe(false);
  });

  it("json mode advertises structured events but never approvals or steering", () => {
    expect(capabilitiesFor("json")).toEqual({
      streaming: true,
      structuredEvents: true,
      approvals: false,
      steerable: false,
    });
  });

  it("does not mutate the shared default object", () => {
    capabilitiesFor("json");
    expect(COPILOT_CAPABILITIES.structuredEvents).toBe(false);
  });
});
