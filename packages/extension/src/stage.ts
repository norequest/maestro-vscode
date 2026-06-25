import * as vscode from "vscode";
import { type CockpitState, type ComposerOptions } from "@hallucinate/cockpit";
import type { CardVM } from "@hallucinate/cockpit";
import { getAppHtml, makeNonce } from "./app-html.js";
import { isAppMessage, type AppToHost, type AppView, type TaskComposerTeam } from "./app-protocol.js";
import type { LibrarySnapshot, HostToLibrary } from "./library-protocol.js";
import type { AnatomyVM } from "./anatomy-protocol.js";
import type { ReviewOpenOpts } from "./review-render.js";

/**
 * The single "Board" webview panel: ONE editor tab hosting the board,
 * library, anatomy, and review surfaces in-place (the app-main.js router swaps
 * them). This stays a THIN transport: it guards inbound messages with
 * isAppMessage and forwards them to one onMessage callback, and exposes typed
 * post methods the host wires its controllers to.
 *
 * It caches the last of each domain's outbound state so a freshly-attached (or
 * re-revealed) webview can replay first paint when it posts `ready`.
 */
export class StageWebviewPanel {
  private panel: vscode.WebviewPanel | undefined;

  // First-paint replay caches: the last state pushed for each surface.
  private lastState: CockpitState = { cards: [], delegations: [] };
  private lastLibrary: LibrarySnapshot | undefined;
  private lastDiscover: Extract<HostToLibrary, { type: "discover-results" }> | undefined;
  private lastAnatomy: AnatomyVM | undefined;
  private lastReview: { card: CardVM; opts: ReviewOpenOpts } | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly onMessage: (msg: AppToHost) => void,
  ) {}

  reveal(): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Active);
      return;
    }
    const panel = vscode.window.createWebviewPanel("hallucinate.stage", "Board", vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "dist")],
    });
    this.panel = panel;
    const webview = panel.webview;
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "webview", "app-main.js")).toString();
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "webview", "app.css")).toString();
    webview.html = getAppHtml(scriptUri, styleUri, makeNonce(), webview.cspSource);
    // The webview is a separate, untrusted JS context. Validate every inbound
    // payload at the boundary with the composed isAppMessage guard and drop
    // anything that is not a real AppToHost before forwarding it.
    panel.webview.onDidReceiveMessage((msg: unknown) => {
      if (!isAppMessage(msg)) return;
      // "ready" replays every cached surface so a fresh webview paints in full
      // (the board state plus any library/anatomy/review snapshot already
      // computed in this session). The cockpit's own "ready" handler also runs
      // via onMessage, re-pushing the board state; the extra replays cover the
      // non-board surfaces the cockpit does not own.
      if (msg.type === "ready") {
        this.replayAll();
      }
      this.onMessage(msg);
    });
    panel.onDidDispose(() => { this.panel = undefined; });
    // Best-effort first paint. The webview's own "ready" message (sent once its
    // script loads) is the guaranteed delivery: this early post may be dropped
    // if the webview has not yet attached its message listener.
    this.post(this.lastState);
  }

  /** Re-post every cached surface (first-paint replay on `ready`). */
  private replayAll(): void {
    this.post(this.lastState);
    if (this.lastLibrary) this.postLibrary(this.lastLibrary);
    if (this.lastDiscover) this.postDiscover(this.lastDiscover);
    if (this.lastAnatomy) this.postAnatomy(this.lastAnatomy);
    if (this.lastReview) this.postReview(this.lastReview.card, this.lastReview.opts);
  }

  // ─── Board ──────────────────────────────────────────────────────────────────

  post(state: CockpitState): void {
    this.lastState = state;
    void this.panel?.webview.postMessage({ type: "state", state });
  }

  postComposer(options: ComposerOptions): void {
    void this.panel?.webview.postMessage({ type: "composer-options", options });
  }

  // ─── Library ────────────────────────────────────────────────────────────────

  postLibrary(snapshot: LibrarySnapshot): void {
    this.lastLibrary = snapshot;
    void this.panel?.webview.postMessage({ type: "library-state", snapshot });
  }

  postDiscover(msg: Extract<HostToLibrary, { type: "discover-results" }>): void {
    this.lastDiscover = msg;
    void this.panel?.webview.postMessage(msg);
  }

  // ─── Anatomy ────────────────────────────────────────────────────────────────

  postAnatomy(vm: AnatomyVM): void {
    this.lastAnatomy = vm;
    void this.panel?.webview.postMessage({ type: "anatomy-state", vm });
  }

  // ─── Review ─────────────────────────────────────────────────────────────────

  postReview(card: CardVM, opts: ReviewOpenOpts = {}): void {
    this.lastReview = { card, opts };
    void this.panel?.webview.postMessage({ type: "review-state", card, opts });
  }

  // ─── Navigation ─────────────────────────────────────────────────────────────

  /** Tell the router to switch the active surface (set-view). */
  navigate(view: AppView): void {
    void this.panel?.webview.postMessage({ type: "set-view", view });
  }

  /**
   * Open the in-page task composer (the "+ New task" funnel). TEAMS are the unit
   * of a task run, so `teams` (name + specialist count) are the ONLY options the
   * composer offers, the first preselected. The whole choice happens inside the
   * one page: no native VS Code dropdown. On submit the webview posts
   * `launch-team { name, task }`. When `teams` is empty the composer shows an
   * in-page create-team CTA instead, with no standalone default-agent path.
   */
  openTaskComposer(teams: TaskComposerTeam[]): void {
    void this.panel?.webview.postMessage({ type: "open-task-composer", teams });
  }

  get isOpen(): boolean {
    return this.panel !== undefined;
  }
}
