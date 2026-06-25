import * as vscode from "vscode";
import { makeNonce } from "./app-html.js";

/**
 * The Maestro activity-bar launcher. A tiny webview view that gives the
 * extension a persistent icon on the left activity bar (the roster tree was
 * removed; the wide board lives as an editor "hero", which an activity-bar icon
 * cannot host directly). Clicking the icon reveals this launcher; its cards
 * open the board, spawn an agent, or jump to the Library.
 *
 * Interaction is explicit message passing, NOT `command:` href links. Command
 * URIs in a WebviewView proved unreliable (a click did nothing), so a small
 * nonce-gated script posts the card's command id and the provider executes it,
 * but only against a fixed allowlist so the webview can never run an arbitrary
 * command. There is no user content in the markup, so nothing needs escaping.
 *
 * The launcher is on-brand with the rest of Maestro: graphite tokens, the
 * equalizer "signal" mark, Manrope display type, and a tidy card menu. The only
 * dynamic input is a single boolean (is a folder open) used to pick the footer
 * line.
 */
const HOME_VIEW_ID = "maestro.home";

const ALLOWED_COMMANDS = ["maestro.openStage", "maestro.newAgent", "maestro.openLibrary"];

class MaestroHomeProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true };
    // Run only allowlisted commands. The webview posts { command } on a card
    // click; anything not in ALLOWED_COMMANDS is dropped, so a compromised
    // webview cannot execute an arbitrary VS Code command.
    view.webview.onDidReceiveMessage((msg: unknown) => {
      const command = (msg as { command?: unknown } | null)?.command;
      if (typeof command === "string" && ALLOWED_COMMANDS.includes(command)) {
        void vscode.commands.executeCommand(command);
      }
    });
    this.render();
  }

  /** Re-render with the current workspace state (cheap; the markup is static). */
  render(): void {
    if (!this.view) return;
    const hasFolder = (vscode.workspace.workspaceFolders?.length ?? 0) > 0;
    this.view.webview.html = homeHtml(hasFolder, makeNonce());
  }
}

export function registerMaestroHomeView(context: vscode.ExtensionContext): void {
  const provider = new MaestroHomeProvider();
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(HOME_VIEW_ID, provider),
    // Keep the footer hint honest: when the user opens or closes a folder, the
    // launcher refreshes so "Open a folder to begin." never lingers on a real
    // workspace (and vice versa).
    vscode.workspace.onDidChangeWorkspaceFolders(() => provider.render()),
  );
}

/**
 * Static launcher markup. The only dynamic value is `hasFolder`, which selects
 * one of two fixed footer lines; there is no user-supplied content, so no
 * escaping is needed. Graphite tokens only, no em dashes.
 */
