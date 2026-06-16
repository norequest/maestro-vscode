import { makeNonce, escapeHtml } from "./html.js";

export { makeNonce, escapeHtml };

/**
 * The Library webview shell. scriptUri/styleUri are webview-safe URIs;
 * cspSource is webview.cspSource. Mirrors getStageHtml's CSP/nonce pattern exactly.
 */
export function getLibraryHtml(
  scriptUri: string,
  styleUri: string,
  nonce: string,
  cspSource: string
): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} https: data:; style-src ${cspSource}; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link href="${styleUri}" rel="stylesheet" />
  <title>Maestro Library</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}
