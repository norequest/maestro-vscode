/**
 * Full-width review screen renderer. Pure HTML, no DOM, no vscode.
 * DOM structure mirrors the approved Claude Design prototype
 * (docs/design-reference/Hallucinate-prototype.html, lines 1002-1118):
 * a header band, a two-region body (264px changed-files rail + a right column
 * holding a "what changed" band, an optional conflict bar, a file-path header,
 * and the scrolling unified diff), and a sticky decision footer.
 * All engine/git strings are escaped. Palette is emitted as fixed hex;
 * never var(--vscode-*).
 */

import type { CardVM } from "@hallucinate/cockpit";
import { escapeHtml } from "./html.js";
import type { ParsedDiff, DiffFileChange, DiffLine } from "./diff-parse.js";

/** Options forwarded to the review screen when opening or refreshing a card. */
export interface ReviewOpenOpts {
  prMode?: boolean;
  prDraft?: boolean;
  retainBranch?: boolean;
}

/** Host-to-review message telling the webview which card to render. */
export interface HostToReview {
  type: "review-state";
  card: CardVM;
  opts: ReviewOpenOpts;
}

// ─── Palette (fixed hex, R2: never var(--vscode-*)) ─────────────────────────

// Every value below is a TOKENS.md value (docs/design-reference/TOKENS.md).
// Earlier passes leaked warmer, saturated diff accents (two off-token greens
// and an off-token blue); per TOKENS.md the canonical desaturated tokens win
// over the prototype's raw diff hexes, so diff-add is the tokens green and the
// diff meta/hunk blue is the tokens accent.
const C = {
  bg: "#161618",
  bgPanel: "#1a1a1e",
  bgBand: "#1a1a1e",
  bgPathHeader: "#1a1a1e",
  bgDiff: "#161618",
  bgCard: "#26262c",
  bgCardRaised: "#2e2e36",
  bgSurfaceLow: "#202026",
  bgCardBorder: "#33333c",
  borderHeader: "#2a2a30",
  borderSubtle: "#2a2a30",
  borderControl: "#36363e",
  scrollThumb: "#34343a",
  scrollThumbHover: "#46464e",
  // Quiet-blue hunk band.
  bgHunkHeader: "rgba(74,155,255,0.06)",
  rowAdd: "rgba(70,201,138,0.11)",
  rowDel: "rgba(240,96,107,0.11)",
  textPrimary: "#ededf1",
  textName: "#ededf1",
  textSecondary: "#dcdce0",
  textTertiary: "#9a9aa2",
  textMuted: "#83838b",
  textDir: "#6c6c74",
  textContext: "#cdcdd3",
  textBody: "#b9b9c0",
  textGoal: "#6c6c74",
  diffAdd: "#7fd9a8",
  diffDel: "#f0848c",
  diffMeta: "#8ab8ff",
  diffContext: "#b9b9c0",
  hunkText: "#8ab8ff",
  addDot: "#46c98a",
  modDot: "#83838b",
  delDot: "#f0848c",
  addText: "#7fd9a8",
  delText: "#f0848c",
  // Accent blue kept available for focus rings + tests that assert it.
  accentBlue: "#8ab8ff",
  lineNo: "#5e5e66",
  eyebrow: "#5e5e66",
  gutterAdd: "#7fd9a8",
  gutterDel: "#f0848c",
  amber: "#e2b35a",
  amberDim: "#e2a93c",
  green: "#7fd9a8",
  greenDeep: "#46c98a",
  onPrimary: "#161618",
  danger: "#f0848c",
  borderHover: "#41414a",
} as const;

// ─── Review options ───────────────────────────────────────────────────────────

export interface ReviewOpts {
  prMode?: boolean;
  prDraft?: boolean;
  retainBranch?: boolean;
}

// ─── Slug helper ─────────────────────────────────────────────────────────────

function toSlug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    || "agent";
}

const BRANCH_ICON =
  `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0"><circle cx="6.5" cy="6" r="2.5"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="7" r="2.5"/><path d="M6.5 8.5v7M9 7h4.5a3 3 0 013 3"/></svg>`;

const FILE_ICON =
  `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="${C.textMuted}" stroke-width="1.6" style="flex-shrink:0"><path d="M13 3H6a1 1 0 00-1 1v16a1 1 0 001 1h12a1 1 0 001-1V9z"/><path d="M13 3v6h6"/></svg>`;

// ─── reviewHeader ─────────────────────────────────────────────────────────────

