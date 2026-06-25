import { describe, expect, it } from "vitest";
import { renderComposerHTML } from "../src/render-composer.js";
import { composerOptions } from "@maestro/cockpit";

const opts = composerOptions(
  [{ name: "Test Author", instructions: "<b>write</b> tests", engine: { id: "copilot" }, autonomy: "auto-approve-safe" }],
  [{ name: "Strike", roles: [] }],
);
describe("renderComposerHTML", () => {
  it("renders a preset chip with the role name and engine", () => {
    const html = renderComposerHTML(opts);
    expect(html).toContain("Test Author");
    expect(html).toContain("copilot");
    expect(html).toContain('data-role="Test Author"');
  });
  it("renders engine pills for every family and model variant", () => {
    const html = renderComposerHTML(opts);
    expect(html).toContain('data-engine="copilot"');
    expect(html).toContain('data-engine="acp"');
    expect(html).toContain("claude-sonnet-4.5");
    expect(html).toContain("gemini");
  });
  it("renders the goal + task fields and a dispatch button", () => {
    const html = renderComposerHTML(opts);
    expect(html).toContain("so that");
    expect(html).toContain('data-action="dispatch"');
    expect(html).toContain('data-action="new-role"');
  });
  it("titles the modal 'Dispatch a new agent' with the Working-lane subtitle and a brand mark", () => {
    const html = renderComposerHTML(opts);
    expect(html).toContain("Dispatch a new agent");
    expect(html).not.toContain(">New Agent<");
    expect(html).toContain("Joins the Working lane on branch");
    expect(html).toContain("composer-eq--brand");
  });
  it("renders compact role chips (single-line: role + engine, no multi-line snippet block)", () => {
    const html = renderComposerHTML(opts);
    expect(html).toContain('class="chip-role"');
    expect(html).toContain('class="chip-engine"');
    expect(html).not.toContain('class="chip-snippet"');
  });
  it("renders a Cancel button in the footer that reuses close-composer, plus an accent mark on Dispatch", () => {
    const html = renderComposerHTML(opts);
    expect(html).toContain('class="composer-cancel"');
    expect(html).toContain(">Cancel<");
    // The Cancel button reuses the existing modal-close action (no new verb).
    const closes = html.match(/data-action="close-composer"/g) ?? [];
    expect(closes.length).toBeGreaterThanOrEqual(2);
    expect(html).toContain("composer-eq--accent");
  });
  it("escapes role names and instruction snippets (no markup injection)", () => {
    const evil = composerOptions(
      [{ name: "<img src=x>", instructions: "<script>alert(1)</script>", engine: { id: "copilot" }, autonomy: "manual" }],
      [],
    );
    const html = renderComposerHTML(evil);
    expect(html).not.toContain("<img src=x>");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;img");
    // The role name also rides a data-role="..." attribute; a raw payload there
    // would break out of the attribute. Confirm it is escaped in that context too.
    expect(html).not.toContain('data-role="<img');
  });

  it("escapes a quote-bearing role name so it cannot break out of an attribute", () => {
    const evil = composerOptions(
      [{ name: 'evil" onmouseover="x', instructions: "", engine: { id: "copilot" }, autonomy: "manual" }],
      [],
    );
    const html = renderComposerHTML(evil);
    expect(html).not.toContain('onmouseover="x');
    expect(html).toContain("&quot;");
  });
});
