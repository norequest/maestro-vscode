/**
 * Pure render-gating decisions for the single-page webview router. The webview
 * re-renders on EVERY streamed orchestrator event (high-frequency output ticks
 * included), so two live views need a stable-signature guard so a tick does not
 * undo client-side state:
 *
 *  - Regression A: the board's attention bar. A fresh `renderBoard` always emits
 *    the bar at index 0, so the 4500ms auto-advance ticker would be snapped back
 *    to item 1 on every output tick. `nextIndexForRender` preserves the ticker's
 *    index across re-renders WHEN the attention queue is unchanged.
 *  - Regression B: the live History view. An output tick records no history
 *    entry, yet a re-render rebuilds the whole timeline and drops keyboard focus.
 *    `historyChanged` lets the `state` listener skip the redundant re-render.
 *
 * Kept DOM-free and structurally typed (only the fields each rule reads) so the
 * decisions are unit-tested directly and the app-main glue stays thin.
 */

/** A stable signature of the attention queue: its item ids, in order, joined.
 *  Same signature == same items in the same order, so the bar's index is safe to
 *  preserve across a re-render. */
export function attentionQueueSignature(queue: readonly { id: string }[]): string {
  return queue.map((item) => item.id).join("\n");
}

/**
 * The attention-bar index to use for a fresh board render, plus the queue's new
 * signature. When the queue is UNCHANGED since the last render (matching prior
 * signature) the operator's place in the auto-advance cycle is preserved, clamped
 * into the queue length as a defensive bound. Otherwise (first render, real queue
 * change, or empty queue) the bar resets to the most-urgent item, index 0.
 */
export function nextIndexForRender(
  prevIndex: number,
  prevSig: string | undefined,
  queue: readonly { id: string }[],
): { index: number; signature: string } {
  const signature = attentionQueueSignature(queue);
  if (prevSig === undefined || prevSig !== signature || queue.length === 0) {
    return { index: 0, signature };
  }
  // Unchanged queue: keep the current index, clamped to [0, length - 1].
  const clamped = Math.min(Math.max(prevIndex, 0), queue.length - 1);
  return { index: clamped, signature };
}

/**
 * A cheap signature of the in-session history: the entry count plus the last
 * entry's monotonic `seq`. It changes whenever a new event is folded (the count
 * grows, or, once the bounded ring is at cap, the oldest rolls off and the last
 * seq advances) and is otherwise stable. Empty history is the sentinel "0:0".
 */
export function historySignature(history: readonly { seq: number }[]): string {
  if (history.length === 0) return "0:0";
  const last = history[history.length - 1]!;
  return `${history.length}:${last.seq}`;
}

/** True when the history actually changed since `prevSig` was taken. Lets the
 *  live `state` listener skip re-rendering the History view on output ticks. */
export function historyChanged(
  prevSig: string | undefined,
  history: readonly { seq: number }[],
): boolean {
  return prevSig !== historySignature(history);
}
