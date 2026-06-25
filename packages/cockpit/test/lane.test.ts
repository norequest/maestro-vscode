import { describe, expect, it } from "vitest";
import type { AgentState } from "@maestro/core";
import { laneFor, type Lane } from "../src/lane.js";

const EXPECTED: Record<AgentState, Lane> = {
  preparing: "working", working: "working",
  "awaiting-approval": "needsYou", error: "needsYou", detached: "needsYou", "merge-cleanup-failed": "needsYou",
  stopped: "needsYou",
  conflict: "conflict",
  done: "done", merged: "done", discarded: "done", "pr-created": "done",
};

describe("laneFor", () => {
  it("maps every AgentState to its canonical lane", () => {
    for (const state of Object.keys(EXPECTED) as AgentState[]) {
      expect(laneFor(state)).toBe(EXPECTED[state]);
    }
  });
});
