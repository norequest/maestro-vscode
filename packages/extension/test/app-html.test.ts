import { describe, expect, it } from "vitest";
import { getAppHtml } from "../src/app-html.js";

describe("getAppHtml", () => {
  const html = getAppHtml("app-main.js", "app.css", "ABC123", "vscode-resource:");

  it("embeds the script with the nonce", () => {
    expect(html).toContain('nonce="ABC123"');
    expect(html).toContain("app-main.js");
  });

  it("links the merged app.css as its one local stylesheet", () => {
    // Exactly one <link> points at the styleUri. (The Google Fonts CSS link from
    // FONT_HEAD_LINKS is the only OTHER rel=stylesheet, and it is an https origin,
    // not a local stylesheet.)
    expect((html.match(/href="app\.css"/g) ?? []).length).toBe(1);
    const localStylesheets = (html.match(/href="[^"]*"\s+rel="stylesheet"/g) ?? []).filter(
      (l) => !l.includes("fonts.googleapis.com"),
    );
    expect(localStylesheets.length).toBe(1);
    expect(localStylesheets[0]).toContain("app.css");
  });

  it("has a #root mount point", () => {
    expect(html).toContain('<div id="root"></div>');
  });

  it("titles the panel 'Board'", () => {
    expect(html).toContain("<title>Board</title>");
  });

  it("CSP allows inline style (the in-page review fragment ships its own <style>)", () => {
    const cspMatch = html.match(/Content-Security-Policy" content="([^"]+)"/);
    expect(cspMatch).not.toBeNull();
    const policy = cspMatch![1]!;
    const styleSrc = policy
      .split(";")
      .map((d) => d.trim())
      .find((d) => d.startsWith("style-src"));
    expect(styleSrc).toBeDefined();
    expect(styleSrc).toContain("'unsafe-inline'");
  });

  it("keeps script-src nonce-locked (only inline STYLE is relaxed, never inline script)", () => {
    const cspMatch = html.match(/Content-Security-Policy" content="([^"]+)"/);
    const policy = cspMatch![1]!;
    const scriptSrc = policy
      .split(";")
      .map((d) => d.trim())
      .find((d) => d.startsWith("script-src"));
    expect(scriptSrc).toBe("script-src 'nonce-ABC123'");
    expect(scriptSrc).not.toContain("'unsafe-inline'");
  });
});
