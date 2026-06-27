import { describe, expect, it } from "vitest";
import { nextAttentionIndex } from "../src/attention-cycle.js";

describe("nextAttentionIndex (M10 Phase C: attention bar auto-advance)", () => {
  it("cycles 0 -> 1 -> 2 -> 0 for a queue of length 3", () => {
    expect(nextAttentionIndex(0, 3)).toBe(1);
    expect(nextAttentionIndex(1, 3)).toBe(2);
    expect(nextAttentionIndex(2, 3)).toBe(0);
  });

  it("returns 0 for an empty queue (length 0)", () => {
    expect(nextAttentionIndex(0, 0)).toBe(0);
    expect(nextAttentionIndex(5, 0)).toBe(0);
  });

  it("returns 0 for a single-item queue (length 1)", () => {
    expect(nextAttentionIndex(0, 1)).toBe(0);
    expect(nextAttentionIndex(3, 1)).toBe(0);
  });
});
