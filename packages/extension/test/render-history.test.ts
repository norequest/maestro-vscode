import { describe, expect, it } from "vitest";
import { renderHistory } from "../src/render-history.js";
import { renderBoard } from "../src/render.js";
import type { CardVM, CockpitState } from "@hallucinate/cockpit";

/**
 * One in-session history row, derived structurally from the already-exported
 * `CockpitState` (mirrors render.ts's `AttentionVM` pattern), so the fixture
 * stays in lockstep with the contract.
 */
type HistoryItem = NonNullable<CockpitState["history"]>[number];

function entry(over: Partial<HistoryItem>): HistoryItem {
  return { seq: 1, at: 1000, kind: "agent-added", label: "Agent added", ...over };
}

/** A minimal board card; only the id matters for history focus-gating. */
function card(over: Partial<CardVM>): CardVM {
  return {
    id: "a1",
    roleName: "Implementer",
    engineId: "copilot",
    state: "working",
    output: "",
    attention: false,
    lane: "working",
    taskDescription: "do it",
    ...over,
  };
}

/** A minimal CockpitState carrying the history under test (and any present cards). */
function stateWith(history?: HistoryItem[], cards: CardVM[] = []): CockpitState {
  return { cards, delegations: [], history };
}

describe("renderHistory (M10 Phase F: in-session activity history)", () => {
  it("renders both entry labels in the SAME order given (does not re-sort)", () => {
    // The list arrives already newest-first (selectHistory reversed it), so the
    // render must keep it as-is: the first given entry appears before the second.
    const html = renderHistory(
      stateWith([
        entry({ seq: 2, label: "Second event" }),
        entry({ seq: 1, label: "First event" }),
      ]),
    );
    expect(html).toContain("Second event");
    expect(html).toContain("First event");
    expect(html.indexOf("Second event")).toBeLessThan(html.indexOf("First event"));
  });

  it("an entry whose agent is STILL on the board renders a focusable <button type=button> with data-id", () => {
    const html = renderHistory(
      stateWith([entry({ seq: 1, label: "with agent", agentId: "a1" })], [card({ id: "a1" })]),
    );
    // Keyboard-reachable: a real button, not a plain div with cursor:pointer.
    expect(html).toMatch(/<button class="history-entry history-focusable" type="button"/);
    expect(html).toContain('data-id="a1"');
  });

  it("an entry whose agent already LEFT the board is a non-focusable row with no data-id (no dead focus)", () => {
    // The card auto-left the board (merged/discarded), so a click could not jump to
    // it. Such an entry must render inert: a plain div, no focus hook, no data-id.
    const html = renderHistory(
      stateWith([entry({ seq: 1, label: "merged away", agentId: "gone" })], [card({ id: "a1" })]),
    );
    expect(html).toContain('<div class="history-entry" data-seq="1">');
    expect(html).not.toContain("history-focusable");
    expect(html).not.toContain('data-id="gone"');
  });

  it("an entry WITHOUT an agentId is a non-focusable div even when cards are present", () => {
    const html = renderHistory(stateWith([entry({ seq: 1, label: "no agent" })], [card({ id: "a1" })]));
    expect(html).toContain('<div class="history-entry" data-seq="1">');
    expect(html).not.toContain("history-focusable");
  });

  it("marks exactly the present-agent entries focusable when both kinds are mixed", () => {
    const html = renderHistory(
      stateWith(
        [
          entry({ seq: 3, label: "present", agentId: "a1" }),
          entry({ seq: 2, label: "left", agentId: "gone" }),
          entry({ seq: 1, label: "no agent" }),
        ],
        [card({ id: "a1" })],
      ),
    );
    // Only the one whose agent is on the board is focusable.
    expect((html.match(/history-focusable/g) ?? []).length).toBe(1);
    expect(html).toContain('data-id="a1"');
  });

  it("empty history renders the placeholder and no entry rows", () => {
    const html = renderHistory(stateWith([]));
    expect(html).toContain("history-empty");
    expect(html).not.toContain("history-entry");
  });

  it("undefined history renders the placeholder and no entry rows", () => {
    const html = renderHistory(stateWith(undefined));
    expect(html).toContain("history-empty");
    expect(html).not.toContain("history-entry");
  });

  it("escapes an entry label that carries markup (never interpolated raw)", () => {
    const html = renderHistory(stateWith([entry({ label: "<script>alert(1)</script>" })]));
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("renders a close/back button that posts close-history", () => {
    const html = renderHistory(stateWith([]));
    expect(html).toContain('data-action="close-history"');
  });
});

describe("renderBoard ([History] nav button)", () => {
  it("the board chrome contains a [History] button posting open-history", () => {
    const html = renderBoard({ cards: [], delegations: [] });
    expect(html).toContain('data-action="open-history"');
  });
});
