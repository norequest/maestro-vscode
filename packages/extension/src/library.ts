import * as vscode from "vscode";
import { createLibrary } from "./library-controller.js";
import { getLibraryHtml, makeNonce } from "./library-html.js";
import { isLibraryMessage } from "./library-protocol.js";
import type { LibrarySnapshot } from "./library-protocol.js";
import type { ConfigGateway } from "./library-controller.js";

/**
 * Singleton Library webview panel.
 * Mirrors StageWebviewPanel: full-screen panel, CSP/nonce, isLibraryMessage guard,
 * and a createLibrary controller wired to push snapshots into the webview.
 */
export class LibraryWebviewPanel {
  private panel: vscode.WebviewPanel | undefined;
  private lastSnapshot: LibrarySnapshot | undefined;
  private readonly library: ReturnType<typeof createLibrary>;

  constructor(
    private readonly extensionUri: vscode.Uri,
    gateway: ConfigGateway,
  ) {
    // Wire the controller: onSnapshot posts the new state to the webview.
    this.library = createLibrary(gateway, (snap) => {
      this.lastSnapshot = snap;
      this.post(snap);
    });
  }

  reveal(): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Active);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      "maestro.library",
      "Maestro Library",
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "dist")],
      },
    );
    this.panel = panel;
    const webview = panel.webview;
    const scriptUri = webview
      .asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "webview", "library-main.js"))
      .toString();
    const styleUri = webview
      .asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "webview", "library.css"))
      .toString();
    webview.html = getLibraryHtml(scriptUri, styleUri, makeNonce(), webview.cspSource);

    // Validate every inbound message at the boundary; drop anything malformed.
    panel.webview.onDidReceiveMessage((msg: unknown) => {
      if (isLibraryMessage(msg)) {
        void this.library.handle(msg);
      }
    });
    panel.onDidDispose(() => { this.panel = undefined; });

    // Best-effort first paint; the webview's "open-library" message is the guaranteed path.
    if (this.lastSnapshot) {
      this.post(this.lastSnapshot);
    }
  }

  post(snapshot: LibrarySnapshot): void {
    void this.panel?.webview.postMessage({ type: "library-state", snapshot });
  }

  get isOpen(): boolean {
    return this.panel !== undefined;
  }
}
