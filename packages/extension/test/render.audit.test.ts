import { describe, it, expect } from "vitest";
import { renderCardHTML, renderDrawer } from "../src/render.js";
import type { CardVM } from "@maestro/cockpit";

function card(overrides: Partial<CardVM> = {}): CardVM {
  return { id: "a1", roleName: "Implementer", engineId: "copilot", state: "working", output: "", attention: false, lane: "working", taskDescription: "do it", ...overrides };
}

describe("render.ts: diffError on a done card (Issue 23)", () => {
  it("renders a diff-error note when a done card has diffError and no diff", () => {
    // diffError + actions live in the drawer; the card just shows lane/task.
    const c = card({ id: "a1", state: "done", attention: true, summary: "did it", diffError: "git diff failed: bad object", lane: "done" });
    const html = renderDrawer({ cards: [c], focusedId: "a1", delegations: [] });
    expect(html).toContain("diff-error");
    expect(html).toContain("git diff failed: bad object");
    // Merge/Discard must still be reachable so the user can act.
    expect(html).toContain('data-action="merge"');
    expect(html).toContain('data-action="discard"');
  });

  it("escapes the diffError text", () => {
    const c = card({ id: "a1", state: "done", attention: true, diffError: "<img src=x onerror=alert(1)>", lane: "done" });
    const html = renderDrawer({ cards: [c], focusedId: "a1", delegations: [] });
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img");
  });
});

describe("render.ts: the card carries no auto/autonomy badge in P1 (deferred to P4 anatomy row)", () => {
  // Tombstone: the capability-driven `auto` badge (audit Issue 17-consume) lived on
  // the card pre-P1. P1 makes the card read-mostly; autonomy moves to the P4 anatomy
  // row. There is no positive badge assertion to make in P1, so these guard genuine
  // ABSENCE on every kind of card (live and terminal) until P4 reintroduces it there.
  it("renders no auto badge on a live agent whose engine lacks approvals", () => {
    const html = renderCardHTML(card({ state: "working", engineCapabilities: { approvals: false, steerable: true } }));
    expect(html).not.toContain(">auto<");
    expect(html).not.toContain('class="badge"');
  });

  it("renders no auto badge on a detached (terminal, dead) card", () => {
    const html = renderCardHTML(card({ state: "detached", attention: true, engineCapabilities: { approvals: false, steerable: true } }));
    expect(html).not.toContain(">auto<");
    expect(html).not.toContain('class="badge"');
  });

  it("renders no auto badge on a merged card", () => {
    const html = renderCardHTML(card({ state: "merged", engineCapabilities: { approvals: false, steerable: true } }));
    expect(html).not.toContain(">auto<");
    expect(html).not.toContain('class="badge"');
  });
});
