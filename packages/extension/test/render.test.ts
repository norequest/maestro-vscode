import { describe, it, expect } from "vitest";
import { renderCardHTML, renderBoard, renderDrawer } from "../src/render.js";
import type { CardVM, CockpitState, DelegationVM } from "@hallucinate/cockpit";

function card(over: Partial<CardVM> = {}): CardVM {
  return {
    id: "a1",
    roleName: "Implementer",
    engineId: "copilot",
    state: "working",
    lane: "working",
    output: "",
    taskDescription: "do it",
    attention: false,
    ...over,
  };
}

/** A CockpitState with the required `delegations` field (defaults to empty). */
function board(over: Partial<CockpitState> = {}): CockpitState {
  return { cards: [], delegations: [], ...over };
}

function delegation(over: Partial<DelegationVM> = {}): DelegationVM {
  return { id: "d1", leadAgentId: "lead1", roleName: "Coder", task: "build the parser", ...over };
}

describe("renderCardHTML", () => {
  it("shows role, engine chip, task line, and a lane accent class", () => {
    const html = renderCardHTML(card({ engineId: "claude-sonnet-4.5", taskDescription: "ship the board" }));
    expect(html).toContain("Implementer");
    expect(html).toContain("claude-sonnet-4.5");
    expect(html).toContain("ship the board");
    expect(html).toContain("lane-working");
  });
  it("renders the faint italic goal when present and omits it when absent", () => {
    expect(renderCardHTML(card({ goal: "so that checkout cannot break" }))).toContain("so that checkout cannot break");
    expect(renderCardHTML(card())).not.toContain('class="goal"');
  });
  it("renders diffStat when a diff exists and omits it otherwise", () => {
    expect(renderCardHTML(card({ state: "done", diffStat: { adds: 5, dels: 2 } }))).toContain("+5");
    expect(renderCardHTML(card({ state: "done", diffStat: { adds: 5, dels: 2 } }))).toContain("-2");
    expect(renderCardHTML(card())).not.toContain('class="diffstat"');
  });
  it("reads a no-change run honestly: a zero diffStat shows 'No file changes', never '+0 -0'", () => {
    const html = renderCardHTML(card({ state: "done", lane: "done", diffStat: { adds: 0, dels: 0 } }));
    expect(html).toContain("No file changes");
    expect(html).not.toContain("+0");
    expect(html).not.toContain("-0");
  });
  it("still shows the +N -M diffstat when there are real changes", () => {
    const html = renderCardHTML(card({ state: "done", lane: "done", diffStat: { adds: 5, dels: 2 } }));
    expect(html).toContain("+5");
    expect(html).toContain("-2");
    expect(html).not.toContain("No file changes");
  });
  it("shows neither the diffstat nor a no-change label when no diffStat has been computed yet", () => {
    const html = renderCardHTML(card({ state: "working" }));
    expect(html).not.toContain('class="diffstat"');
    expect(html).not.toContain("No file changes");
  });
  it("emits an elapsed slot carrying startedAt for working cards", () => {
    expect(renderCardHTML(card({ startedAt: 1718000000000 }))).toContain('data-started="1718000000000"');
  });
  it("omits the anatomy row in P1 (no soul/tools/skills)", () => {
    expect(renderCardHTML(card())).not.toContain('class="anatomy"');
  });
  it("P4: renders anatomy row with soul, tools count, and skill when role has them", () => {
    const html = renderCardHTML(card({ soul: true, toolsCount: 2, toolsCanWrite: 1, skills: ["run-tests"] }));
    expect(html).toContain('class="anatomy"');
    expect(html).toContain("soul");
    expect(html).toContain("2");
    expect(html).toContain("run-tests");
    expect(html).toContain("amber");
  });
  it("P4: bare card (soul=false, toolsCount=0, skills=[]) renders NO anatomy row", () => {
    const html = renderCardHTML(card({ soul: false, toolsCount: 0, toolsCanWrite: 0, skills: [] }));
    expect(html).not.toContain('class="anatomy"');
  });
  it("escapes engine output and goal so text cannot inject markup", () => {
    const html = renderCardHTML(card({ goal: "<img src=x onerror=alert(1)>", output: "<script>bad" }));
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<script>bad");
    expect(html).toContain("&lt;img");
  });
  it("renders a status-text pill on the card header", () => {
    expect(renderCardHTML(card({ state: "working" }))).toContain("working");
    const review = renderCardHTML(card({ state: "done", lane: "done", diff: { files: ["a.ts"], patch: "P" } }));
    expect(review).toContain('class="state-pill');
    expect(review).toContain("ready to review");
  });
  it("renders an on-card Review button (open-review) for reviewable cards, with the agent id", () => {
    const html = renderCardHTML(card({ id: "rev1", state: "done", lane: "done", diff: { files: ["a.ts"], patch: "P" } }));
    expect(html).toContain('class="card-review');
    expect(html).toContain('data-action="open-review"');
    expect(html).toContain('data-id="rev1"');
    // A plain working card with no diff has no Review button.
    expect(renderCardHTML(card({ state: "working" }))).not.toContain('data-action="open-review"');
  });
  it("renders a per-card Remove button (reusing discard) ONLY for a done card", () => {
    const done = renderCardHTML(card({ id: "d9", state: "done", lane: "done", diff: { files: ["a.ts"], patch: "P" } }));
    expect(done).toContain('class="card-remove"');
    expect(done).toContain('data-action="remove"');
    expect(done).toContain('data-id="d9"');
    // A working card has NO Remove button (only done cards are removable).
    const working = renderCardHTML(card({ state: "working" }));
    expect(working).not.toContain('data-action="remove"');
    expect(working).not.toContain('class="card-remove"');
  });
  it("a done card with an EMPTY diff still gets a Remove button", () => {
    // Even a no-change done run is removable (discard drops its worktree).
    const html = renderCardHTML(card({ id: "e1", state: "done", lane: "done", diff: { files: [], patch: "" } }));
    expect(html).toContain('data-action="remove"');
    expect(html).toContain('data-id="e1"');
  });
  it("renders an inline question block when blocked awaiting input", () => {
    const html = renderCardHTML(card({ lane: "needsYou", state: "awaiting-approval", pendingApprovalId: "ap1", approvalDetail: { tool: "bash", description: "rm -rf build" } }));
    expect(html).toContain('class="card-question"');
    expect(html).toContain("rm -rf build");
  });
  it("renders an inline conflict-file block on conflict cards", () => {
    const html = renderCardHTML(card({ lane: "conflict", state: "conflict", conflictFiles: ["db/schema.prisma"] }));
    expect(html).toContain('class="card-conflict"');
    expect(html).toContain("db/schema.prisma");
  });
  it("de-emphasises done cards: a done modifier class and no goal line", () => {
    const html = renderCardHTML(card({ lane: "done", state: "merged", goal: "so that it ships" }));
    // The card carries the lane class, a per-state class (state-merged), and the
    // trailing "done" de-emphasis modifier. Assert the lane + the modifier without
    // assuming they are adjacent (the state class now sits between them).
    expect(html).toContain("card lane-done");
    expect(html).toContain(' done"');
    expect(html).not.toContain("so that it ships");
  });
  it("carries a per-state class on the card root and the status pill", () => {
    // Distinct states that share a lane (error vs stopped both land in needsYou)
    // must still be visually distinguishable, so the raw state rides as a class.
    const err = renderCardHTML(card({ lane: "needsYou", state: "error" }));
    expect(err).toContain("state-error");
    expect(err).toContain('class="state-pill lane-needsYou state-error"');
    const stopped = renderCardHTML(card({ lane: "needsYou", state: "stopped" }));
    expect(stopped).toContain("state-stopped");
    expect(stopped).not.toContain("state-error");
  });
  it("truncation-recovers the role name via a title attribute", () => {
    const html = renderCardHTML(card({ roleName: "Very Long Role Name" }));
    expect(html).toContain('title="Very Long Role Name"');
  });
});

