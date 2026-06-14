import { describe, expect, it } from "vitest";
import * as adapter from "../src/index.js";

describe("public API", () => {
  it("exports the adapter and helpers", () => {
    expect(typeof adapter.CopilotAdapter).toBe("function");
    expect(typeof adapter.buildArgs).toBe("function");
    expect(typeof adapter.resolveAuth).toBe("function");
  });
});
