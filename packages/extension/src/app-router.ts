/**
 * The single inbound dispatcher for the one "Conducting Board" panel, extracted
 * as a PURE factory (no vscode, no node) so it unit-tests against fake handlers.
 *
 * Every webview message is an AppToHost (already guarded by isAppMessage at the
 * panel boundary). This branches by SOURCE protocol using the three existing
 * per-protocol guards:
 *   - cockpit (board)  -> onBoard
 *   - library          -> the 5 discover types go to onDiscover, the rest to onLibrary
 *                         (EXACTLY the split the old LibraryWebviewPanel did)
 *   - anatomy          -> onAnatomy
 *
 * The discover split is the SAME five message types the dedicated panel routed to
 * the discover controller, kept verbatim so behaviour is unchanged.
 */

import { isWebviewMessage, type WebviewToHost } from "@maestro/cockpit";
import { isLibraryMessage, type LibraryToHost } from "./library-protocol.js";
import { isAnatomyMessage, type AnatomyToHost } from "./anatomy-protocol.js";
import type { AppToHost } from "./app-protocol.js";

/** The five library->host messages the discover controller owns (not the library). */
export type DiscoverToHost = Extract<
  LibraryToHost,
  { type: "scan-repo" | "scan-plugins" | "adopt-agent" | "adopt-skill" | "browse-source" }
>;

const DISCOVER_TYPES = new Set<LibraryToHost["type"]>([
  "scan-repo",
  "scan-plugins",
  "adopt-agent",
  "adopt-skill",
  "browse-source",
]);

/** Type predicate narrowing a library message to the discover subset. */
function isDiscoverMessage(msg: LibraryToHost): msg is DiscoverToHost {
  return DISCOVER_TYPES.has(msg.type);
}

export interface AppRouterHandlers {
  onBoard(msg: WebviewToHost): void;
  onLibrary(msg: Exclude<LibraryToHost, DiscoverToHost>): void;
  onDiscover(msg: DiscoverToHost): void;
  onAnatomy(msg: AnatomyToHost): void;
}

/**
 * Build the single message router. Returns a dispatcher that fans an AppToHost
 * message out to the matching handler.
 */
export function makeAppRouter(handlers: AppRouterHandlers): (msg: AppToHost) => void {
  return (msg: AppToHost): void => {
    if (isWebviewMessage(msg)) {
      handlers.onBoard(msg);
      return;
    }
    if (isLibraryMessage(msg)) {
      if (isDiscoverMessage(msg)) {
        handlers.onDiscover(msg);
      } else {
        handlers.onLibrary(msg);
      }
      return;
    }
    if (isAnatomyMessage(msg)) {
      handlers.onAnatomy(msg);
      return;
    }
  };
}