describe("renderBoard", () => {
  it("maps the 4 data lanes onto 3 columns: Working / Needs you (with conflicts) / Done", () => {
    const cards: CardVM[] = [
      card({ id: "w1", lane: "working" }),
      card({ id: "n1", lane: "needsYou", state: "awaiting-approval", attention: true }),
      card({ id: "n2", lane: "needsYou", state: "error", attention: true }),
      card({ id: "c1", lane: "conflict", state: "conflict", attention: true }),
      card({ id: "d1", lane: "done", state: "merged" }),
    ];
    const html = renderBoard({ cards, delegations: [] });
    // The three board columns.
    expect(html).toContain("Working");
    expect(html).toContain("Needs you");
    expect(html).toContain("Done");
    // The "Needs you" column folds needsYou (2) + conflict (1) = 3.
    expect(html).toMatch(/lane-col-needsYou[\s\S]*?class="count">3</);
    // Conflict cards live inside the Needs you column but keep their lane styling.
    expect(html).toContain('class="lane lane-col-needsYou"');
    expect(html).toContain('lane-conflict');
    expect(html).toContain('data-id="w1"');
    expect(html).toContain('data-id="c1"');
  });
  it("renders the board header and status bar, and NO redundant editor-tab strip", () => {
    const html = renderBoard({ cards: [card({ id: "w1", lane: "working" })], delegations: [] });
    // The top tab strip (Hallucinate/Library/Skills/Discover) was redundant with the
    // header Library button and is gone; the header is the single control surface.
    expect(html).not.toContain('class="tabstrip"');
    expect(html).toContain('class="board-header"');
    // The primary board action is "+ New task" (the team funnel), not "New agent".
    expect(html).toContain("New task");
    expect(html).toContain('data-action="new-task"');
    expect(html).toContain('class="status-bar"');
    // Status bar derives "N running" from the working count.
    expect(html).toMatch(/sb-running">1 running/);
  });
  it("opens the Library from the single header button (no duplicate nav)", () => {
    const html = renderBoard({ cards: [], delegations: [] });
    const opens = html.match(/data-action="open-library"/g) ?? [];
    // Exactly one open-library affordance now: the header Library button.
    expect(opens.length).toBe(1);
    expect(html).toContain('class="bh-library"');
  });
  it("shows a 'Clear all' button in the Done lane header when it has cards", () => {
    const html = renderBoard(
      board({ cards: [card({ id: "d1", lane: "done", state: "done", diff: { files: ["a.ts"], patch: "P" } })] }),
    );
    expect(html).toContain('class="lane-clear"');
    expect(html).toContain('data-action="clear-done-lane"');
    expect(html).toContain("Clear all");
  });
  it("omits 'Clear all' when the Done lane is empty", () => {
    const html = renderBoard(board({ cards: [card({ id: "w1", lane: "working" })] }));
    expect(html).not.toContain('class="lane-clear"');
    expect(html).not.toContain('data-action="clear-done-lane"');
  });
  it("shows 'Clear all' only on the Done lane, never on Working or Needs you", () => {
    const html = renderBoard(
      board({
        cards: [
          card({ id: "w1", lane: "working" }),
          card({ id: "n1", lane: "needsYou", state: "awaiting-approval", attention: true }),
          card({ id: "d1", lane: "done", state: "done", diff: { files: ["a.ts"], patch: "P" } }),
        ],
      }),
    );
    // Exactly one Clear all affordance, in the Done column.
    const clears = html.match(/data-action="clear-done-lane"/g) ?? [];
    expect(clears.length).toBe(1);
    expect(html).toMatch(/lane-col-done[\s\S]*?lane-clear/);
  });
  it("renders empty columns as a quiet placeholder, never a hard border", () => {
    const html = renderBoard({ cards: [card({ lane: "working" })], delegations: [] });
    expect(html).toContain('class="lane-empty"');
  });
  it("gives each empty column its own copy (Needs-you uses no em dash)", () => {
    const html = renderBoard({ cards: [], delegations: [] });
    expect(html).toContain("No agents working");
    expect(html).toContain("Nothing needs you right now.");
    expect(html).toContain("Nothing merged yet");
    // Hard project rule: no em dashes in any copy.
    expect(html).not.toContain("—");
  });
  it("status bar shows a branch icon before main and the running/awaiting counts", () => {
    const html = renderBoard({ cards: [card({ lane: "working" }), card({ lane: "needsYou", state: "done", attention: true })], delegations: [] });
    expect(html).toContain('class="sb-branch-icon"');
    expect(html).toMatch(/sb-running">1 running/);
    expect(html).toMatch(/sb-awaiting">1 awaiting review/);
  });

  // ─── Lead-coordinated teams: pending delegation proposals ─────────────────

  it("renders no delegation block when there are no pending delegations", () => {
    const html = renderBoard(board({ cards: [card({ id: "w1", lane: "working" })] }));
    expect(html).not.toContain('class="delegations"');
    expect(html).not.toContain('data-action="approve-delegation"');
  });

  it("renders a pending delegation with its text and Approve/Deny buttons", () => {
    const html = renderBoard(
      board({
        cards: [card({ id: "lead1", roleName: "Lead" })],
        delegations: [delegation({ id: "d7", leadAgentId: "lead1", roleName: "Coder", task: "implement the parser" })],
      }),
    );
    expect(html).toContain('class="delegations"');
    // The lead's display name is resolved from the board card.
    expect(html).toContain("Lead");
    expect(html).toContain("Coder");
    expect(html).toContain("implement the parser");
    // Approve / Deny carry the delegation id (NOT an agent id).
    expect(html).toContain('data-action="approve-delegation"');
    expect(html).toContain('data-action="deny-delegation"');
    expect(html).toContain('data-id="d7"');
  });

  it("falls back to a short lead id when the lead card is not on the board", () => {
    const html = renderBoard(
      board({ cards: [], delegations: [delegation({ leadAgentId: "abcdef1234567890" })] }),
    );
    // Short slice of the id when no matching card is present.
    expect(html).toContain("abcdef12");
  });

  it("escapes dynamic delegation content so it cannot inject markup", () => {
    const html = renderBoard(
      board({
        cards: [],
        delegations: [delegation({ id: "d1", task: "<script>alert(1)</script>", roleName: "<b>x</b>" })],
      }),
    );
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain("<b>x</b>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;b&gt;");
    // Hard project rule: no em dashes in any rendered copy.
    expect(html).not.toContain("—");
  });

  it("renders a 'via <lead>' marker on a delegated child card", () => {
    const html = renderBoard(
      board({
        cards: [
          card({ id: "lead1", roleName: "Lead" }),
          card({ id: "child1", roleName: "Coder", parentId: "lead1" }),
        ],
      }),
    );
    expect(html).toContain('class="via"');
    expect(html).toContain("via Lead");
  });

  it("header 'need you' counts pending delegations even with no needy agents", () => {
    // Two proposals awaiting approval, no agent in needsYou/conflict: the header
    // must read "2 need you", not "0 need you" (the delegation strip is honest).
    const html = renderBoard(
      board({
        cards: [card({ id: "w1", lane: "working" })],
        delegations: [delegation({ id: "d1" }), delegation({ id: "d2" })],
      }),
    );
    expect(html).toMatch(/bh-count needs"[\s\S]*?2 need you/);
    expect(html).not.toMatch(/bh-count needs"[\s\S]*?0 need you/);
  });

  it("header 'need you' sums needy agents and pending delegations", () => {
    // 1 agent awaiting approval + 2 delegations = 3 need you.
    const html = renderBoard(
      board({
        cards: [
          card({ id: "n1", lane: "needsYou", state: "awaiting-approval", attention: true }),
        ],
        delegations: [delegation({ id: "d1" }), delegation({ id: "d2" })],
      }),
    );
    expect(html).toMatch(/bh-count needs"[\s\S]*?3 need you/);
  });

  it("header 'need you' is unchanged (agents only) when there are no delegations", () => {
    const html = renderBoard(
      board({
        cards: [
          card({ id: "n1", lane: "needsYou", state: "error", attention: true }),
          card({ id: "c1", lane: "conflict", state: "conflict", attention: true }),
        ],
      }),
    );
    expect(html).toMatch(/bh-count needs"[\s\S]*?2 need you/);
  });

  // ─── Nested sub-agents (visual hierarchy in a lane) ────────────────────────

  it("nests children under their lead: kids render AFTER the lead, each is-child, lead carries the count", () => {
    const html = renderBoard(
      board({
        cards: [
          card({ id: "lead1", roleName: "Lead", lane: "working" }),
          card({ id: "kid1", roleName: "Coder", lane: "working", parentId: "lead1" }),
          card({ id: "kid2", roleName: "Tester", lane: "working", parentId: "lead1" }),
        ],
      }),
    );
    const lead = html.indexOf('data-id="lead1"');
    const kid1 = html.indexOf('data-id="kid1"');
    const kid2 = html.indexOf('data-id="kid2"');
    // Both children render AFTER their lead (nested under it).
    expect(lead).toBeGreaterThanOrEqual(0);
    expect(kid1).toBeGreaterThan(lead);
    expect(kid2).toBeGreaterThan(lead);
    // Each child card carries the is-child class; the lead does not.
    // Slice each card's <section ...> opening tag (from the prior '<section'
    // up to the first '>' after its data-id) so the assertion targets that one
    // card's classes, not a neighbour's.
    const openTag = (idx: number) =>
      html.slice(html.lastIndexOf("<section", idx), html.indexOf(">", idx));
    expect(openTag(lead)).not.toContain("is-child");
    expect(openTag(kid1)).toContain("is-child");
    expect(openTag(kid2)).toContain("is-child");
    // The lead advertises its 2 sub-agents (plural).
    expect(html).toContain('class="subagents"');
    expect(html).toContain("2 sub-agents");
  });

  it("uses the singular 'sub-agent' affordance when a lead has exactly one child", () => {
    const html = renderBoard(
      board({
        cards: [
          card({ id: "lead1", roleName: "Lead", lane: "working" }),
          card({ id: "kid1", roleName: "Coder", lane: "working", parentId: "lead1" }),
        ],
      }),
    );
    expect(html).toContain("1 sub-agent");
    expect(html).not.toContain("1 sub-agents");
  });

  it("adds NO sub-agents affordance to a plain card with no children", () => {
    const html = renderBoard(board({ cards: [card({ id: "solo", lane: "working" })] }));
    expect(html).not.toContain('class="subagents"');
  });

  it("a child whose parent is in a DIFFERENT lane still renders, as a normal top-level card (no is-child, not dropped)", () => {
    const html = renderBoard(
      board({
        cards: [
          // Lead sits in Working; its child is over in Needs-you.
          card({ id: "lead1", roleName: "Lead", lane: "working" }),
          card({ id: "kid1", roleName: "Coder", lane: "needsYou", state: "awaiting-approval", attention: true, parentId: "lead1" }),
        ],
      }),
    );
    // The cross-lane child is NOT dropped.
    const kid1 = html.indexOf('data-id="kid1"');
    expect(kid1).toBeGreaterThanOrEqual(0);
    // It renders flat (no is-child) because its parent is not in the same lane.
    const kid1Open = html.slice(html.lastIndexOf("<section", kid1), html.indexOf(">", kid1));
    expect(kid1Open).not.toContain("is-child");
    // It still shows the faint "via Lead" provenance marker.
    expect(html).toContain("via Lead");
  });

  // ─── Read-only virtual (fleet) sub-agents ──────────────────────────────────

  it("a virtual sub-agent card renders NO action affordances (no Review/Remove), even when done", () => {
    // A done virtual sub-agent would normally show Review + Remove; virtual must not.
    const html = renderCardHTML(
      card({ id: "sub1", state: "done", lane: "done", diff: { files: ["a.ts"], patch: "P" }, virtual: true }),
    );
    expect(html).not.toContain('data-action="open-review"');
    expect(html).not.toContain('data-action="remove"');
    expect(html).not.toContain('class="card-review');
    expect(html).not.toContain('class="card-remove"');
    // It DOES keep the read-only hint, the status pill, role, and output area.
    expect(html).toContain("read-only sub-agent");
    expect(html).toContain('class="state-pill');
    expect(html).toContain("ready to review");
  });

  it("a NON-virtual done card still gets its Review and Remove buttons (the suppression is virtual-only)", () => {
    const html = renderCardHTML(
      card({ id: "real1", state: "done", lane: "done", diff: { files: ["a.ts"], patch: "P" } }),
    );
    expect(html).toContain('data-action="open-review"');
    expect(html).toContain('data-action="remove"');
    expect(html).not.toContain("read-only sub-agent");
  });

  it("a virtual working card keeps the is-child nesting under its lead", () => {
    const html = renderBoard(
      board({
        cards: [
          card({ id: "lead1", roleName: "Lead", lane: "working" }),
          card({ id: "sub1", roleName: "Coder", lane: "working", parentId: "lead1", virtual: true }),
        ],
      }),
    );
    const sub = html.indexOf('data-id="sub1"');
    const openTag = html.slice(html.lastIndexOf("<section", sub), html.indexOf(">", sub));
    expect(openTag).toContain("is-child");
    // The lead still advertises its sub-agent.
    expect(html).toContain("1 sub-agent");
  });
});

const steerable = { approvals: false, steerable: true };
const approver = { approvals: true, steerable: true };

/**
 * Slice out just the Instructions tab BODY (the `<div class="tab-body"
 * data-tab="instructions">` element), so assertions are not satisfied by the
 * nav button or by the TASK box above the tabs. Starts at the tab-body marker
 * (NOT the nav button, which appears earlier) and ends at the next tab body.
 */
function instructionsTabBody(html: string): string {
  const start = html.indexOf('class="tab-body" data-tab="instructions"');
  const end = html.indexOf('data-tab="output"', start);
  return html.slice(start, end);
}

describe("renderDrawer", () => {
  it("is empty when nothing is focused (board stays full-width)", () => {
    expect(renderDrawer({ cards: [card()], delegations: [] })).toBe("");
  });
  it("emits a click-to-close scrim immediately before the drawer panel", () => {
    const html = renderDrawer({ cards: [card({ id: "a1" })], focusedId: "a1", delegations: [] });
    // The scrim dims the board behind the drawer and routes clicks to close-drawer.
    expect(html).toContain('<div class="drawer-scrim" data-action="close-drawer"></div>');
    expect(html.indexOf('class="drawer-scrim"')).toBeLessThan(html.indexOf('class="drawer"'));
  });
  it("renders Instructions / Output / Diff tabs for the focused card", () => {
    const html = renderDrawer({ cards: [card({ id: "a1" })], focusedId: "a1", delegations: [] });
    expect(html).toContain("Instructions"); expect(html).toContain("Output"); expect(html).toContain("Diff");
  });
  it("Instructions tab is read-only: shows the role instructions, no textarea, no Save", () => {
    const html = renderDrawer({ cards: [card({ id: "a1", instructions: "# Instructions\nYou are an implementer." })], focusedId: "a1", delegations: [] });
    expect(html).toContain("You are an implementer.");
    expect(html).not.toContain("<textarea"); expect(html).not.toContain('data-action="save-instructions"');
  });
  it("Instructions tab renders the role instructions (role.md), NOT the task description", () => {
    const html = renderDrawer({
      cards: [card({ id: "a1", taskDescription: "do the thing", instructions: "# Instructions\nYou are an implementer.\n# Skills\nfoo" })],
      focusedId: "a1",
      delegations: [],
    });
    // Isolate the Instructions tab body so the assertions are not satisfied by
    // the TASK box (which legitimately echoes the task above the tabs).
    const instrTab = instructionsTabBody(html);
    // The role brief is shown under the (now accurate) "ROLE · role.md" label.
    expect(instrTab).toContain("You are an implementer.");
    expect(instrTab).toContain("# Skills");
    expect(instrTab).toContain("ROLE · role.md");
    // The task is NOT used as the instruction body anymore (it is the TASK box's job).
    expect(instrTab).not.toContain("do the thing");
  });
  it("Instructions tab preserves multi-line markdown structure (no <p> whitespace collapse)", () => {
    const html = renderDrawer({
      cards: [card({ id: "a1", instructions: "# Instructions\nYou are an implementer.\n# Skills\nfoo" })],
      focusedId: "a1",
      delegations: [],
    });
    const instrTab = instructionsTabBody(html);
    // Line breaks survive verbatim (a pre-wrapped block, never a collapsing <p>).
    expect(instrTab).toContain("# Instructions\nYou are an implementer.\n# Skills\nfoo");
  });
  it("Instructions tab shows a muted placeholder when there are no instructions", () => {
    const html = renderDrawer({
      cards: [card({ id: "a1", taskDescription: "do the thing", instructions: undefined })],
      focusedId: "a1",
      delegations: [],
    });
    const instrTab = instructionsTabBody(html);
    expect(instrTab).toContain("No instructions.");
    // The task must never stand in for missing instructions.
    expect(instrTab).not.toContain("do the thing");
  });
  it("Instructions tab escapes role/engine instruction text so it cannot inject markup", () => {
    const html = renderDrawer({
      cards: [card({ id: "a1", instructions: "<img src=x onerror=alert(1)>" })],
      focusedId: "a1",
      delegations: [],
    });
    const instrTab = instructionsTabBody(html);
    expect(instrTab).not.toContain("<img src=x");
    expect(instrTab).toContain("&lt;img");
  });
  it("shows Approve/Deny only when approvals-capable and awaiting-approval", () => {
    const yes = renderDrawer({ cards: [card({ id: "a1", state: "awaiting-approval", attention: true, pendingApprovalId: "ap1", engineCapabilities: approver })], focusedId: "a1", delegations: [] });
    expect(yes).toContain('data-action="approve"'); expect(yes).toContain('data-action="deny"');
    const no = renderDrawer({ cards: [card({ id: "a1", state: "awaiting-approval", attention: true, pendingApprovalId: "ap1", engineCapabilities: { approvals: false, steerable: false } })], focusedId: "a1", delegations: [] });
    expect(no).not.toContain('data-action="approve"');
  });
  it("shows the Steer box only when steerable", () => {
    expect(renderDrawer({ cards: [card({ id: "a1", state: "working", engineCapabilities: steerable })], focusedId: "a1", delegations: [] })).toContain('data-action="steer"');
    expect(renderDrawer({ cards: [card({ id: "a1", state: "working", engineCapabilities: { approvals: false, steerable: false } })], focusedId: "a1", delegations: [] })).not.toContain('data-action="steer"');
  });
  it("shows Send-back on done/conflict and merge/discard on done", () => {
    const html = renderDrawer({ cards: [card({ id: "a1", state: "done", attention: true, diff: { files: ["x.ts"], patch: "P" }, summary: "ok" })], focusedId: "a1", delegations: [] });
    expect(html).toContain('data-action="sendBack"'); expect(html).toContain('data-action="merge"'); expect(html).toContain('data-action="discard"');
  });
  it("shows conflict files + resolve-conflict on conflict, never merge", () => {
    const html = renderDrawer({ cards: [card({ id: "a1", state: "conflict", attention: true, conflictFiles: ["x.ts"] })], focusedId: "a1", delegations: [] });
    expect(html).toContain("x.ts"); expect(html).toContain('data-action="resolve-conflict"'); expect(html).not.toContain('data-action="merge"');
  });
  it("Diff tab shows files + escaped patch", () => {
    const html = renderDrawer({ cards: [card({ id: "a1", state: "done", diff: { files: ["a.ts"], patch: "<x>+1" } })], focusedId: "a1", delegations: [] });
    expect(html).toContain("a.ts"); expect(html).toContain("&lt;x&gt;");
  });
  it("escapes the streamed output in the Output tab", () => {
    const html = renderDrawer({ cards: [card({ id: "a1", output: "<img src=x onerror=alert(1)>" })], focusedId: "a1", delegations: [] });
    expect(html).not.toContain("<img src=x"); expect(html).toContain("&lt;img");
  });
  it("renders an editable TASK section with an input pre-filled with the task", () => {
    const html = renderDrawer({ cards: [card({ id: "a1", taskDescription: "wire the router" })], focusedId: "a1", delegations: [] });
    expect(html).toContain('class="drawer-task"');
    expect(html).toContain("TASK");
    expect(html).toContain('class="drawer-task-input"');
    expect(html).toContain('value="wire the router"');
  });
  it("escapes the task value in the editable TASK input", () => {
    const html = renderDrawer({ cards: [card({ id: "a1", taskDescription: '"><img src=x>' })], focusedId: "a1", delegations: [] });
    expect(html).not.toContain('value=""><img src=x>');
    expect(html).toContain("&lt;img");
  });
  it("working footer offers a Pause toggle, Stop, and (when steerable) Steer", () => {
    const html = renderDrawer({ cards: [card({ id: "a1", state: "working", engineCapabilities: steerable })], focusedId: "a1", delegations: [] });
    expect(html).toContain('class="drawer-pause"');
    expect(html).toContain('data-action="stop"');
    expect(html).toContain('data-action="steer"');
  });
  it("BLOCKED footer shows the waiting note and an Answer-to-unblock input when no structured approval", () => {
    const html = renderDrawer({ cards: [card({ id: "a1", state: "awaiting-approval", attention: true, pendingApprovalId: "ap1", engineCapabilities: { approvals: false, steerable: false } })], focusedId: "a1", delegations: [] });
    expect(html).toContain("This agent is waiting on your answer to continue.");
    expect(html).toContain('class="drawer-answer-input"');
    expect(html).toContain("Send answer");
    // No invented host verb leaks out: it rides the placeholder data-action only.
    expect(html).toContain('data-action="answer-unblock"');
  });
  it("review (done) footer keeps Approve&merge-style merge + send back", () => {
    const html = renderDrawer({ cards: [card({ id: "a1", state: "done", attention: true, diff: { files: ["x.ts"], patch: "P" }, summary: "ok" })], focusedId: "a1", delegations: [] });
    expect(html).toContain('data-action="merge"');
    expect(html).toContain('data-action="sendBack"');
  });

  it("a done run with an EMPTY diff (no changes) offers Discard only, never Merge or Create PR", () => {
    const html = renderDrawer({ cards: [card({ id: "a1", state: "done", attention: true, diff: { files: [], patch: "" } })], focusedId: "a1", delegations: [] });
    expect(html).toContain('data-action="discard"');
    expect(html).not.toContain('data-action="merge"');
    expect(html).not.toContain('data-action="create-pr"');
  });

  it("a done run whose diff FAILED (diffError) keeps Merge reachable", () => {
    const html = renderDrawer({ cards: [card({ id: "a1", state: "done", attention: true, diffError: "git diff failed" })], focusedId: "a1", delegations: [] });
    expect(html).toContain('data-action="merge"');
  });

  it("a stopped run offers Resume + Discard, never Merge", () => {
    const html = renderDrawer({ cards: [card({ id: "a1", state: "stopped", diff: { files: ["x.ts"], patch: "P" } })], focusedId: "a1", delegations: [] });
    expect(html).toContain('data-action="resume"');
    expect(html).toContain('data-action="discard"');
    expect(html).not.toContain('data-action="merge"');
  });

  it("a focused VIRTUAL sub-agent drawer has NO Merge/Discard/Approve/Steer, only a read-only note", () => {
    // Even in a done+diff state (which would normally show merge/discard), a
    // virtual sub-agent's drawer is view-only.
    const html = renderDrawer({
      cards: [
        card({
          id: "sub1",
          state: "done",
          attention: true,
          diff: { files: ["x.ts"], patch: "P" },
          engineCapabilities: { approvals: true, steerable: true },
          virtual: true,
        }),
      ],
      focusedId: "sub1",
      delegations: [],
    });
    expect(html).not.toContain('data-action="merge"');
    expect(html).not.toContain('data-action="discard"');
    expect(html).not.toContain('data-action="approve"');
    expect(html).not.toContain('data-action="steer"');
    expect(html).not.toContain('data-action="sendBack"');
    expect(html).toContain("read-only sub-agent");
    // It still shows the agent's output tab (view-only window onto the sub-agent).
    expect(html).toContain('data-tab="output"');
  });
});
