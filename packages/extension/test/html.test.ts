import { describe, expect, it } from "vitest";
import type { CardVM } from "@maestro/cockpit";
import { escapeHtml, makeNonce } from "../src/html.js";
import { renderCardHTML, renderDrawer } from "../src/render.js";

function card(over: Partial<CardVM> = {}): CardVM {
  return { id: "a1", roleName: "Implementer", engineId: "copilot", state: "working", output: "", attention: false, lane: "working", taskDescription: "do it", ...over };
}

describe("html helpers", () => {
  it("makeNonce yields a 32-char alphanumeric token", () => {
    expect(makeNonce()).toMatch(/^[A-Za-z0-9]{32}$/);
  });
  it("escapeHtml neutralizes markup", () => {
    expect(escapeHtml('<script>"&')).toBe("&lt;script&gt;&quot;&amp;");
  });
  it("escapeHtml escapes the single quote (Issue 25)", () => {
    expect(escapeHtml("it's a 'test'")).toBe("it&#39;s a &#39;test&#39;");
  });
  it("escapeHtml escapes the backtick (Issue 25)", () => {
    expect(escapeHtml("a `b` c")).toBe("a &#96;b&#96; c");
  });
});

describe("renderCardHTML", () => {
  it("shows live output while working and a Stop control", () => {
    // Card carries the task/lane; actions + output live in the drawer.
    const c = card({ output: "compiling...", id: "a1" });
    const html = renderDrawer({ cards: [c], focusedId: "a1", delegations: [] });
    expect(html).toContain("compiling...");
    expect(html).toContain('data-action="stop"');
  });
  it("shows summary + diff files + Merge/Discard when done", () => {
    const c = card({ id: "a1", state: "done", attention: true, summary: "did it", diff: { files: ["a.ts", "b.ts"], patch: "P" }, lane: "done" });
    const html = renderDrawer({ cards: [c], focusedId: "a1", delegations: [] });
    expect(html).toContain("did it");
    expect(html).toContain("a.ts");
    expect(html).toContain('data-action="merge"');
    expect(html).toContain('data-action="discard"');
  });
  it("shows conflict files and Discard on conflict", () => {
    const c = card({ id: "a1", state: "conflict", attention: true, conflictFiles: ["x.ts"], lane: "conflict" });
    const html = renderDrawer({ cards: [c], focusedId: "a1", delegations: [] });
    expect(html).toContain("x.ts");
    expect(html).toContain('data-action="discard"');
    expect(html).not.toContain('data-action="merge"');
  });
  it("shows the error tail on error", () => {
    const c = card({ id: "a1", state: "error", attention: true, error: "boom", lane: "needsYou" });
    const html = renderDrawer({ cards: [c], focusedId: "a1", delegations: [] });
    expect(html).toContain("boom");
  });
  it("escapes output so engine text cannot inject markup", () => {
    const c = card({ id: "a1", output: "<img src=x onerror=alert(1)>" });
    const html = renderDrawer({ cards: [c], focusedId: "a1", delegations: [] });
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img");
  });
});
