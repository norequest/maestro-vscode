import { makeNonce, FONT_HEAD_LINKS, csp } from "./html.js";

export { makeNonce };

/**
 * The single-page app shell ("Board"). Mirrors getStageHtml but is the
 * ONE webview shell for the whole extension: the board, library, anatomy, and
 * review surfaces all live inside `#root`, swapped in-place by the app-main.js
 * router.
 *
 * CSP differs from the board-only getStageHtml in ONE way: style-src carries
 * 'unsafe-inline' (styleInline=true). The in-page review fragment ships its own
 * scoped `<style>` block (review keeps its inline styles), so the merged page
 * must allow inline style. Script stays nonce-locked; only inline STYLE is
 * relaxed, not inline script.
 *
 * scriptUri/styleUri are webview-safe URIs; cspSource is webview.cspSource.
 */
export function getAppHtml(
  scriptUri: string,
  styleUri: string,
  nonce: string,
  cspSource: string,
): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp(cspSource, nonce, true)}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  ${FONT_HEAD_LINKS}
  <link href="${styleUri}" rel="stylesheet" />
  <title>Board</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}
