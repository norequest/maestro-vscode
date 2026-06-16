import { describe, it, expect } from "vitest";
import { renderCardHTML, renderBoard, renderDrawer } from "../src/render.js";
import type { CardVM, CockpitState } from "@maestro/cockpit";

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
});

describe("renderBoard", () => {
  it("groups cards into Working / Needs you / Conflict / Done with live counts", () => {
    const cards: CardVM[] = [
      card({ id: "w1", lane: "working" }),
      card({ id: "n1", lane: "needsYou", state: "awaiting-approval", attention: true }),
      card({ id: "n2", lane: "needsYou", state: "error", attention: true }),
      card({ id: "c1", lane: "conflict", state: "conflict", attention: true }),
      card({ id: "d1", lane: "done", state: "merged" }),
    ];
    const html = renderBoard({ cards });
    expect(html).toContain("Working");
    expect(html).toContain("Needs you");
    expect(html).toContain("Conflict");
    expect(html).toContain("Done");
    expect(html).toMatch(/Needs you[\s\S]*?2/);
    expect(html).toContain('data-id="w1"');
    expect(html).toContain('data-id="c1"');
  });
  it("renders empty lanes as a quiet placeholder, never a hard border", () => {
    const html = renderBoard({ cards: [card({ lane: "working" })] });
    expect(html).toContain('class="lane-empty"');
  });
});

const steerable = { approvals: false, steerable: true };
const approver = { approvals: true, steerable: true };

describe("renderDrawer", () => {
  it("is empty when nothing is focused (board stays full-width)", () => {
    expect(renderDrawer({ cards: [card()] })).toBe("");
  });
  it("renders Instructions / Output / Diff tabs for the focused card", () => {
    const html = renderDrawer({ cards: [card({ id: "a1" })], focusedId: "a1" });
    expect(html).toContain("Instructions"); expect(html).toContain("Output"); expect(html).toContain("Diff");
  });
  it("Instructions tab is read-only: shows task + goal, no textarea, no Save", () => {
    const html = renderDrawer({ cards: [card({ id: "a1", taskDescription: "wire it", goal: "so that it is real" })], focusedId: "a1" });
    expect(html).toContain("wire it"); expect(html).toContain("so that it is real");
    expect(html).not.toContain("<textarea"); expect(html).not.toContain('data-action="save-instructions"');
  });
  it("shows Approve/Deny only when approvals-capable and awaiting-approval", () => {
    const yes = renderDrawer({ cards: [card({ id: "a1", state: "awaiting-approval", attention: true, pendingApprovalId: "ap1", engineCapabilities: approver })], focusedId: "a1" });
    expect(yes).toContain('data-action="approve"'); expect(yes).toContain('data-action="deny"');
    const no = renderDrawer({ cards: [card({ id: "a1", state: "awaiting-approval", attention: true, pendingApprovalId: "ap1", engineCapabilities: { approvals: false, steerable: false } })], focusedId: "a1" });
    expect(no).not.toContain('data-action="approve"');
  });
  it("shows the Steer box only when steerable", () => {
    expect(renderDrawer({ cards: [card({ id: "a1", state: "working", engineCapabilities: steerable })], focusedId: "a1" })).toContain('data-action="steer"');
    expect(renderDrawer({ cards: [card({ id: "a1", state: "working", engineCapabilities: { approvals: false, steerable: false } })], focusedId: "a1" })).not.toContain('data-action="steer"');
  });
  it("shows Send-back on done/conflict and merge/discard on done", () => {
    const html = renderDrawer({ cards: [card({ id: "a1", state: "done", attention: true, diff: { files: ["x.ts"], patch: "P" }, summary: "ok" })], focusedId: "a1" });
    expect(html).toContain('data-action="sendBack"'); expect(html).toContain('data-action="merge"'); expect(html).toContain('data-action="discard"');
  });
  it("shows conflict files + resolve-conflict on conflict, never merge", () => {
    const html = renderDrawer({ cards: [card({ id: "a1", state: "conflict", attention: true, conflictFiles: ["x.ts"] })], focusedId: "a1" });
    expect(html).toContain("x.ts"); expect(html).toContain('data-action="resolve-conflict"'); expect(html).not.toContain('data-action="merge"');
  });
  it("Diff tab shows files + escaped patch", () => {
    const html = renderDrawer({ cards: [card({ id: "a1", state: "done", diff: { files: ["a.ts"], patch: "<x>+1" } })], focusedId: "a1" });
    expect(html).toContain("a.ts"); expect(html).toContain("&lt;x&gt;");
  });
  it("escapes the streamed output in the Output tab", () => {
    const html = renderDrawer({ cards: [card({ id: "a1", output: "<img src=x onerror=alert(1)>" })], focusedId: "a1" });
    expect(html).not.toContain("<img src=x"); expect(html).toContain("&lt;img");
  });
});
