/**
 * Single-page app protocol: the merged webview<->host vocabulary for the future
 * one-page webview that replaces the three separate panels (Board/Stage, Library,
 * Anatomy), the Review panel, and the in-session History tab.
 *
 * This module is PURELY ADDITIVE. It does not redefine any existing message; it
 * unions the three host-bound protocols and their host->webview counterparts so a
 * single router + a single host dispatcher can speak all of them.
 *
 * Correctness rests on one verified invariant: the three webview->host unions are
 * `type`-literal DISJOINT (zero overlapping discriminants). Because of that, the
 * composed guard `isAppMessage` is unambiguous: at most one of the three
 * per-protocol guards can return true for any given payload, and each guard keeps
 * its own per-field validation. If a future edit introduces a colliding `type`
 * literal across these unions, this composition becomes ambiguous and must be
 * revisited.
 *
 * NO node imports in this file (it is consumed by the webview-facing router).
 */

import {
  isWebviewMessage,
  type HostToWebview,
  type WebviewToHost,
} from "@hallucinate/cockpit";
import {
  isLibraryMessage,
  type HostToLibrary,
  type LibraryToHost,
} from "./library-protocol.js";
import {
  isAnatomyMessage,
  type AnatomyToHost,
  type HostToAnatomy,
} from "./anatomy-protocol.js";
import type { HostToReview } from "./review-render.js";

// ─── Navigation ────────────────────────────────────────────────────────────────

/** Which surface the single-page app is currently showing. */
export type AppView = "board" | "library" | "anatomy" | "review" | "history";

/**
 * Host -> webview navigation message. New to the single-page app: tells the
 * router which surface to mount. Not part of any legacy protocol.
 */
export interface SetViewMessage {
  type: "set-view";
  view: AppView;
}

/** One team option the in-page task composer offers, with its specialist count. */
export interface TaskComposerTeam {
  /** Team name (the value posted back as `launch-team { name }`). */
  name: string;
  /** How many specialists (roles) the team has, for the chip sub-label. */
  specialists: number;
}

/**
 * Host -> webview: open the in-page task composer (the "+ New task" funnel). Sent
 * by the board after a FRESH read of .hallucinate/. TEAMS are the unit of a task
 * run, so the composer is ONE in-page surface (no native OS dropdown) offering
 * ONLY team selection: a chip selector picks one of `teams` (the first preselected)
 * and a textarea collects the task. On submit the webview posts
 * `launch-team { name, task }`. When `teams` is empty the composer shows an
 * in-page create-team CTA instead, with NO standalone default-agent path.
 */
export interface OpenTaskComposerMessage {
  type: "open-task-composer";
  teams: TaskComposerTeam[];
}

// ─── Merged unions ───────────────────────────────────────────────────────────────

/**
 * Every message the single-page webview can send OUT to the host. The union of
 * the three vocabulary-disjoint host-bound protocols.
 */
export type AppToHost = WebviewToHost | LibraryToHost | AnatomyToHost;

/**
 * Every message the host can send INTO the single-page webview: the three
 * panels' host->webview messages, the Review panel's state message, plus the new
 * `set-view` navigation message.
 */
export type HostToApp =
  | HostToWebview
  | HostToLibrary
  | HostToAnatomy
  | HostToReview
  | SetViewMessage
  | OpenTaskComposerMessage;

// ─── Runtime guard ────────────────────────────────────────────────────────────

/**
 * Pure runtime guard for the merged webview->host boundary. The webview is a
 * separate, potentially-compromised JS context, so its postMessage payloads are
 * untrusted `unknown`. This composes the three existing per-protocol guards, so
 * each message keeps the exact per-field validation it had before. Because the
 * three unions are `type`-literal disjoint, at most one branch can match, making
 * the narrowing to `AppToHost` precise.
 */
export function isAppMessage(m: unknown): m is AppToHost {
  return isWebviewMessage(m) || isLibraryMessage(m) || isAnatomyMessage(m);
}
