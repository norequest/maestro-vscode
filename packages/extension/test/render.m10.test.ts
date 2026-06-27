import { describe, expect, it } from "vitest";
import { renderBoard, renderFloor, renderDrawer, renderAttentionBar } from "../src/render.js";
import type { CardVM, CockpitState, FloorTileVM } from "@hallucinate/cockpit";

/** The attention-queue item type, derived from the already-exported CockpitState. */
type AttentionItem = NonNullable<CockpitState["attention"]>[number];

function attn(overrides: Partial<AttentionItem>): AttentionItem {
  return {
    id: "a1",
    roleName: "Implementer",
    state: "awaiting-approval",
    kind: "approval",
    ...overrides,
  };
}

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
 * so these assertions read the same markup the panel renders. These docked-drawer
 * assertions read per-card markup off the board, so they use the column layout
 * (`{ groupByStatus: true }`): the default Floor only renders tiles the host put
 * in `state.floor`, which these card-only fixtures do not populate.
 */
function boardView(state: CockpitState): string {
  return `${renderBoard(state, { groupByStatus: true })}${renderDrawer(state)}`;
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
  /** Render a single card onto the board and return its markup. The tail block is
   *  per-card content, so render via the column layout: the default Floor only
   *  shows tiles present in `state.floor`, which this card-only fixture omits. */
  function boardWith(overrides: Partial<CardVM>): string {
    return renderBoard({ cards: [card(overrides)], delegations: [] }, { groupByStatus: true });
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

describe("renderAttentionBar (M10 Phase C: sticky attention bar)", () => {
  it("renders one approval item: role, label, '1 of 1', a focus region, and Allow/Deny actions", () => {
    const html = renderAttentionBar(
      [
        attn({
          id: "a1",
          roleName: "Implementer",
          kind: "approval",
          pendingApprovalId: "ap1",
          approvalDetail: { tool: "Edit", description: "write login.ts" },
        }),
      ],
      0,
    );
    // The role name and the derived label (tool from the approval detail) show.
    expect(html).toContain("Implementer");
    expect(html).toContain("Edit");
    // The "n of m" counter.
    expect(html).toContain("1 of 1");
    // A clickable focus region reusing the existing focus message.
    expect(html).toContain('data-action="focus"');
    // The inline primary action reuses the EXACT approve/deny verbs + ids.
    expect(html).toContain('data-action="approve"');
    expect(html).toContain('data-action="deny"');
    expect(html).toContain('data-approval-id="ap1"');
  });

  it("with three items, index 1 shows the SECOND item and '2 of 3'", () => {
    const items: AttentionItem[] = [
      attn({ id: "a1", roleName: "FirstAgent", kind: "conflict", state: "conflict" }),
      attn({ id: "a2", roleName: "SecondAgent", kind: "review", state: "done" }),
      attn({ id: "a3", roleName: "ThirdAgent", kind: "error", state: "error" }),
    ];
    const html = renderAttentionBar(items, 1);
    // Only the item at index 1 (the review item) is shown.
    expect(html).toContain("SecondAgent");
    expect(html).toContain("2 of 3");
    expect(html).toContain('data-id="a2"');
    // Its review primary action reuses the existing open-review verb.
    expect(html).toContain('data-action="open-review"');
    // The other items are NOT in the bar (one item at a time).
    expect(html).not.toContain("FirstAgent");
    expect(html).not.toContain("ThirdAgent");
  });

  it("renders NO bar when the attention queue is empty", () => {
    expect(renderAttentionBar([], 0)).toBe("");
  });

  it("escapes engine-supplied approval detail (never interpolated raw)", () => {
    const html = renderAttentionBar(
      [
        attn({
          kind: "approval",
          pendingApprovalId: "ap1",
          approvalDetail: { tool: "Run", description: "<script>alert(1)</script>" },
        }),
      ],
      0,
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("renderBoard / renderFloor (M10 Phase D: Floor is the default board layout)", () => {
  /** One Floor tile (size+warmth over a card resolved by id). */
  function tile(over: Partial<FloorTileVM> = {}): FloorTileVM {
    return { id: "a1", size: "md", warmth: "live", child: false, ...over };
  }

  it("renderFloor renders one size+warmth tile per floor entry, resolving each card by id", () => {
    const html = renderFloor({
      cards: [card({ id: "a1", roleName: "Implementer" }), card({ id: "a2", roleName: "Reviewer" })],
      delegations: [],
      floor: [tile({ id: "a1", size: "lg", warmth: "hot" }), tile({ id: "a2", size: "sm", warmth: "idle" })],
    });
    // The Floor container, plus one floor-tile per entry carrying the tile's
    // size + warmth straight from the contract (never recomputed here).
    expect(html).toContain('class="floor"');
    expect(html).toContain("floor-tile size-lg warmth-hot");
    expect(html).toContain("floor-tile size-sm warmth-idle");
    // Each tile wraps the card resolved by id.
    expect(html).toContain('data-id="a1"');
    expect(html).toContain('data-id="a2"');
  });

  it("renderFloor SKIPS a floor id with no matching card", () => {
    const html = renderFloor({
      cards: [card({ id: "a1" })],
      delegations: [],
      floor: [tile({ id: "a1" }), tile({ id: "ghost" })],
    });
    expect(html).toContain('data-id="a1"');
    expect(html).not.toContain('data-id="ghost"');
    // Exactly one tile is rendered (the resolvable one).
    expect((html.match(/class="floor-tile/g) ?? []).length).toBe(1);
  });

  it("renderFloor marks a child tile is-child on the WRAPPER only (no lane elbow/indent on the inner card)", () => {
    const html = renderFloor({
      cards: [card({ id: "lead1" }), card({ id: "kid1", parentId: "lead1" })],
      delegations: [],
      floor: [tile({ id: "lead1" }), tile({ id: "kid1", child: true })],
    });
    // The nesting cue lives ONLY on the floor-tile wrapper (margin + dashed
    // accent). The inner card must NOT carry is-child: in the Floor grid the lead
    // is on a different row, so the lane elbow connector would point at nothing
    // and the card would be indented twice (14px tile + 18px card). So is-child
    // appears exactly once: on the wrapper.
    expect(html).toContain("floor-tile size-md warmth-live is-child");
    expect((html.match(/is-child/g) ?? []).length).toBe(1);
  });

  it("renderFloor with an empty floor renders a quiet placeholder, never the lane columns", () => {
    const html = renderFloor({ cards: [card({ id: "a1" })], delegations: [], floor: [] });
    expect(html).toContain('class="floor floor-empty"');
    expect(html).toContain("No agents yet");
    expect(html).not.toContain('class="lanes"');
  });

  it("renderBoard with no opts renders the Floor (not the lane columns)", () => {
    const html = renderBoard({
      cards: [card({ id: "a1" })],
      delegations: [],
      floor: [tile({ id: "a1" })],
    });
    expect(html).toContain('class="floor"');
    expect(html).not.toContain('class="lanes"');
    expect(html).toContain('data-id="a1"');
  });

  it("renderBoard with { groupByStatus: true } renders the lane columns (not the Floor)", () => {
    const html = renderBoard(
      { cards: [card({ id: "a1", lane: "working" })], delegations: [], floor: [tile({ id: "a1" })] },
      { groupByStatus: true },
    );
    expect(html).toContain('class="lanes"');
    expect(html).toContain("lane-col-");
    expect(html).not.toContain('class="floor"');
  });

  it("renders the board-layout toggle as a radiogroup in BOTH layouts with aria-checked reflecting the active mode", () => {
    const state: CockpitState = {
      cards: [card({ id: "a1" })],
      delegations: [],
      floor: [tile({ id: "a1" })],
    };
    const floorHtml = renderBoard(state);
    // A mutually-exclusive switch: a radiogroup of two radios, not a button group.
    expect(floorHtml).toContain('role="radiogroup"');
    expect(floorHtml).toContain('role="radio"');
    expect(floorHtml).toContain('data-action="set-board-layout"');
    expect(floorHtml).toContain('data-layout="floor"');
    expect(floorHtml).toContain('data-layout="status"');
    // Floor is active: the Floor radio is checked, the status radio is not.
    expect(floorHtml).toMatch(/aria-checked="true"[^>]*data-layout="floor"/);
    expect(floorHtml).toMatch(/aria-checked="false"[^>]*data-layout="status"/);
    // The retired button-group ARIA pattern is gone.
    expect(floorHtml).not.toContain("aria-pressed");

    const statusHtml = renderBoard(state, { groupByStatus: true });
    expect(statusHtml).toContain('role="radiogroup"');
    // Group-by-status is active: the status radio is checked, the Floor radio is not.
    expect(statusHtml).toMatch(/aria-checked="true"[^>]*data-layout="status"/);
    expect(statusHtml).toMatch(/aria-checked="false"[^>]*data-layout="floor"/);
  });

  it("GOLDEN: the Group-by-status layout still renders Working / Needs you / Done and the folded needsYou count", () => {
    const cards: CardVM[] = [
      card({ id: "w1", lane: "working" }),
      card({ id: "n1", lane: "needsYou", state: "awaiting-approval", attention: true }),
      card({ id: "n2", lane: "needsYou", state: "error", attention: true }),
      card({ id: "c1", lane: "conflict", state: "conflict", attention: true }),
      card({ id: "d1", lane: "done", state: "merged" }),
    ];
    const html = renderBoard({ cards, delegations: [] }, { groupByStatus: true });
    expect(html).toContain("Working");
    expect(html).toContain("Needs you");
    expect(html).toContain("Done");
    // The Needs you column folds needsYou (2) + conflict (1) = 3, exactly as before.
    expect(html).toMatch(/lane-col-needsYou[\s\S]*?class="count">3</);
  });
});

describe("renderCardHTML (M10 Phase E: momentum 'growing' pulse on the working card)", () => {
  /** Render one card via the column layout (the default Floor only shows tiles in
   *  state.floor, which these card-only fixtures omit). */
  function boardWith(overrides: Partial<CardVM>): string {
    return renderBoard({ cards: [card(overrides)], delegations: [] }, { groupByStatus: true });
  }

  it("a working card WITH momentum renders the growing-pulse badge (+N)", () => {
    const html = boardWith({
      lane: "working",
      state: "working",
      momentum: { adds: 7, dels: 1, at: 0 },
    });
    // The growing-pulse marker is present, with the "+N" added-lines count.
    expect(html).toContain("card-momentum");
    expect(html).toContain("+7");
  });

  it("a working card with deletions-only momentum reflects the real growth (-N), never a bare +0", () => {
    // The reducer sets momentum {adds:0, dels:N} while a working agent is actively
    // DELETING lines (a normal refactor). A bare "+0" would misread as no growth;
    // the badge must show the real direction (-N) instead.
    const html = boardWith({
      lane: "working",
      state: "working",
      momentum: { adds: 0, dels: 5, at: 0 },
    });
    expect(html).toContain("card-momentum");
    expect(html).toContain("-5");
    expect(html).not.toContain("+0");
  });

  it("a working card WITHOUT momentum renders no growing-pulse badge", () => {
    const html = boardWith({ lane: "working", state: "working" });
    expect(html).not.toContain("card-momentum");
  });

  it("a non-working card WITH momentum renders no growing-pulse badge", () => {
    // momentum is a working-lane affordance only (the diff is growing right now);
    // a done card keeps no pulse even if a stale momentum is attached.
    const html = boardWith({
      lane: "done",
      state: "done",
      momentum: { adds: 7, dels: 1, at: 0 },
    });
    expect(html).not.toContain("card-momentum");
  });
});

describe("renderFloor (Team tray: a lead + its children read as one enclosed unit)", () => {
  /** One Floor tile (size+warmth over a card resolved by id). */
  function tile(over: Partial<FloorTileVM> = {}): FloorTileVM {
    return { id: "a1", size: "md", warmth: "live", child: false, ...over };
  }

  /** A floor + teams fixture: one lead immediately followed by its two children. */
  function trayState(): CockpitState {
    return {
      cards: [
        card({ id: "lead1", roleName: "Fleet Lead", engineId: "copilot-fleet", lane: "working" }),
        card({ id: "kid1", roleName: "Coder", parentId: "lead1", lane: "working" }),
        card({ id: "kid2", roleName: "Reviewer", parentId: "lead1", lane: "working" }),
      ],
      delegations: [],
      floor: [tile({ id: "lead1" }), tile({ id: "kid1", child: true }), tile({ id: "kid2", child: true })],
      teams: [
        {
          leadId: "lead1",
          memberIds: ["kid1", "kid2"],
          leadRoleName: "Fleet Lead",
          leadEngineId: "copilot-fleet",
          statusLabel: "2 working",
          tone: "live",
          hue: 200,
        },
      ],
    };
  }

  it("wraps the lead and its children in exactly one .floor-team tray whose header shows role, engine + count, and status", () => {
    const html = renderFloor(trayState());
    expect((html.match(/<section class="floor-team/g) ?? []).length).toBe(1);
    expect(html).toContain("Fleet Lead");
    // engineId · (memberIds.length + 1) agents
    expect(html).toContain("copilot-fleet · 3 agents");
    expect(html).toContain("2 working");
  });

  it("marks the lead tile ft-lead and each child tile ft-child", () => {
    const html = renderFloor(trayState());
    expect(html).toMatch(/floor-tile[^"]*ft-lead/);
    expect((html.match(/ft-child/g) ?? []).length).toBe(2);
  });

  it("renders each child card exactly once, inside .ft-body, never as a top-level sibling", () => {
    const html = renderFloor(trayState());
    expect((html.match(/data-id="kid1"/g) ?? []).length).toBe(1);
    expect((html.match(/data-id="kid2"/g) ?? []).length).toBe(1);
    const bodyStart = html.indexOf('class="ft-body"');
    expect(bodyStart).toBeGreaterThan(-1);
    expect(html.indexOf('data-id="kid1"')).toBeGreaterThan(bodyStart);
    expect(html.indexOf('data-id="kid2"')).toBeGreaterThan(bodyStart);
  });

  it("carries the tone class, the team hue, the lead id, and a labeled section", () => {
    const html = renderFloor(trayState());
    expect(html).toContain("floor-team tone-live");
    expect(html).toContain("--team-hue:200");
    expect(html).toContain('data-team-lead="lead1"');
    expect(html).toContain('aria-label="Team Fleet Lead"');
  });

  it("renders a solo agent as a bare .floor-tile, never wrapped in a tray", () => {
    const html = renderFloor({
      cards: [card({ id: "solo1", roleName: "Solo" })],
      delegations: [],
      floor: [tile({ id: "solo1" })],
      teams: [],
    });
    expect(html).toContain('class="floor-tile');
    expect(html).not.toContain("floor-team");
  });

  it("never emits a floor-connectors svg (the connector overlay is gone)", () => {
    expect(renderFloor(trayState())).not.toContain("floor-connectors");
  });

  it("escapes a hostile lead role name in both the tray name and the aria-label", () => {
    const state = trayState();
    state.cards[0]!.roleName = "<img src=x>";
    state.teams![0]!.leadRoleName = "<img src=x>";
    const html = renderFloor(state);
    expect(html).not.toContain("<img src=x>");
    expect(html).toContain("&lt;img src=x&gt;");
    expect(html).toContain('aria-label="Team &lt;img src=x&gt;"');
  });

  it("still returns the quiet placeholder for an empty floor", () => {
    const html = renderFloor({ cards: [card({ id: "a1" })], delegations: [], floor: [], teams: [] });
    expect(html).toContain('class="floor floor-empty"');
    expect(html).toContain("No agents yet");
    expect(html).not.toContain("floor-team");
  });

  it("never drops a grandchild in a depth-2 team (lead -> kid -> grandkid): every card appears exactly once", () => {
    // A depth-2 delegation: lead1 has kid1 as a member, and kid1 in turn has a
    // (virtual) grandkid. kid1 renders as a LEAF inside lead1's tray, never as a
    // tray of its own, so the grandchild must be picked up by the leftover sweep
    // rather than vanishing (no tile, no data-id, unfocusable).
    const html = renderFloor({
      cards: [
        card({ id: "lead1", roleName: "Lead", lane: "working" }),
        card({ id: "kid1", roleName: "Kid", parentId: "lead1", lane: "working" }),
        card({ id: "grandkid", roleName: "Grandkid", parentId: "kid1", virtual: true, lane: "working" }),
      ],
      delegations: [],
      floor: [tile({ id: "lead1" }), tile({ id: "kid1", child: true }), tile({ id: "grandkid", child: true })],
      teams: [
        { leadId: "lead1", memberIds: ["kid1"], leadRoleName: "Lead", leadEngineId: "copilot-fleet", statusLabel: "1 working", tone: "live", hue: 200 },
        { leadId: "kid1", memberIds: ["grandkid"], leadRoleName: "Kid", leadEngineId: "copilot-fleet", statusLabel: "1 working", tone: "live", hue: 90 },
      ],
    });
    // Every card stays on the board EXACTLY once (renderFloor is a complete
    // permutation of state.cards: nothing duplicated, nothing dropped).
    expect((html.match(/data-id="grandkid"/g) ?? []).length).toBe(1);
    expect((html.match(/data-id="lead1"/g) ?? []).length).toBe(1);
    expect((html.match(/data-id="kid1"/g) ?? []).length).toBe(1);
  });

  it("falls back to an off-status team hue (never a status colour) when hue is missing", () => {
    const state = trayState();
    delete state.teams![0]!.hue;
    const html = renderFloor(state);
    // A missing hue must not read as red(0)/blue/green status; it lands on a quiet
    // identity hue instead.
    expect(html).toContain("--team-hue:268");
    expect(html).not.toContain("--team-hue:0");
  });
});

describe("renderBoard status bar (footer: real toggle, passive readouts)", () => {
  function tile(over: Partial<FloorTileVM> = {}): FloorTileVM {
    return { id: "a1", size: "md", warmth: "live", child: false, ...over };
  }
  const state: CockpitState = {
    cards: [card({ id: "a1", lane: "working" })],
    delegations: [],
    floor: [tile({ id: "a1" })],
  };

  it("marks only the active layout tab .active + aria-checked=true (Floor by default, Status when grouped)", () => {
    const floorHtml = renderBoard(state);
    expect(floorHtml).toMatch(/class="layout-tab active"[^>]*data-layout="floor"/);
    expect(floorHtml).toMatch(/class="layout-tab"[^>]*data-layout="status"/);
    const statusHtml = renderBoard(state, { groupByStatus: true });
    expect(statusHtml).toMatch(/class="layout-tab active"[^>]*data-layout="status"/);
    expect(statusHtml).toMatch(/class="layout-tab"[^>]*data-layout="floor"/);
  });

  it("renders the branch chip and both counters as NON-buttons (no data-action on any of the three)", () => {
    const html = renderBoard(state);
    const sb = html.slice(html.indexOf('class="status-bar"'));
    expect(sb).toContain('class="sb-branch"');
    expect(sb).not.toMatch(/sb-branch[^>]*data-action/);
    expect(sb).not.toMatch(/sb-running[^>]*data-action/);
    expect(sb).not.toMatch(/sb-awaiting[^>]*data-action/);
  });

  it("gives the running and awaiting counters a passive leading readout dot", () => {
    const html = renderBoard(state);
    expect(html).toMatch(/sb-running"><span class="sb-dot"/);
    expect(html).toMatch(/sb-awaiting"><span class="sb-dot"/);
  });

  it("uses a roving tabindex: the active layout tab is tabindex=0, the inactive one tabindex=-1", () => {
    const floorHtml = renderBoard(state); // Floor active
    expect(floorHtml).toMatch(/tabindex="0"[^>]*data-layout="floor"/);
    expect(floorHtml).toMatch(/tabindex="-1"[^>]*data-layout="status"/);
    const statusHtml = renderBoard(state, { groupByStatus: true });
    expect(statusHtml).toMatch(/tabindex="0"[^>]*data-layout="status"/);
    expect(statusHtml).toMatch(/tabindex="-1"[^>]*data-layout="floor"/);
    // The radiogroup pattern is kept; aria-pressed must remain absent.
    expect(floorHtml).not.toContain("aria-pressed");
  });
});
