const NONCE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** A 32-char alphanumeric CSP nonce from the Web Crypto CSPRNG (a global in
 *  both Node 18+ and the browser, so this file stays browser-bundle-safe). */
export function makeNonce(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let s = "";
  for (const b of bytes) {
    s += NONCE_ALPHABET.charAt(b % NONCE_ALPHABET.length);
  }
  return s;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/`/g, "&#96;");
}

/**
 * Preconnect + stylesheet links for the prototype's three webfonts (Manrope for
 * display/headings, Inter for body, JetBrains Mono for code/paths/metadata).
 * Loaded from Google Fonts; the CSP fonts below must allow fonts.googleapis.com
 * (the CSS) and fonts.gstatic.com (the woff2 files).
 */
export const FONT_HEAD_LINKS =
  `<link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@500;600;700;800&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />`;

/**
 * Build the CSP meta content. `styleInline` adds 'unsafe-inline' to style-src
 * (the review panel renders inline styles). Both Google Fonts origins are always
 * allowed so the webfonts load: fonts.googleapis.com (CSS) + fonts.gstatic.com
 * (woff2 in font-src).
 */
export function csp(cspSource: string, nonce: string, styleInline = false): string {
  const styleSrc = `style-src ${cspSource}${styleInline ? " 'unsafe-inline'" : ""} https://fonts.googleapis.com`;
  return `default-src 'none'; img-src ${cspSource} https: data:; ${styleSrc}; font-src https://fonts.gstatic.com; script-src 'nonce-${nonce}';`;
}
