import { describe, expect, it } from "vitest";
import { initialModel, reduce } from "../src/reducer.js";
import type { Agent } from "@hallucinate/core";

describe("reducer M9: merge-cleanup-failed attention", () => {
  it("flags merge-cleanup-failed as attention", () => {
    const agent: Agent = {
      id: "a1",
      task: { id: "t1", description: "x", roleName: "R" },
      role: { name: "R", instructions: "", engine: { id: "fake" }, autonomy: "manual" },
      state: "merge-cleanup-failed",
      log: [],
    };
    const m = reduce(initialModel(), { kind: "agent-added", agent });
    expect(m.cards.get("a1")!.attention).toBe(true);
  });
});