function reviewHeader(card: CardVM, opts: ReviewOpts): string {
  const role = escapeHtml(card.roleName);
  const engine = escapeHtml(card.engineId);
  const task = escapeHtml(card.taskDescription);
  const slug = toSlug(card.roleName || card.id);

  const prPill = opts.prMode ? `<span class="rv-pill">PR mode</span>` : "";

  const goalHtml = card.goal
    ? `<span class="rv-goal">${escapeHtml(card.goal)}</span>`
    : "";

  // TODO: CardVM carries no real worktree branch name yet, so this synthesizes
  // `agent/<slug>` from the role. When the orchestrator surfaces the actual
  // branch on the review data (e.g. card.branch), render that instead of the slug.
  const branchChip = `<span class="rv-branch">${BRANCH_ICON}<span>agent/${escapeHtml(slug)}</span> <span style="color:${C.eyebrow}">&rarr; main</span></span>`;

  // Always-available escape back to the Board. Opening the full review
  // replaces the whole board in the single-page panel, so without this the
  // user is stranded (the webview wires data-action="review-close").
  const back = `<button class="rv-back" data-action="review-close" type="button">&larr; Board</button>`;

  return `<header class="rv-header">
  ${back}
  <div class="rv-id">
    <span class="rv-role">${role}</span>
    <span class="rv-pill">${engine}</span>
    ${prPill}
  </div>
  <div class="rv-task">${task}</div>
  <div class="rv-meta">
    ${goalHtml}
    ${branchChip}
  </div>
</header>`;
}

// ─── filesRail (left 264px region) ───────────────────────────────────────────

function fileDot(status: DiffFileChange["status"], conflict: boolean): string {
  const color = conflict
    ? C.amber
    : status === "added"
      ? C.addDot
      : status === "deleted"
        ? C.delDot
        : C.modDot;
  // Rounded-square dot (2px radius), matching the prototype's file markers.
  return `<span class="rv-dot" style="background:${color}"></span>`;
}

function filesRail(files: DiffFileChange[], conflictFiles?: string[]): string {
  if (files.length === 0) return "";

  const conflictSet = new Set(conflictFiles ?? []);

  // Sort: conflict files first.
  const sorted = [...files].sort((a, b) => {
    const aConf = conflictSet.has(a.path) ? 0 : 1;
    const bConf = conflictSet.has(b.path) ? 0 : 1;
    return aConf - bConf;
  });

  const rows = sorted.map((f) => {
    const isConflict = conflictSet.has(f.path);
    const dotHtml = fileDot(f.status, isConflict);

    const parts = f.path.split("/");
    const basename = parts[parts.length - 1]!;
    const dir = parts.length > 1 ? parts.slice(0, -1).join("/") + "/" : "";

    const right = isConflict
      ? `<span class="rv-conf-chip">conflict</span>`
      : `<span class="rv-counts"><span style="color:${C.addText}">+${f.adds}</span><span style="color:${C.delText}">&minus;${f.dels}</span></span>`;

    return `<div class="rv-file-row" title="${escapeHtml(f.path)}" data-path="${escapeHtml(f.path)}">
  ${dotHtml}
  <span class="rv-file-name"><span style="color:${C.textDir}">${escapeHtml(dir)}</span><span style="color:${C.textContext}">${escapeHtml(basename)}</span></span>
  ${right}
</div>`;
  }).join("");

  return `<aside class="rv-rail">
  <div class="rv-eyebrow rv-rail-eyebrow">Changed files</div>
  <div class="rv-rail-list">${rows}</div>
</aside>`;
}

// ─── what-changed band ────────────────────────────────────────────────────────

// Brand eq-bar mark (prototype `review.eq`, Hallucinate-prototype.html line 1046):
// the four-bar equalizer that precedes the "WHAT CHANGED" eyebrow. Rendered in
// the muted eyebrow tone so it reads as a brand mark, not the green action.
const EQ_MARK =
  `<span class="rv-eq rv-eq-mark"><span></span><span></span><span></span><span></span></span>`;

function whatChangedBand(role: string, summary: string | undefined): string {
  if (!summary) return "";
  return `<div class="rv-whatchanged">
  <div class="rv-whatchanged-head">
    ${EQ_MARK}
    <div class="rv-eyebrow">What changed &middot; ${escapeHtml(role)}</div>
  </div>
  <div class="rv-summary">${escapeHtml(summary)}</div>
</div>`;
}

// ─── conflict control bar ─────────────────────────────────────────────────────

