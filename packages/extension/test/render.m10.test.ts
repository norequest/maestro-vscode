import { describe, expect, it } from "vitest";
import { renderBoard, renderDrawer } from "../src/render.js";
import type { CardVM, CockpitState } from "@hallucinate/cockpit";

function card(overrides: Partial<CardVM>): CardVM {
  return {
    id: "a1",
    roleName: "Implementer",
    engineId: "copilot",
    state: "working",
    output: "",
    attention: false,
    lane: "working",
    taskDescription: "do it",
    ...overrides,
  };
}

/**
 * Compose the board view exactly as the webview client does
 * (`renderBoardView`: `root.innerHTML = renderBoard(state) + renderDrawer(state)`),
 * so these assertions read the same markup the panel renders.
 */
function boardView(state: CockpitState): string {
  return `${renderBoard(state)}${renderDrawer(state)}`;
}

describe("renderBoard + renderDrawer (M10: docked, non-modal inspector)", () => {
  it("focused board does not render a full-screen scrim", () => {
    // Focusing an agent must NOT dim the whole board behind a modal scrim. The
    // inspector docks beside the board instead, so no `.drawer-scrim` element.
    const html = boardView({
      cards: [card({ id: "a1", roleName: "Implementer", lane: "working" })],
      focusedId: "a1",
      delegations: [],
    });
    expect(html).not.toContain("drawer-scrim");
    // The inspector itself still renders for the focused agent.
    expect(html).toContain('class="drawer"');
  });

  it("focusing an agent does not hide the other agents (board stays visible alongside the inspector)", () => {
    // Two agents, one focused. The board must still render the OTHER agent's card
    // so N agents can be watched while one is inspected. The non-focused role name
    // appears only via the board (the drawer renders the focused agent alone), so
    // its presence proves the board renders alongside the docked inspector.
    const html = boardView({
      cards: [
        card({ id: "a1", roleName: "Implementer", lane: "working" }),
        card({ id: "a2", roleName: "Reviewer", lane: "working" }),
      ],
      focusedId: "a1",
      delegations: [],
    });
    // The focused agent's inspector is present.
    expect(html).toContain('class="drawer"');
    // The OTHER agent's identifying markup is still on the board.
    expect(html).toContain("Reviewer");
    expect(html).toContain('data-id="a2"');
    // And nothing dims/hides the board: no modal scrim.
    expect(html).not.toContain("drawer-scrim");
  });

  it("the docked inspector keeps a working close affordance (× posts close-drawer)", () => {
    // With the scrim gone, the header close button is the close path. It must
    // still carry the existing close-drawer action (no new host message).
    const html = renderDrawer({
      cards: [card({ id: "a1", lane: "working" })],
      focusedId: "a1",
      delegations: [],
    });
    expect(html).toContain('data-action="close-drawer"');
    expect(html).toContain('class="drawer-close"');
  });
});

describe("renderBoard (M10 Phase B: live activity tail on the working card)", () => {
  /** Render a single card onto the board and return its markup. */
  function boardWith(overrides: Partial<CardVM>): string {
    return renderBoard({ cards: [card(overrides)], delegations: [] });
  }

  it("a working card renders each tail line in a tail block", () => {
    const html = boardWith({
      lane: "working",
      state: "working",
      tail: ["> edit login.ts", "> tsc --noEmit"],
    });
    // The tail block marker is present, and both streamed lines show.
    expect(html).toContain("card-tail");
    expect(html).toContain("&gt; edit login.ts");
    expect(html).toContain("&gt; tsc --noEmit");
  });

  it("escapes engine-supplied tail text (never interpolated raw)", () => {
    const html = boardWith({
      lane: "working",
      state: "working",
      tail: ["<script>alert(1)</script>"],
    });
    // The raw tag must never reach the markup; only its escaped form.
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("renders NO tail block when the tail is empty", () => {
    const empty = boardWith({ lane: "working", state: "working", tail: [] });
    expect(empty).not.toContain("card-tail");
  });

  it("renders NO tail block when the tail is undefined", () => {
    const none = boardWith({ lane: "working", state: "working", tail: undefined });
    expect(none).not.toContain("card-tail");
  });

  it("renders NO tail block on non-working cards (done / awaiting-approval)", () => {
    // The tail is a live-activity affordance for working cards only.
    const done = boardWith({
      lane: "done",
      state: "done",
      tail: ["> still has old output"],
    });
    expect(done).not.toContain("card-tail");

    const blocked = boardWith({
      lane: "needsYou",
      state: "awaiting-approval",
      tail: ["> waiting on you"],
    });
    expect(blocked).not.toContain("card-tail");
  });

  it("defensively caps the tail at 3 lines even if more are supplied", () => {
    const html = boardWith({
      lane: "working",
      state: "working",
      tail: ["l1", "l2", "l3", "l4", "l5"],
    });
    const count = (html.match(/class="tail-line"/g) ?? []).length;
    expect(count).toBe(3);
    // The overflow lines past the cap are dropped.
    expect(html).not.toContain(">l4<");
    expect(html).not.toContain(">l5<");
  });
});
