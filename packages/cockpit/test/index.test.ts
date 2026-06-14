import { describe, expect, it } from "vitest";
import { MAESTRO_COCKPIT_VERSION } from "../src/index.js";

describe("@maestro/cockpit", () => {
  it("exposes a version", () => {
    expect(MAESTRO_COCKPIT_VERSION).toBe("0.0.0");
  });
});
