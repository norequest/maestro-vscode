/**
 * Full-width review screen renderer. Pure HTML, no DOM, no vscode.
 * All engine/git strings are escaped. Palette is emitted as fixed hex;
 * never var(--vscode-*).
 */

import type { CardVM } from "@maestro/cockpit";
import { escapeHtml } from "./html.js";
import type { ParsedDiff, DiffFileChange, DiffLine } from "./diff-parse.js";

// ─── Palette (fixed hex — R2: never var(--vscode-*)) ─────────────────────────

const C = {
  bg: "#1e1e1e",
  bgCard: "#242424",
  bgCardBorder: "#3a3a3a",
  bgHunkHeader: "#242424",
  rowAdd: "rgba(76,175,80,0.12)",
  rowDel: "rgba(224,80,80,0.12)",
  textPrimary: "#e8e8e8",
  textMuted: "#6a6a6a",
  textDir: "#6a6a6a",
  textContext: "#a0a0a0",
  hunkText: "#4a9eff",
  addDot: "#4caf50",
  modDot: "#4a9eff",
  delDot: "#e05050",
  addText: "#4caf50",
  delText: "#e05050",
  lineNo: "#5a5a5a",
  gutterAdd: "#4caf50",
  gutterDel: "#e05050",
  amber: "#f0a030",
  primary: "#4a9eff",
  primaryDanger: "#e05050",
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

// ─── reviewHeader ─────────────────────────────────────────────────────────────

function reviewHeader(card: CardVM, opts: ReviewOpts): string {
  const role = escapeHtml(card.roleName);
  const engine = escapeHtml(card.engineId);
  const task = escapeHtml(card.taskDescription);
  const slug = toSlug(card.roleName || card.id);
  const arrow = `<span style="color:${C.textMuted}">&rarr;</span>`;
  const branchName = `<span style="font-family:monospace;color:${C.textMuted}">agent/${escapeHtml(slug)}</span> ${arrow} <span style="font-family:monospace;color:${C.textMuted}">main</span>`;

  const prPill = opts.prMode
    ? ` <span style="font-size:0.75em;padding:2px 6px;border-radius:3px;background:${C.bgCard};color:${C.textMuted};border:1px solid ${C.bgCardBorder}">PR mode</span>`
    : "";

  const goalHtml = card.goal
    ? `<div style="font-style:italic;color:${C.textMuted};font-size:0.85em;margin-top:4px">${escapeHtml(card.goal)}</div>`
    : "";

  return `<header style="padding:16px 20px;border-bottom:1px solid ${C.bgCardBorder}">
  <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
    <span style="font-weight:600;color:${C.textPrimary}">${role}</span>
    <span style="font-size:0.75em;padding:2px 6px;border-radius:3px;background:${C.bgCard};color:${C.textMuted};border:1px solid ${C.bgCardBorder}">${engine}</span>
  </div>
  <div style="margin-top:8px;color:${C.textPrimary}">${task}</div>
  ${goalHtml}
  <div style="margin-top:6px;font-size:0.8em">${branchName}${prPill}</div>
</header>`;
}

// ─── filesRail ────────────────────────────────────────────────────────────────

function fileDot(status: DiffFileChange["status"]): string {
  const color = status === "added" ? C.addDot : status === "deleted" ? C.delDot : C.modDot;
  return `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0"></span>`;
}

function filesRail(files: DiffFileChange[], conflictFiles?: string[]): string {
  if (files.length === 0) return "";

  const conflictSet = new Set(conflictFiles ?? []);

  // Sort: conflict files first
  const sorted = [...files].sort((a, b) => {
    const aConf = conflictSet.has(a.path) ? 0 : 1;
    const bConf = conflictSet.has(b.path) ? 0 : 1;
    return aConf - bConf;
  });

  const rows = sorted.map((f) => {
    const isConflict = conflictSet.has(f.path);
    const dotColor = isConflict ? C.amber : undefined;
    const dotHtml = dotColor
      ? `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${dotColor};flex-shrink:0"></span>`
      : fileDot(f.status);

    const parts = f.path.split("/");
    const basename = parts[parts.length - 1]!;
    const dir = parts.length > 1 ? parts.slice(0, -1).join("/") + "/" : "";

    const addsHtml = f.adds > 0
      ? `<span style="color:${C.addText}">+${f.adds}</span>`
      : "";
    const delsHtml = f.dels > 0
      ? `<span style="color:${C.delText}">-${f.dels}</span>`
      : "";

    return `<div style="display:flex;align-items:center;gap:8px;padding:4px 20px;font-size:0.85em" title="${escapeHtml(f.path)}" data-path="${escapeHtml(f.path)}">
  ${dotHtml}
  <span style="flex:1"><span style="color:${C.textDir}">${escapeHtml(dir)}</span><span style="color:${C.textPrimary}">${escapeHtml(basename)}</span></span>
  <span style="display:flex;gap:6px">${addsHtml}${delsHtml}</span>
</div>`;
  }).join("");

  return `<div style="border-bottom:1px solid ${C.bgCardBorder};padding:4px 0">${rows}</div>`;
}

// ─── diffBody ────────────────────────────────────────────────────────────────

function isConflictMarker(text: string): boolean {
  return /^(<{7}|={7}|>{7})/.test(text);
}

function renderDiffLine(line: DiffLine, isConflict: boolean): string {
  const escaped = escapeHtml(line.text);
  const oldNoStr = line.oldNo !== undefined ? String(line.oldNo) : "";
  const newNoStr = line.newNo !== undefined ? String(line.newNo) : "";
  const lineNoHtml = `<span style="color:${C.lineNo};width:40px;text-align:right;padding-right:8px;font-size:0.8em;flex-shrink:0">${escapeHtml(oldNoStr)}</span><span style="color:${C.lineNo};width:40px;text-align:right;padding-right:8px;font-size:0.8em;flex-shrink:0">${escapeHtml(newNoStr)}</span>`;

  if (line.kind === "add") {
    const isMarker = isConflictMarker(line.text);
    const bg = isConflict && isMarker ? `rgba(240,160,48,0.18)` : C.rowAdd;
    const textColor = isConflict && isMarker ? C.amber : C.addText;
    return `<div style="display:flex;align-items:baseline;background:${bg};font-family:monospace;font-size:0.83em">${lineNoHtml}<span style="color:${C.gutterAdd};padding-right:8px;flex-shrink:0">+</span><span style="color:${textColor};word-break:break-all">${escaped}</span></div>`;
  }
  if (line.kind === "del") {
    const isMarker = isConflictMarker(line.text);
    const bg = isConflict && isMarker ? `rgba(240,160,48,0.18)` : C.rowDel;
    const textColor = isConflict && isMarker ? C.amber : C.delText;
    return `<div style="display:flex;align-items:baseline;background:${bg};font-family:monospace;font-size:0.83em">${lineNoHtml}<span style="color:${C.gutterDel};padding-right:8px;flex-shrink:0">-</span><span style="color:${textColor};word-break:break-all">${escaped}</span></div>`;
  }
  // context
  return `<div style="display:flex;align-items:baseline;font-family:monospace;font-size:0.83em">${lineNoHtml}<span style="padding-right:8px;flex-shrink:0"> </span><span style="color:${C.textContext};word-break:break-all">${escaped}</span></div>`;
}

function conflictHunkControls(cardId: string): string {
  const id = escapeHtml(cardId);
  return `<div style="display:flex;gap:8px;padding:6px 20px">
  <button data-action="resolve-conflict" data-id="${id}" style="font-size:0.75em;padding:3px 8px;background:${C.bgCard};border:1px solid ${C.bgCardBorder};color:${C.textMuted};border-radius:3px;cursor:pointer">Edit in Editor</button>
  <button data-stretch="true" data-action="keep-ours" data-id="${id}" style="font-size:0.75em;padding:3px 8px;background:${C.bgCard};border:1px solid ${C.bgCardBorder};color:${C.textMuted};border-radius:3px;cursor:pointer;opacity:0.6">Keep ours</button>
  <button data-stretch="true" data-action="keep-theirs" data-id="${id}" style="font-size:0.75em;padding:3px 8px;background:${C.bgCard};border:1px solid ${C.bgCardBorder};color:${C.textMuted};border-radius:3px;cursor:pointer;opacity:0.6">Keep theirs</button>
</div>`;
}

function diffBody(files: DiffFileChange[], card: CardVM): string {
  if (files.length === 0) return "";
  const isConflictCard = card.state === "conflict";
  const conflictSet = new Set(card.conflictFiles ?? []);

  const fileBlocks = files.map((f) => {
    const isConflictFile = isConflictCard && conflictSet.has(f.path);

    const hunkHtml = f.hunks.map((hunk) => {
      const linesHtml = hunk.lines.map((l) => renderDiffLine(l, isConflictFile)).join("");
      const hunkControls = isConflictFile ? conflictHunkControls(card.id) : "";
      return `<div style="background:${C.bgHunkHeader};color:${C.hunkText};padding:3px 20px;font-family:monospace;font-size:0.8em">${escapeHtml(hunk.header)}</div>${linesHtml}${hunkControls}`;
    }).join("");

    return `<div style="margin-bottom:8px">${hunkHtml}</div>`;
  }).join("");

  return `<div style="overflow-x:auto">${fileBlocks}</div>`;
}

// ─── summaryCard ──────────────────────────────────────────────────────────────

function summaryCard(summary: string | undefined): string {
  if (!summary) return "";
  return `<div style="margin:12px 20px;padding:12px;background:${C.bgCard};border:1px solid ${C.bgCardBorder};border-radius:4px">
  <div style="font-size:0.7em;letter-spacing:0.08em;text-transform:uppercase;color:${C.textMuted};margin-bottom:6px">What the agent says</div>
  <div style="color:${C.textPrimary};font-size:0.9em">${escapeHtml(summary)}</div>
</div>`;
}

// ─── decisionBar ─────────────────────────────────────────────────────────────

function btn(label: string, action: string, id: string, style: string, extra = ""): string {
  return `<button data-action="${action}" data-id="${escapeHtml(id)}" style="${style}"${extra}>${label}</button>`;
}

function decisionBar(card: CardVM, opts: ReviewOpts, diffErrorPresent: boolean): string {
  const id = card.id;
  const primaryStyle = `padding:6px 14px;background:${C.primary};color:#fff;border:none;border-radius:4px;cursor:pointer;font-weight:600`;
  const dangerStyle = `padding:6px 14px;background:${C.primaryDanger};color:#fff;border:none;border-radius:4px;cursor:pointer`;
  const secondaryStyle = `padding:6px 14px;background:${C.bgCard};color:${C.textMuted};border:1px solid ${C.bgCardBorder};border-radius:4px;cursor:pointer`;

  // merge-cleanup-failed: retry-cleanup primary
  if (card.state === "merge-cleanup-failed") {
    return `<footer style="display:flex;gap:10px;padding:12px 20px;border-top:1px solid ${C.bgCardBorder}">
  ${btn("Retry cleanup", "retry-cleanup", id, primaryStyle)}
  ${btn("Discard", "discard", id, dangerStyle)}
</footer>`;
  }

  // conflict: finish-merge primary
  if (card.state === "conflict") {
    return `<footer style="display:flex;gap:10px;padding:12px 20px;border-top:1px solid ${C.bgCardBorder}">
  ${btn("Resolve and merge", "finish-merge", id, primaryStyle)}
  ${btn("Resolve in Editor", "resolve-conflict", id, secondaryStyle)}
  ${btn("Discard", "discard", id, dangerStyle)}
  ${btn("Request changes", "sendBack", id, secondaryStyle)}
  ${btn("Approve", "approve", id, secondaryStyle)}
</footer>`;
  }

  // pr-created: terminal state — just discard
  if (card.state === "pr-created") {
    return `<footer style="display:flex;gap:10px;padding:12px 20px;border-top:1px solid ${C.bgCardBorder}">
  ${btn("Discard", "discard", id, secondaryStyle)}
</footer>`;
  }

  // PR mode: create-pr primary
  if (opts.prMode) {
    const label = opts.prDraft ? "Create draft PR" : "Create PR";
    return `<footer style="display:flex;gap:10px;padding:12px 20px;border-top:1px solid ${C.bgCardBorder}">
  ${btn(label, "create-pr", id, primaryStyle)}
  ${btn("Discard", "discard", id, dangerStyle)}
  ${btn("Request changes", "sendBack", id, secondaryStyle)}
  ${btn("Approve", "approve", id, secondaryStyle)}
</footer>`;
  }

  // Normal: merge primary (disabled if diffError)
  const mergeDisabled = diffErrorPresent ? " disabled" : "";
  return `<footer style="display:flex;gap:10px;padding:12px 20px;border-top:1px solid ${C.bgCardBorder}">
  <button data-action="merge" data-id="${escapeHtml(id)}" style="${primaryStyle}"${mergeDisabled}>Merge into main</button>
  ${btn("Discard", "discard", id, dangerStyle)}
  ${btn("Request changes", "sendBack", id, secondaryStyle)}
  ${btn("Approve", "approve", id, secondaryStyle)}
</footer>`;
}

// ─── Conflict banner ──────────────────────────────────────────────────────────

function conflictBanner(conflictFiles: string[]): string {
  const n = conflictFiles.length;
  const noun = n === 1 ? "file" : "files";
  return `<div style="background:rgba(240,160,48,0.15);border-left:4px solid ${C.amber};padding:10px 20px;color:${C.amber};font-weight:600">
  Merge conflict in ${n} ${noun}
</div>`;
}

// ─── Cleanup-failed recovery banner ──────────────────────────────────────────

function cleanupFailedBanner(card: CardVM, opts: ReviewOpts): string {
  const branchNote = opts.retainBranch ? "branch kept" : "branch cleaned up";
  const errorHtml = card.error
    ? `<pre style="margin:8px 0 4px;font-size:0.8em;color:${C.textContext};white-space:pre-wrap;word-break:break-all">${escapeHtml(card.error)}</pre>`
    : "";
  return `<div style="background:rgba(240,160,48,0.15);border-left:4px solid ${C.amber};padding:10px 20px;margin:12px 20px;border-radius:0 4px 4px 0">
  <div style="color:${C.amber};font-weight:600">Merged successfully. Worktree cleanup did not finish.</div>
  <div style="color:${C.textMuted};font-size:0.85em;margin-top:4px">${escapeHtml(branchNote)}</div>
  ${errorHtml}
  <div style="color:${C.textMuted};font-size:0.8em;margin-top:6px;font-style:italic">This is housekeeping, not data loss. Your changes are safely merged.</div>
</div>`;
}

// ─── diff-error panel ─────────────────────────────────────────────────────────

function diffErrorPanel(diffError: string): string {
  return `<div style="margin:12px 20px;padding:12px;background:${C.bgCard};border:1px solid ${C.bgCardBorder};border-radius:4px;color:${C.delText}">
  <div style="font-size:0.8em;font-weight:600;margin-bottom:4px">Could not compute diff</div>
  <pre style="font-size:0.8em;white-space:pre-wrap;word-break:break-all;color:${C.textContext};margin:0">${escapeHtml(diffError)}</pre>
</div>`;
}

// ─── pr-created terminal note ─────────────────────────────────────────────────

function prCreatedNote(): string {
  return `<div style="margin:12px 20px;padding:12px;background:${C.bgCard};border:1px solid ${C.bgCardBorder};border-radius:4px;color:${C.textMuted}">
  Pull request opened. Worktree released, branch kept.
</div>`;
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function renderReview(card: CardVM, parsed: ParsedDiff, opts: ReviewOpts = {}): string {
  const isConflict = card.state === "conflict";
  const isCleanupFailed = card.state === "merge-cleanup-failed";
  const isPrCreated = card.state === "pr-created";
  const hasDiffError = !!card.diffError;

  const header = reviewHeader(card, opts);
  const rail = filesRail(parsed.files, isConflict ? (card.conflictFiles ?? []) : []);

  let bodyContent: string;
  if (isCleanupFailed) {
    bodyContent = cleanupFailedBanner(card, opts);
  } else if (isPrCreated) {
    bodyContent = prCreatedNote();
  } else if (hasDiffError) {
    bodyContent = diffErrorPanel(card.diffError!);
  } else if (isConflict && (card.conflictFiles?.length ?? 0) > 0) {
    bodyContent = conflictBanner(card.conflictFiles!) + diffBody(parsed.files, card);
  } else {
    bodyContent = diffBody(parsed.files, card);
  }

  const summary = summaryCard(card.summary);
  const bar = decisionBar(card, opts, hasDiffError);

  const style = `<style>
    * { box-sizing: border-box; }
    body { margin: 0; background: ${C.bg}; color: ${C.textPrimary}; font-family: system-ui, sans-serif; }
  </style>`;

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8">${style}</head>
<body>
${header}
${rail}
${bodyContent}
${summary}
${bar}
</body>
</html>`;
}
