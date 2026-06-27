import { describe, expect, it } from "vitest";
import {
  attentionQueueSignature,
  nextIndexForRender,
  historySignature,
  historyChanged,
} from "../src/render-gate.js";

describe("attentionQueueSignature (regression A: stable queue identity)", () => {
  it("is the item ids in order", () => {
    expect(attentionQueueSignature([{ id: "a" }, { id: "b" }, { id: "c" }])).toBe(
      attentionQueueSignature([{ id: "a" }, { id: "b" }, { id: "c" }]),
    );
  });

  it("differs when the order changes", () => {
    expect(attentionQueueSignature([{ id: "a" }, { id: "b" }])).not.toBe(
      attentionQueueSignature([{ id: "b" }, { id: "a" }]),
    );
  });

  it("differs when an item is added or removed", () => {
    expect(attentionQueueSignature([{ id: "a" }, { id: "b" }])).not.toBe(
      attentionQueueSignature([{ id: "a" }]),
    );
  });

  it("is the empty string for an empty queue", () => {
    expect(attentionQueueSignature([])).toBe("");
  });
});

describe("nextIndexForRender (regression A: preserve attention index across board re-renders)", () => {
  const queue3 = [{ id: "a" }, { id: "b" }, { id: "c" }];

  it("preserves the current index when the queue is unchanged", () => {
    const sig = attentionQueueSignature(queue3);
    expect(nextIndexForRender(2, sig, queue3)).toEqual({ index: 2, signature: sig });
  });

  it("resets to 0 when the queue changed", () => {
    const prevSig = attentionQueueSignature([{ id: "a" }, { id: "b" }]);
    const r = nextIndexForRender(1, prevSig, queue3);
    expect(r.index).toBe(0);
    expect(r.signature).toBe(attentionQueueSignature(queue3));
  });

  it("resets to 0 on the first render (no prior signature)", () => {
    expect(nextIndexForRender(2, undefined, queue3).index).toBe(0);
  });

  it("clamps a now-out-of-range index into the queue length", () => {
    const queue2 = [{ id: "a" }, { id: "b" }];
    const sig = attentionQueueSignature(queue2);
    // The index was 5 (e.g. a stale ticker value); clamp to the last valid slot.
    expect(nextIndexForRender(5, sig, queue2).index).toBe(1);
  });

  it("normalises a negative index to 0", () => {
    const sig = attentionQueueSignature(queue3);
    expect(nextIndexForRender(-3, sig, queue3).index).toBe(0);
  });

  it("returns index 0 for an empty queue", () => {
    expect(nextIndexForRender(3, "", []).index).toBe(0);
  });
});

describe("historySignature / historyChanged (regression B: gate the live history re-render)", () => {
  it("is stable for an unchanged list", () => {
    const history = [{ seq: 3 }, { seq: 2 }, { seq: 1 }];
    expect(historySignature(history)).toBe(historySignature([{ seq: 3 }, { seq: 2 }, { seq: 1 }]));
  });

  it("changes when a new entry grows the list", () => {
    const before = [{ seq: 2 }, { seq: 1 }];
    const after = [{ seq: 3 }, { seq: 2 }, { seq: 1 }];
    expect(historySignature(before)).not.toBe(historySignature(after));
  });

  it("changes when the seq advances at a fixed length (ring at cap)", () => {
    // Newest-first, bounded ring: same length, but the oldest rolled off so the
    // last (oldest) entry's seq advanced.
    const before = [{ seq: 2 }, { seq: 1 }];
    const after = [{ seq: 3 }, { seq: 2 }];
    expect(historySignature(before)).not.toBe(historySignature(after));
  });

  it("is '0:0' for an empty history", () => {
    expect(historySignature([])).toBe("0:0");
  });

  it("historyChanged is false against the matching signature", () => {
    const history = [{ seq: 5 }, { seq: 4 }];
    expect(historyChanged(historySignature(history), history)).toBe(false);
  });

  it("historyChanged is true against an undefined or stale signature", () => {
    const history = [{ seq: 5 }, { seq: 4 }];
    expect(historyChanged(undefined, history)).toBe(true);
    expect(historyChanged("1:1", history)).toBe(true);
  });
});