function homeHtml(hasFolder: boolean, nonce: string): string {
  const footer = hasFolder
    ? `<div class="hint hint--ready">
        <span class="hint-dot" aria-hidden="true"></span>
        <span>Ready to conduct.</span>
      </div>`
    : `<div class="hint">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M1.8 4.2c0-0.7 0.6-1.2 1.3-1.2h3l1.4 1.6h4.4c0.7 0 1.3 0.6 1.3 1.3v5.6c0 0.7-0.6 1.3-1.3 1.3H3.1c-0.7 0-1.3-0.6-1.3-1.3V4.2Z"/>
        </svg>
        <span>Open a folder to begin.</span>
      </div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Maestro</title>
<style>
  :root {
    /* Backgrounds */
    --bg-stage: #161618;
    --bg-panel: #1c1c20;
    --bg-inset: #19191c;
    --bg-card: #26262c;
    --bg-raised: #2e2e36;
    --bg-code: #1a1a1e;
    /* Borders */
    --border: #33333c;
    --border-hover: #41414a;
    --border-subtle: #232328;
    /* Text */
    --text-primary: #ededf1;
    --text-secondary: #cdcdd3;
    --text-tertiary: #83838b;
    --text-ghost: #6c6c74;
    --text-faint: #5e5e66;
    /* Accents */
    --accent-blue: #8ab8ff;
    --accent-amber: #e2b35a;
    --accent-green: #7fd9a8;
    --on-accent: #161618;
    /* Fonts */
    --font-display: "Manrope", system-ui, sans-serif;
    --font-body: "Inter", system-ui, sans-serif;
    --font-mono: "JetBrains Mono", ui-monospace, monospace;
  }

  * {
    box-sizing: border-box;
  }

  html, body {
    margin: 0;
    padding: 0;
  }

  body {
    background: var(--bg-stage);
    color: var(--text-secondary);
    font-family: var(--font-body);
    font-size: 13px;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
  }

  .shell {
    padding: 16px 14px 18px;
    max-width: 320px;
    margin: 0 auto;
  }

  /* ---------- Brand header ---------- */
  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 2px 2px 14px;
    border-bottom: 1px solid var(--border-subtle);
    margin-bottom: 16px;
  }

  .brand-mark {
    flex: 0 0 auto;
    display: block;
  }

  .brand-text {
    min-width: 0;
  }

  .wordmark {
    font-family: var(--font-display);
    font-weight: 700;
    font-size: 16px;
    letter-spacing: -0.01em;
    color: var(--text-primary);
    line-height: 1.1;
  }

  .tagline {
    font-size: 11.5px;
    color: var(--text-tertiary);
    margin-top: 3px;
    line-height: 1.35;
  }

  /* ---------- Card list ---------- */
  .menu {
    display: flex;
    flex-direction: column;
    gap: 9px;
  }

  .card {
    display: flex;
    align-items: flex-start;
    gap: 11px;
    padding: 12px 12px;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 9px;
    text-decoration: none;
    color: inherit;
    cursor: pointer;
    transition: background 120ms ease, border-color 120ms ease, transform 120ms ease;
  }

  .card:hover {
    background: var(--bg-raised);
    border-color: var(--border-hover);
  }

  .card:active {
    transform: translateY(1px);
  }

  .card:focus-visible {
    outline: 2px solid var(--accent-blue);
    outline-offset: 2px;
  }

  /* Icon holder */
  .card-icon {
    flex: 0 0 auto;
    width: 30px;
    height: 30px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 7px;
    background: var(--bg-inset);
    border: 1px solid var(--border-subtle);
    color: var(--text-tertiary);
    transition: color 120ms ease, border-color 120ms ease, background 120ms ease;
  }

  .card-icon svg {
    display: block;
    width: 16px;
    height: 16px;
  }

  .card:hover .card-icon {
    color: var(--text-secondary);
    border-color: var(--border-hover);
  }

  .card-body {
    min-width: 0;
    padding-top: 1px;
  }

  .card-title {
    font-family: var(--font-display);
    font-weight: 600;
    font-size: 13px;
    color: var(--text-primary);
    line-height: 1.25;
  }

  .card-desc {
    font-size: 11.5px;
    color: var(--text-tertiary);
    margin-top: 2px;
    line-height: 1.35;
  }

  .card:hover .card-desc {
    color: var(--text-secondary);
  }

  /* ---------- Primary card (accented) ---------- */
  .card--primary {
    border-color: #3a4660;
    background:
      linear-gradient(180deg, rgba(138, 184, 255, 0.07), rgba(138, 184, 255, 0.015));
    position: relative;
  }

  .card--primary:hover {
    border-color: #4c5d80;
    background:
      linear-gradient(180deg, rgba(138, 184, 255, 0.11), rgba(138, 184, 255, 0.03));
  }

  .card--primary .card-icon {
    background: rgba(138, 184, 255, 0.10);
    border-color: rgba(138, 184, 255, 0.30);
    color: var(--accent-blue);
  }

  .card--primary:hover .card-icon {
    background: rgba(138, 184, 255, 0.16);
    border-color: rgba(138, 184, 255, 0.45);
    color: var(--accent-blue);
  }

  .card--primary .card-title {
    color: var(--text-primary);
  }

  .card--primary .eyebrow {
    display: block;
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 500;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--accent-blue);
    opacity: 0.85;
    margin-bottom: 6px;
  }

  /* ---------- Footer hint ---------- */
  .hint {
    margin-top: 16px;
    padding-top: 13px;
    border-top: 1px solid var(--border-subtle);
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 11px;
    color: var(--text-faint);
  }

  .hint svg {
    flex: 0 0 auto;
    width: 13px;
    height: 13px;
    color: var(--text-ghost);
  }

  .hint-dot {
    flex: 0 0 auto;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent-green);
    box-shadow: 0 0 0 3px rgba(127, 217, 168, 0.14);
  }
</style>
</head>
<body>
  <div class="shell">

    <!-- Brand header -->
    <header class="brand">
      <svg class="brand-mark" width="26" height="26" viewBox="0 0 26 26" fill="none" aria-hidden="true">
        <rect x="2"  y="9"  width="3.4" height="8"  rx="1.2" fill="#8ab8ff" opacity="0.55"/>
        <rect x="7.2" y="5"  width="3.4" height="16" rx="1.2" fill="#8ab8ff" opacity="0.78"/>
        <rect x="12.4" y="2" width="3.4" height="22" rx="1.2" fill="#8ab8ff"/>
        <rect x="17.6" y="6" width="3.4" height="14" rx="1.2" fill="#8ab8ff" opacity="0.78"/>
        <rect x="22.8" y="10" width="3.2" height="6" rx="1.2" fill="#8ab8ff" opacity="0.55"/>
      </svg>
      <div class="brand-text">
        <div class="wordmark">Maestro</div>
        <div class="tagline">Conduct a team of AI coding agents.</div>
      </div>
    </header>

    <!-- Action cards -->
    <nav class="menu" aria-label="Maestro actions">

      <!-- Primary: Open Conducting Board -->
      <a class="card card--primary" role="button" tabindex="0" data-command="maestro.openStage">
        <span class="card-icon" aria-hidden="true">
          <svg viewBox="0 0 16 16" fill="none">
            <rect x="2"  y="8"  width="2.2" height="5" rx="0.9" fill="currentColor" opacity="0.6"/>
            <rect x="5.6" y="5" width="2.2" height="8" rx="0.9" fill="currentColor" opacity="0.82"/>
            <rect x="9.2" y="2.5" width="2.2" height="10.5" rx="0.9" fill="currentColor"/>
            <rect x="12.8" y="6.5" width="2.2" height="6.5" rx="0.9" fill="currentColor" opacity="0.82"/>
          </svg>
        </span>
        <span class="card-body">
          <span class="eyebrow">Start here</span>
          <span class="card-title">Open Conducting Board</span>
          <span class="card-desc">Watch and steer your agents.</span>
        </span>
      </a>

      <!-- New agent -->
      <a class="card" role="button" tabindex="0" data-command="maestro.newAgent">
        <span class="card-icon" aria-hidden="true">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="8" cy="5.5" r="2.6"/>
            <path d="M3.2 13c0-2.4 2.1-3.8 4.8-3.8 1 0 1.9 0.2 2.6 0.55"/>
            <path d="M12.2 10.4v4.2M10.1 12.5h4.2"/>
          </svg>
        </span>
        <span class="card-body">
          <span class="card-title">New agent</span>
          <span class="card-desc">Define a role, dispatch it.</span>
        </span>
      </a>

      <!-- Library -->
      <a class="card" role="button" tabindex="0" data-command="maestro.openLibrary">
        <span class="card-icon" aria-hidden="true">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M8 4.2 2.4 6.5 8 8.8l5.6-2.3L8 4.2Z"/>
            <path d="M2.4 9.2 8 11.5l5.6-2.3"/>
            <path d="M2.4 11.9 8 14.2l5.6-2.3"/>
          </svg>
        </span>
        <span class="card-body">
          <span class="card-title">Library</span>
          <span class="card-desc">Agents, teams, skills.</span>
        </span>
      </a>

    </nav>

    <!-- Footer hint -->
    ${footer}

  </div>
  <script nonce="${nonce}">
    (function () {
      const vscode = acquireVsCodeApi();
      function run(el) {
        const command = el.getAttribute("data-command");
        if (command) vscode.postMessage({ command: command });
      }
      for (const el of document.querySelectorAll("[data-command]")) {
        el.addEventListener("click", function () { run(el); });
        el.addEventListener("keydown", function (e) {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); run(el); }
        });
      }
    })();
  </script>
</body>
</html>`;
}