function conflictControlBar(card: CardVM, conflictFiles: string[]): string {
  const id = escapeHtml(card.id);
  const first = conflictFiles[0] ?? "";
  return `<div class="rv-conflict-bar">
  <span class="rv-conflict-title">Merge conflict</span>
  <span class="rv-conflict-path">${escapeHtml(first)}</span>
  <div class="rv-conflict-actions">
    <button class="rv-tog rv-btn-stub" data-stretch="true" data-action="keep-ours" data-id="${id}">Keep ours</button>
    <button class="rv-tog rv-btn-stub" data-stretch="true" data-action="keep-theirs" data-id="${id}">Keep theirs</button>
    <button class="rv-tog" data-action="resolve-conflict" data-id="${id}">Edit</button>
  </div>
</div>`;
}

// ─── file-path header ─────────────────────────────────────────────────────────

function filePathHeader(path: string): string {
  return `<div class="rv-path-header">
  ${FILE_ICON}
  <span class="rv-path-text">${escapeHtml(path)}</span>
</div>`;
}

// ─── diffBody ────────────────────────────────────────────────────────────────

function isConflictMarker(text: string): boolean {
  return /^(<{7}|={7}|>{7})/.test(text);
}

function renderDiffLine(line: DiffLine, isConflict: boolean): string {
  const escaped = escapeHtml(line.text);
  const oldNoStr = line.oldNo !== undefined ? String(line.oldNo) : "";
  const newNoStr = line.newNo !== undefined ? String(line.newNo) : "";
  const lineNoHtml =
    `<span class="rv-ln">${escapeHtml(oldNoStr)}</span><span class="rv-ln">${escapeHtml(newNoStr)}</span>`;

  if (line.kind === "add") {
    const marker = isConflict && isConflictMarker(line.text);
    const bg = marker ? "rgba(226,169,60,0.10)" : C.rowAdd;
    const textColor = marker ? C.amber : C.diffAdd;
    const sign = marker ? " " : "+";
    return `<div class="rv-line" style="background:${bg}">${lineNoHtml}<span class="rv-sign" style="color:${textColor}">${sign}</span><span class="rv-code" style="color:${textColor}">${escaped}</span></div>`;
  }
  if (line.kind === "del") {
    const marker = isConflict && isConflictMarker(line.text);
    const bg = marker ? "rgba(226,169,60,0.10)" : C.rowDel;
    const textColor = marker ? C.amber : C.diffDel;
    const sign = marker ? " " : "-";
    return `<div class="rv-line" style="background:${bg}">${lineNoHtml}<span class="rv-sign" style="color:${textColor}">${sign}</span><span class="rv-code" style="color:${textColor}">${escaped}</span></div>`;
  }
  // context
  return `<div class="rv-line">${lineNoHtml}<span class="rv-sign"> </span><span class="rv-code" style="color:${C.diffContext}">${escaped}</span></div>`;
}

function diffBody(files: DiffFileChange[], card: CardVM): string {
  if (files.length === 0) return "";
  const isConflictCard = card.state === "conflict";
  const conflictSet = new Set(card.conflictFiles ?? []);

  const fileBlocks = files.map((f) => {
    const isConflictFile = isConflictCard && conflictSet.has(f.path);

    const hunkHtml = f.hunks.map((hunk) => {
      const linesHtml = hunk.lines.map((l) => renderDiffLine(l, isConflictFile)).join("");
      return `<div class="rv-line rv-hunk-header"><span class="rv-ln"></span><span class="rv-ln"></span><span class="rv-sign"> </span><span class="rv-code rv-hunk-text">${escapeHtml(hunk.header)}</span></div>${linesHtml}`;
    }).join("");

    return `<div class="rv-file-block">${filePathHeader(f.path)}${hunkHtml}</div>`;
  }).join("");

  return `<div class="rv-diff">${fileBlocks}</div>`;
}

// ─── decisionBar ─────────────────────────────────────────────────────────────

function btn(label: string, action: string, id: string, variant: string, extra = ""): string {
  return `<button class="rv-btn ${variant}" data-action="${action}" data-id="${escapeHtml(id)}"${extra}>${label}</button>`;
}

function feedbackRow(): string {
  // The "Request changes" (sendBack) handler in review-main reads the textarea
  // inside this footer. Without it the button could not collect feedback to
  // re-launch the agent with. The textarea lives ON ITS OWN ROW above the
  // buttons (footer.querySelector("textarea") in review-main finds it).
  return `<div class="rv-feedback-row">
  <div class="rv-eyebrow">Request changes</div>
  <textarea class="rv-feedback" data-role="feedback" placeholder="What needs to change before this can merge?"></textarea>
</div>`;
}

