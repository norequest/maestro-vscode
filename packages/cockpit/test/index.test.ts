import { describe, expect, it } from "vitest";
import * as cockpit from "../src/index.js";

describe("@hallucinate/cockpit", () => {
  it("exposes a version", () => {
    expect(cockpit.HALLUCINATE_COCKPIT_VERSION).toBe("0.0.0");
  });
  it("exports the reducer + selector surface", () => {
    expect(typeof cockpit.initialModel).toBe("function");
    expect(typeof cockpit.reduce).toBe("function");
    expect(typeof cockpit.setFocus).toBe("function");
    expect(typeof cockpit.selectState).toBe("function");
    expect(cockpit.OUTPUT_CAP).toBe(16000);
  });
});
