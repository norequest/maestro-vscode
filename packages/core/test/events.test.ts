import { describe, expect, it } from "vitest";
import { isTerminalState } from "../src/events.js";

describe("isTerminalState", () => {
  it("treats done, error, stopped, merged, discarded as terminal", () => {
    expect(isTerminalState("done")).toBe(true);
    expect(isTerminalState("error")).toBe(true);
    expect(isTerminalState("stopped")).toBe(true);
    expect(isTerminalState("merged")).toBe(true);
    expect(isTerminalState("discarded")).toBe(true);
  });

  it("treats preparing, working, awaiting-approval as non-terminal", () => {
    expect(isTerminalState("preparing")).toBe(false);
    expect(isTerminalState("working")).toBe(false);
    expect(isTerminalState("awaiting-approval")).toBe(false);
  });

  it("treats conflict as non-terminal (it is resolvable)", () => {
    expect(isTerminalState("conflict")).toBe(false);
  });
});
