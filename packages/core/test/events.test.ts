import { describe, expect, it } from "vitest";
import { isTerminalState, isDiscardableState, stateNeedsAttention } from "../src/events.js";
import type { AgentState } from "../src/types.js";

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

  it("treats detached as terminal", () => {
    expect(isTerminalState("detached")).toBe(true);
  });

  it("keeps conflict NON-terminal", () => {
    expect(isTerminalState("conflict")).toBe(false);
  });
});

// ---- T8: single source of truth for AgentState policy ----
// Enumerate EVERY AgentState through each predicate to lock the policy. If a new
// state is added to AgentState, the exhaustive Records in events.ts force a
// compile decision, and this list (kept in sync) documents the expected answers.
const ALL_STATES: AgentState[] = [
  "preparing",
  "working",
  "awaiting-approval",
  "done",
  "error",
  "stopped",
  "merged",
  "discarded",
  "conflict",
  "detached",
  "merge-cleanup-failed",
];

describe("AgentState policy predicates (exhaustive)", () => {
  it("covers every AgentState member in the enumeration", () => {
    // 11 states today; a bare count guard so the table below stays exhaustive.
    expect(ALL_STATES).toHaveLength(11);
    expect(new Set(ALL_STATES).size).toBe(ALL_STATES.length);
  });

  const terminal: Record<AgentState, boolean> = {
    preparing: false,
    working: false,
    "awaiting-approval": false,
    done: true,
    error: true,
    stopped: true,
    merged: true,
    discarded: true,
    conflict: false,
    detached: true,
    "merge-cleanup-failed": true,
  };
  const discardable: Record<AgentState, boolean> = {
    preparing: false,
    working: false,
    "awaiting-approval": false,
    done: true,
    error: true,
    stopped: true,
    merged: false,
    discarded: false,
    conflict: true,
    detached: true,
    "merge-cleanup-failed": true,
  };
  const attention: Record<AgentState, boolean> = {
    preparing: false,
    working: false,
    "awaiting-approval": true,
    done: true,
    error: true,
    stopped: false,
    merged: false,
    discarded: false,
    conflict: true,
    detached: true,
    "merge-cleanup-failed": true,
  };

  for (const state of ALL_STATES) {
    it(`isTerminalState(${state}) === ${terminal[state]}`, () => {
      expect(isTerminalState(state)).toBe(terminal[state]);
    });
    it(`isDiscardableState(${state}) === ${discardable[state]}`, () => {
      expect(isDiscardableState(state)).toBe(discardable[state]);
    });
    it(`stateNeedsAttention(${state}) === ${attention[state]}`, () => {
      expect(stateNeedsAttention(state)).toBe(attention[state]);
    });
  }
});
