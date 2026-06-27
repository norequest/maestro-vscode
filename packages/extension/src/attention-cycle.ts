/**
 * The pure cycling decision for the attention bar's auto-advance ticker.
 *
 * Given the CURRENT index and the queue LENGTH, return the next index to show.
 * It wraps via modulo so it never points past the end, and returns 0 for an
 * empty or single-item queue (there is nothing to advance through). Kept pure and
 * DOM-free so the webview's ticker glue stays thin and this rule is unit-tested
 * directly. A negative `current` is normalised, so any monotonic counter is safe.
 */
export function nextAttentionIndex(current: number, length: number): number {
  if (length <= 1) return 0;
  return (((current + 1) % length) + length) % length;
}
