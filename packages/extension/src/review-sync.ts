import type { CardVM } from "@hallucinate/cockpit";

/**
 * What the host should do to keep an open in-page review in sync after board
 * state changes, keyed off the id of the card the user last opened for review:
 *   - "repost"        the reviewed card is still present, re-post it so its
 *                     decision bar reflects the new state (done -> conflict
 *                     after a Merge that conflicts, etc.),
 *   - "navigate-board" the reviewed card was resolved away (Discard removes it,
 *                     a clean Merge into main removes it), so the full-page
 *                     review can no longer show anything: return to the board,
 *   - "none"          nothing is being reviewed.
 *
 * Pure so the host's review-sync decision is unit-testable. Without this, a
 * Discard (or a clean Merge) from the review surface left the user frozen on the
 * now-gone card: the host cleared the id but never navigated back.
 */
export type ReviewSyncAction = "repost" | "navigate-board" | "none";

export function reviewSyncAction(
  lastReviewedId: string | undefined,
  cards: readonly CardVM[],
): ReviewSyncAction {
  if (lastReviewedId === undefined) return "none";
  return cards.some((c) => c.id === lastReviewedId) ? "repost" : "navigate-board";
}