function decisionBar(card: CardVM, opts: ReviewOpts, diffErrorPresent: boolean): string {
  const id = card.id;
  const primary = "rv-btn-primary";
  const danger = "rv-btn-danger";
  const secondary = "rv-btn-secondary";

  // merge-cleanup-failed: retry-cleanup primary (no feedback row).
  if (card.state === "merge-cleanup-failed") {
    return `<footer class="rv-bar">
  <div class="rv-bar-row">
    ${btn("Discard", "discard", id, danger)}
    <div class="rv-bar-actions">
      ${btn("Retry cleanup", "retry-cleanup", id, primary)}
    </div>
  </div>
</footer>`;
  }

  // conflict: finish-merge primary (Resolve and merge). The conflict decision bar
  // holds Discard, Request changes, and "Resolve and merge"; the
  // "Edit"/resolve-conflict hand-off lives in the conflict CONTROL bar above the
  // diff, not here.
  if (card.state === "conflict") {
    return `<footer class="rv-bar">
  ${feedbackRow()}
  <div class="rv-bar-row">
    ${btn("Discard", "discard", id, danger)}
    <div class="rv-bar-actions">
      ${btn("Request changes", "sendBack", id, secondary)}
      ${btn("Resolve and merge", "finish-merge", id, primary)}
    </div>
  </div>
</footer>`;
  }

  // pr-created: terminal state, just discard (no feedback row).
  if (card.state === "pr-created") {
    return `<footer class="rv-bar">
  <div class="rv-bar-row">
    <div class="rv-bar-actions">
      ${btn("Discard", "discard", id, secondary)}
    </div>
  </div>
</footer>`;
  }

  // stopped: the run did not finish. Offer Resume (relaunch in the same worktree)
  // or Discard. Never Merge: there is no completed result to land.
  if (card.state === "stopped") {
    return `<footer class="rv-bar">
  <div class="rv-bar-row">
    ${btn("Discard", "discard", id, danger)}
    <div class="rv-bar-actions">
      ${btn("Resume", "resume", id, primary)}
    </div>
  </div>
</footer>`;
  }

  // error: the run failed; there is nothing to merge, so only Discard.
  if (card.state === "error") {
    return `<footer class="rv-bar">
  <div class="rv-bar-row">
    <div class="rv-bar-actions">
      ${btn("Discard", "discard", id, danger)}
    </div>
  </div>
</footer>`;
  }

  // A done run with an EMPTY diff (computed, zero files) produced no changes, so
  // there is nothing to land: the Merge / Create PR primary is disabled (the user
  // can still Discard or send it back). A missing diff (still computing, or a
  // diffError) is handled separately and keeps merge reachable.
  const noChanges = card.state === "done" && !!card.diff && card.diff.files.length === 0;

  // PR mode: create-pr primary.
  if (opts.prMode) {
    const label = opts.prDraft ? "Create draft PR" : "Create PR";
    const prDisabled = noChanges || diffErrorPresent ? " disabled" : "";
    return `<footer class="rv-bar">
  ${feedbackRow()}
  <div class="rv-bar-row">
    ${btn("Discard", "discard", id, danger)}
    <div class="rv-bar-actions">
      ${btn("Request changes", "sendBack", id, secondary)}
      ${btn(label, "create-pr", id, primary, prDisabled)}
    </div>
  </div>
</footer>`;
  }

  // Normal: merge primary (disabled if diffError or no changes).
  const mergeDisabled = noChanges || diffErrorPresent ? " disabled" : "";
  return `<footer class="rv-bar">
  ${feedbackRow()}
  <div class="rv-bar-row">
    ${btn("Discard", "discard", id, danger)}
    <div class="rv-bar-actions">
      ${btn("Request changes", "sendBack", id, secondary)}
      <button class="rv-btn rv-btn-primary" data-action="merge" data-id="${escapeHtml(id)}"${mergeDisabled}><span class="rv-eq"><span></span><span></span><span></span><span></span></span>Merge into main</button>
    </div>
  </div>
</footer>`;
}

// ─── Conflict banner (used when no diff body) ─────────────────────────────────

function conflictBanner(conflictFiles: string[]): string {
  const n = conflictFiles.length;
  const noun = n === 1 ? "file" : "files";
  const first = conflictFiles[0] ?? "";
  return `<div class="rv-conflict-bar">
  <span class="rv-conflict-title">Merge conflict in ${n} ${noun}</span>
  <span class="rv-conflict-path">${escapeHtml(first)}</span>
</div>`;
}

// ─── Cleanup-failed recovery banner ──────────────────────────────────────────

