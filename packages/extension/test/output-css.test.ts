import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

/**
 * Regression lock for the Output (and sibling) panels' wrapping CSS. A long
 * unbreakable token (e.g. a base64 blob streamed into `card.output`) must not be
 * able to blow out the width-clamped inspector drawer. The `.output` rule must
 * keep `white-space:pre-wrap` (so REAL newlines still render as line breaks) AND
 * carry `overflow-wrap:anywhere` (the standardized property that breaks
 * unbreakable runs and reduces the element's min-content width, which the legacy
 * `word-break:break-word` alias does NOT do reliably in Chromium).
 *
 * This reads the actual app.css; app-html.test.ts only checks the file is linked.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const css = readFileSync(path.join(here, "..", "src", "webview", "app.css"), "utf8");

/** Whitespace-insensitive presence check for a CSS declaration. */
function declares(rule: string, prop: string, value: string): boolean {
  const re = new RegExp(`${prop}\\s*:\\s*${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i");
  return re.test(rule);
}

/** Extract the body of the first rule whose selector list contains `selector`. */
function ruleBody(selector: string): string {
  const idx = css.indexOf(selector);
  expect(idx, `selector ${selector} not found in app.css`).toBeGreaterThanOrEqual(0);
  const open = css.indexOf("{", idx);
  const close = css.indexOf("}", open);
  return css.slice(open + 1, close);
}

describe("app.css output panel wrapping", () => {
  it(".output rule keeps pre-wrap AND adds overflow-wrap:anywhere", () => {
    const body = ruleBody(".output");
    expect(declares(body, "white-space", "pre-wrap")).toBe(true);
    expect(declares(body, "overflow-wrap", "anywhere")).toBe(true);
  });

  it(".output rule clamps width and scrolls a huge blob inside the box", () => {
    const body = ruleBody(".output");
    expect(declares(body, "max-width", "100%")).toBe(true);
    expect(declares(body, "min-width", "0")).toBe(true);
    expect(declares(body, "overflow", "auto")).toBe(true);
  });

  it("sibling .instr-body and .error rules also get overflow-wrap:anywhere", () => {
    expect(declares(ruleBody(".instr-body"), "overflow-wrap", "anywhere")).toBe(true);
    expect(declares(ruleBody(".error"), "overflow-wrap", "anywhere")).toBe(true);
  });
});
