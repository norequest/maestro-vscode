import { describe, expect, it } from "vitest";
import type { CardVM } from "@hallucinate/cockpit";
import { reviewSyncAction } from "../src/review-sync.js";

/** A minimal CardVM stub; only `id` matters to reviewSyncAction. */
function card(id: string): CardVM {
  return { id } as unknown as CardVM;
}

describe("reviewSyncAction", () => {
  it("does nothing when no card is being reviewed", () => {
    expect(reviewSyncAction(undefined, [card("a"), card("b")])).toBe("none");
  });

  it("re-posts the review while the reviewed card is still present", () => {
    expect(reviewSyncAction("a", [card("a"), card("b")])).toBe("repost");
  });

  it("navigates back to the board when the reviewed card has been resolved away", () => {
    // The card the user was reviewing was discarded or merged into main, so it is
    // gone from board state: the full-page review can show nothing, return to board.
    expect(reviewSyncAction("a", [card("b"), card("c")])).toBe("navigate-board");
  });

  it("navigates back to the board when the board is now empty", () => {
    expect(reviewSyncAction("a", [])).toBe("navigate-board");
  });
});