function cleanupFailedBanner(card: CardVM, opts: ReviewOpts): string {
  const branchNote = opts.retainBranch ? "branch kept" : "branch cleaned up";
  const errorHtml = card.error
    ? `<pre class="rv-pre">${escapeHtml(card.error)}</pre>`
    : "";
  return `<div class="rv-amber-card">
  <div style="color:${C.amber};font-weight:700">Merged successfully. Worktree cleanup did not finish.</div>
  <div style="color:${C.textMuted};font-size:0.85em;margin-top:4px">${escapeHtml(branchNote)}</div>
  ${errorHtml}
  <div style="color:${C.textMuted};font-size:0.8em;margin-top:6px;font-style:italic">This is housekeeping, not data loss. Your changes are safely merged.</div>
</div>`;
}

// ─── diff-error panel ─────────────────────────────────────────────────────────

function diffErrorPanel(diffError: string): string {
  return `<div class="rv-card" style="color:${C.delText}">
  <div style="font-size:0.8em;font-weight:600;margin-bottom:4px">Could not compute diff</div>
  <pre class="rv-pre" style="color:${C.textContext}">${escapeHtml(diffError)}</pre>
</div>`;
}

// ─── run-error panel ──────────────────────────────────────────────────────────

// Shown when an `error`-state card reaches the review screen with no diff to
// render. Without this the right column was blank above a Discard-only footer.
// Mirrors diffErrorPanel's .rv-card/.rv-pre styling.
function runErrorPanel(error: string | undefined): string {
  const body = error
    ? `<pre class="rv-pre" style="color:${C.textContext}">${escapeHtml(error)}</pre>`
    : `<div style="color:${C.textContext};font-size:0.85em">This run ended with an error.</div>`;
  return `<div class="rv-card" style="color:${C.delText}">
  <div style="font-size:0.8em;font-weight:600;margin-bottom:4px">Run failed</div>
  ${body}
</div>`;
}

// ─── pr-created terminal note ─────────────────────────────────────────────────

function prCreatedNote(): string {
  return `<div class="rv-card" style="color:${C.textMuted}">
  Pull request opened. Worktree released, branch kept.
</div>`;
}

// ─── no-file-changes notice ───────────────────────────────────────────────────

// Some agents only print chat output (for example "say hello") and touch zero
// files. The diff region must say so honestly instead of rendering an empty diff
// or a misleading "+0 -0" stat. The agent's "what changed" summary still renders
// above this, so its words are preserved.
function noChangesNote(): string {
  return `<div class="rv-card" style="color:${C.textMuted}">
  No file changes. This run produced output but did not modify any files.
</div>`;
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * The review screen's inner markup PLUS its scoped `<style>` block, with NO
 * doctype/html/head/body wrapper. Use this when injecting the review screen into
 * an existing document (the single-page router drops it straight into `#root`).
 * The standalone {@link renderReview} wraps this in a full HTML document.
 *
 * The `<style>` rules use `body { ... }` / `*` selectors so they apply identically
 * whether this fragment is the whole document body or a sub-tree of one.
 */
export function renderReviewBody(card: CardVM, parsed: ParsedDiff, opts: ReviewOpts = {}): string {
  const isConflict = card.state === "conflict";
  const isCleanupFailed = card.state === "merge-cleanup-failed";
  const isPrCreated = card.state === "pr-created";
  const hasDiffError = !!card.diffError;

  const header = reviewHeader(card, opts);
  const conflictFiles = isConflict ? (card.conflictFiles ?? []) : [];
  const rail = filesRail(parsed.files, conflictFiles);
  const band = whatChangedBand(card.roleName, card.summary);

  // The right column: what-changed band, then a state-dependent body region.
  let rightBody: string;
  if (isCleanupFailed) {
    rightBody = cleanupFailedBanner(card, opts);
  } else if (isPrCreated) {
    rightBody = prCreatedNote();
  } else if (hasDiffError) {
    rightBody = diffErrorPanel(card.diffError!);
  } else if (card.state === "error") {
    // An error-state card has no diff to show; render the failure text in a
    // panel so the right column is never blank above the Discard-only footer.
    rightBody = runErrorPanel(card.error);
  } else if (isConflict && conflictFiles.length > 0) {
    rightBody =
      conflictControlBar(card, conflictFiles) +
      conflictBanner(conflictFiles) +
      diffBody(parsed.files, card);
  } else if (parsed.files.length === 0) {
    // No changed files: be honest instead of rendering an empty diff. The
    // "what changed" band above still carries the agent's summary if it wrote one.
    rightBody = noChangesNote();
  } else {
    rightBody = diffBody(parsed.files, card);
  }

  const bar = decisionBar(card, opts, hasDiffError);

  const style = `<style>
    * { box-sizing: border-box; }
    body { margin: 0; background: ${C.bg}; color: ${C.textPrimary};
      font-family: 'Inter', system-ui, sans-serif; }

    .rv-screen { display: flex; flex-direction: column; min-height: 100vh; background: ${C.bg}; }

    /* Header band */
    .rv-header { flex: 0 0 auto; padding: 16px 22px; border-bottom: 1px solid ${C.borderHeader}; background: ${C.bg}; }
    .rv-back {
      display: inline-flex; align-items: center; gap: 6px;
      margin-bottom: 13px; padding: 5px 11px;
      background: ${C.bgCard}; color: ${C.textTertiary};
      border: 1px solid ${C.borderControl}; border-radius: 7px;
      font-family: 'Inter', system-ui, sans-serif; font-size: 11.5px; font-weight: 600;
      cursor: pointer;
      transition: background 120ms ease-out, color 120ms ease-out, border-color 120ms ease-out, transform 120ms ease-out;
    }
    .rv-back:hover { background: ${C.bgCardRaised}; color: ${C.textPrimary}; border-color: ${C.borderHover}; }
    .rv-back:active { transform: translateY(1px); }
    .rv-back:focus-visible { outline: none; box-shadow: 0 0 0 2px ${C.accentBlue}; }
    .rv-id { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .rv-role { font-family: 'Manrope', sans-serif; font-weight: 700; font-size: 16px; color: ${C.textName}; }
    .rv-pill {
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px; padding: 3px 9px; border-radius: 6px;
      background: ${C.bgPanel}; color: ${C.textMuted}; border: 1px solid ${C.bgCard};
    }
    .rv-task { font-size: 13px; color: ${C.textContext}; margin-top: 8px; line-height: 1.45; }
    .rv-meta { display: flex; align-items: center; gap: 12px; margin-top: 7px; flex-wrap: wrap; }
    .rv-goal { font-size: 11.5px; color: ${C.textGoal}; font-style: italic; }
    .rv-branch {
      display: inline-flex; align-items: center; gap: 7px;
      font-family: 'JetBrains Mono', monospace; font-size: 11px; color: ${C.textTertiary};
      background: ${C.bgPanel}; border: 1px solid ${C.bgCard}; border-radius: 6px; padding: 3px 9px;
    }
    .rv-eyebrow {
      font-family: 'JetBrains Mono', monospace;
      font-size: 9.5px; letter-spacing: 0.14em; text-transform: uppercase; color: ${C.eyebrow};
    }

    /* Body: two regions */
    .rv-body { flex: 1; min-height: 0; display: flex; }

    /* Left: changed-files rail */
    .rv-rail {
      width: 264px; flex: 0 0 264px;
      border-right: 1px solid ${C.borderHeader};
      overflow: auto; padding: 14px 12px; background: ${C.bgPanel};
    }
    .rv-rail-eyebrow { margin: 2px 6px 11px; }
    .rv-rail-list { display: flex; flex-direction: column; gap: 3px; }
    .rv-file-row {
      display: flex; align-items: center; gap: 9px;
      padding: 9px 11px; border-radius: 8px; cursor: pointer;
      border: 1px solid transparent;
      transition: background 120ms ease;
    }
    .rv-file-row:hover { background: ${C.bgSurfaceLow}; }
    .rv-dot { width: 8px; height: 8px; flex: 0 0 8px; border-radius: 2px; }
    .rv-file-name {
      flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      font-family: 'JetBrains Mono', monospace; font-size: 11.5px;
    }
    .rv-counts {
      margin-left: auto; display: flex; gap: 8px; flex-shrink: 0;
      font-family: 'JetBrains Mono', monospace; font-size: 10.5px;
      font-variant-numeric: tabular-nums;
    }
    .rv-conf-chip {
      margin-left: auto; font-family: 'JetBrains Mono', monospace;
      font-size: 9px; font-weight: 600; letter-spacing: 0.06em; color: ${C.amber};
      background: rgba(226,169,60,0.12); padding: 2px 7px; border-radius: 5px;
    }

    /* Right column */
    .rv-main { flex: 1; min-width: 0; display: flex; flex-direction: column; overflow: hidden; }
    .rv-whatchanged {
      flex: 0 0 auto; padding: 14px 20px;
      border-bottom: 1px solid ${C.borderHeader}; background: ${C.bgBand};
    }
    .rv-whatchanged-head { display: flex; align-items: center; gap: 9px; margin-bottom: 9px; }
    .rv-summary { font-size: 12.5px; color: ${C.textBody}; line-height: 1.6; }

    /* Conflict control bar */
    .rv-conflict-bar {
      flex: 0 0 auto; display: flex; align-items: center; gap: 11px;
      padding: 11px 20px;
      background: rgba(226,169,60,0.08); border-bottom: 1px solid rgba(226,169,60,0.22);
    }
    .rv-conflict-title { color: ${C.amber}; font-size: 12px; font-weight: 700; }
    .rv-conflict-path { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: ${C.amberDim}; }
    .rv-conflict-actions { margin-left: auto; display: flex; gap: 7px; }
    .rv-tog {
      cursor: pointer; font-size: 11.5px; font-weight: 600;
      padding: 5px 12px; border-radius: 6px; border: 1px solid ${C.borderControl};
      background: ${C.bgCard}; color: ${C.textContext};
      font-family: 'Inter', system-ui, sans-serif;
      transition: background 120ms ease-out, transform 120ms ease-out;
    }
    .rv-tog:hover { background: ${C.bgCardRaised}; }
    .rv-tog:active:not(:disabled) { transform: translateY(1px); }

    /* File-path header */
    .rv-path-header {
      flex: 0 0 auto; display: flex; align-items: center; gap: 9px;
      padding: 10px 20px;
      border-bottom: 1px solid ${C.borderHeader}; background: ${C.bgPathHeader};
    }
    .rv-path-text { font-family: 'JetBrains Mono', monospace; font-size: 12px; color: ${C.textContext}; }

    /* Diff body */
    .rv-diff { flex: 1; min-height: 0; overflow: auto; background: ${C.bgDiff}; }
    .rv-file-block { }
    .rv-line { display: flex; align-items: baseline; }
    .rv-ln {
      flex: 0 0 46px; text-align: right; padding-right: 10px;
      color: ${C.lineNo}; font-family: 'JetBrains Mono', monospace; font-size: 12px;
      line-height: 1.7; user-select: none;
    }
    .rv-sign {
      flex: 0 0 16px; text-align: center;
      font-family: 'JetBrains Mono', monospace; font-size: 12px; line-height: 1.7;
    }
    .rv-code {
      flex: 1; white-space: pre; overflow: hidden; word-break: break-all;
      font-family: 'JetBrains Mono', monospace; font-size: 12px; line-height: 1.7;
      padding-right: 14px;
    }
    .rv-hunk-header { background: ${C.bgHunkHeader}; }
    .rv-hunk-text { color: ${C.hunkText}; }

    /* Shared card + amber recovery states (cleanup-failed / diff-error / pr-created) */
    .rv-card {
      margin: 12px 20px; padding: 12px;
      background: ${C.bgCard}; border: 1px solid ${C.bgCardBorder}; border-radius: 8px;
    }
    .rv-amber-card {
      margin: 12px 20px; padding: 11px 14px;
      background: rgba(226,169,60,0.08); border: 1px solid rgba(226,169,60,0.30);
      border-left: 4px solid ${C.amber}; border-radius: 0 8px 8px 0;
    }
    .rv-pre { margin: 8px 0 8px; font-size: 0.8em; white-space: pre-wrap; word-break: break-all; }

    /* Decision bar: sticky footer; contains the feedback textarea row. */
    .rv-bar {
      flex: 0 0 auto; position: sticky; bottom: 0; z-index: 2;
      border-top: 1px solid ${C.borderSubtle}; background: ${C.bgPathHeader};
    }
    .rv-feedback-row {
      padding: 14px 20px; border-bottom: 1px solid ${C.borderSubtle};
      display: flex; flex-direction: column; gap: 10px;
    }
    .rv-feedback {
      width: 100%; min-height: 74px;
      background: ${C.bg}; color: ${C.textSecondary};
      border: 1px solid ${C.borderSubtle}; border-radius: 8px;
      padding: 11px 12px;
      font-family: 'Inter', system-ui, sans-serif; font-size: 12.5px; line-height: 1.5;
      resize: vertical;
      transition: border-color 120ms ease, box-shadow 120ms ease;
    }
    .rv-feedback:focus {
      outline: none; border-color: ${C.accentBlue};
      box-shadow: 0 0 0 1px ${C.accentBlue};
    }
    .rv-bar-row { display: flex; align-items: center; gap: 9px; padding: 13px 20px; }
    .rv-bar-actions { margin-left: auto; display: flex; align-items: center; gap: 9px; }

    /* Button hierarchy */
    .rv-btn {
      display: inline-flex; align-items: center; gap: 8px;
      padding: 9px 16px; border-radius: 8px; cursor: pointer;
      font-family: 'Inter', system-ui, sans-serif; font-size: 12.5px; font-weight: 600; line-height: 1.2;
      border: 1px solid transparent;
      transition: background 120ms ease-out, border-color 120ms ease-out, color 120ms ease-out, box-shadow 120ms ease-out, transform 120ms ease-out;
    }
    .rv-btn:focus-visible { outline: none; box-shadow: 0 0 0 2px ${C.accentBlue}; }
    .rv-btn[disabled] { opacity: 0.5; cursor: default; }
    .rv-btn:active:not([disabled]) { transform: translateY(1px); }

    /* Primary = green-tinted Merge / Resolve and merge / Create PR / Retry cleanup. */
    .rv-btn-primary {
      padding: 9px 20px; font-weight: 700;
      background: rgba(70,201,138,0.18); border-color: rgba(70,201,138,0.45); color: ${C.green};
    }
    .rv-btn-primary:hover:not([disabled]) { background: rgba(70,201,138,0.28); }

    /* Danger = Discard. */
    .rv-btn-danger {
      background: transparent; color: ${C.danger}; border-color: rgba(240,96,107,0.32);
    }
    .rv-btn-danger:hover:not([disabled]) { background: rgba(240,96,107,0.10); border-color: rgba(240,96,107,0.5); }

    /* Secondary = Request changes / Resolve in Editor. */
    .rv-btn-secondary { background: ${C.bgCard}; color: ${C.textContext}; border-color: ${C.borderControl}; }
    .rv-btn-secondary:hover:not([disabled]) { background: ${C.bgCardRaised}; border-color: ${C.borderHover}; color: ${C.textPrimary}; }

    /* Unwired conflict stubs stay dimmed. */
    .rv-btn-stub { opacity: 0.6; }

    /* Equalizer mark on the merge button (reuses the prototype's eqbar feel). */
    .rv-eq { display: inline-flex; align-items: flex-end; gap: 1.5px; height: 11px; }
    .rv-eq > span { width: 2px; background: ${C.green}; border-radius: 1px; }
    .rv-eq > span:nth-child(1) { height: 7px; }
    .rv-eq > span:nth-child(2) { height: 11px; }
    .rv-eq > span:nth-child(3) { height: 5px; }
    .rv-eq > span:nth-child(4) { height: 9px; }
    /* Brand mark variant in the what-changed band: muted eyebrow tone, not green. */
    .rv-eq-mark > span { background: ${C.eyebrow}; }

    /* Scrollbars match the prototype graphite. */
    ::-webkit-scrollbar { width: 10px; height: 10px; }
    ::-webkit-scrollbar-thumb { background: ${C.scrollThumb}; border-radius: 6px; border: 2px solid transparent; background-clip: content-box; }
    ::-webkit-scrollbar-thumb:hover { background: ${C.scrollThumbHover}; background-clip: content-box; }
    ::-webkit-scrollbar-track { background: transparent; }

    /* Narrow docked panel: stack the changed-files rail ABOVE the diff so the
       fixed 264px rail stops squeezing the right column to nothing. */
    @media (max-width: 720px) {
      .rv-body { flex-direction: column; }
      .rv-rail {
        width: 100%; flex: 0 0 auto;
        border-right: none; border-bottom: 1px solid ${C.borderHeader};
        max-height: 180px;
      }
    }

    /* Honor reduced-motion: kill the press transforms and drop the hover/focus
       transitions on this screen's controls. There are no looping animations. */
    @media (prefers-reduced-motion: reduce) {
      .rv-back, .rv-tog, .rv-btn, .rv-file-row, .rv-feedback { transition: none !important; }
      .rv-back:active, .rv-tog:active:not(:disabled),
      .rv-btn:active:not([disabled]) { transform: none !important; }
    }
  </style>`;

  return `${style}
<div class="rv-screen">
${header}
<div class="rv-body">
${rail}
<div class="rv-main">
${band}
${rightBody}
</div>
</div>
${bar}
</div>`;
}

/**
 * The full-document review screen: {@link renderReviewBody} wrapped in a
 * standalone HTML document. Used by the dedicated review webview shell, whose
 * `<body>` is otherwise empty. The single-page router uses renderReviewBody
 * directly instead.
 */
export function renderReview(card: CardVM, parsed: ParsedDiff, opts: ReviewOpts = {}): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"></head>
<body>
${renderReviewBody(card, parsed, opts)}
</body>
</html>`;
}
