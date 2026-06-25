# Maestro P6: Diff and Merge Review Implementation Plan

> For agentic workers: REQUIRED SUB-SKILL: superpowers:subagent-driven-development (or superpowers:executing-plans) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking; each task is red, then green, then a commit.

> Part of the [roadmap](./README.md). UX spec: [06](../2026-06-16-conducting-board-design/06-diff-merge-review.md).

**Date:** 2026-06-16
**Branch:** `p6-diff-merge-review` (branch off the P1 result, since this phase depends on P1)
**Depends on:** P1 (the laned board, `CardVM` over the graphite canvas, and the open-a-card-into-focus flow). The whole M9 merge engine (workspace + orchestrator + extension commands) is already shipped, so this phase is the review UI over it, not the engine.

## Goal

Build the full-width Diff and Merge Review screen described in design doc 06: a header (agent, task, why, branch line), a changed-files rail, a styled unified diff, the agent "what changed" summary, and a sticky decision bar (Merge into main, Discard, Request changes, Approve). On top of that, the three honest variants of the same screen: the conflict variant (literal git markers, per-hunk choices, Resolve and merge), PR mode (Create PR / Create draft PR, the `pr-created` state), and the recovery banner for `merge-cleanup-failed` (Retry cleanup). The screen is mostly presentation: every merge action it dispatches already exists as a `WebviewToHost` message wired to a real `GitWorkspaceManager` / `Orchestrator` method. The one genuinely new piece of logic is a pure unified-diff parser that turns the `Diff.patch` string into per-file hunks and lines for styled rendering, plus the `diffStat` (adds / dels) consistent with P1.

The phase honors the canonical seams from the roadmap: **R2** (the board and this screen use the design's fixed graphite palette, not `var(--vscode-*)`), and **R8** (the conflict EDIT initially delegates to the existing M9 `resolve-conflict` open-in-editor path; in-webview hunk-level keep-ours / keep-theirs is a clearly marked stretch goal, not a blocker).

## Architecture

The split is the same pure-brain / thin-shell discipline the codebase already enforces. New logic that can be tested without a DOM or a VS Code host goes into vscode-free modules:

- **`@maestro/extension/src/diff-parse.ts`** (NEW, pure): the unified-diff parser. Input is the `Diff.patch` string (and `Diff.files`); output is a structured `ParsedDiff` (per-file, per-hunk, per-line, classified add / context / del, plus parsed hunk headers and a `diffStat`). No `import "vscode"`, no DOM. Fully unit-tested under Vitest. This is the only net-new algorithm in the phase.
- **`@maestro/extension/src/review-render.ts`** (NEW, pure): functions that turn a `CardVM` (plus its `ParsedDiff`) into the review screen's HTML: the header band, the changed-files rail, the unified diff body, the summary card, and the decision bar with its four variants. Every engine-supplied or git-supplied string is escaped through the existing `escapeHtml` helper. Uses the graphite palette tokens from design doc 01 (R2), emitted as a small inline `<style>` block keyed to fixed hex values, never `var(--vscode-*)`. Unit-tested by asserting on the returned HTML string.
- **`@maestro/extension/src/merge-helpers.ts`** (MODIFY): already holds `buildPrTitle` / `buildPrBody` / `buildConflictResolveMessage` / `conflictFileBase` / `markPrCreatedAfterPush`. P6 adds only a tiny decision-bar action-map helper if needed; the existing helpers are reused as-is.
- **`@maestro/cockpit/src/protocol.ts`** (MODIFY, minimal): the merge / discard / sendBack / resolve-conflict / finish-merge / create-pr / retry-cleanup messages already exist, so the decision bar reuses them verbatim. The only candidate addition is an `open-review` message (focus a board card into the full-width review screen). If added, it is a single `{ type: "open-review"; agentId: string }` variant, the `isWebviewMessage` guard and the agent-id set are updated for it, and the controller's exhaustive switch handles it. If P1 already routes focus / review-open through its existing `focus` message and a host-side route, P6 reuses that and adds nothing to the protocol; the task below is written so either path is valid and the invariant (guard updated for any new message) is preserved.
- **The host glue** (`extension.ts`, `controller.ts`) stays thin: it invokes the real `GitWorkspaceManager` (`diff`, `merge`, `isStale`, `rebase`, `resolveMerge`, `pushAndPr`, `retainBranchOnMerge`) and `Orchestrator` (`retryCleanup`, `markPrCreated`, `sendBack`) methods that M9 already provides. No git logic is reimplemented here.

The diff content (`Diff.files`, `Diff.patch`) and every merge outcome (`MergeResult`) come from the real `@maestro/workspace` package. The review screen renders that data; it does not re-derive a diff or run git.

## Scope

### IN (this phase)

- A pure unified-diff parser: `patch` string to per-file, then per-hunk, then per-line classified add / context / del, plus parsed hunk-header coordinates and a `diffStat` (adds, dels) per file and overall.
- The clean review screen render: header (role + engine, task, faint italic why, `agent/<slug> -> main` branch line), the 260px changed-files rail (per-file `+N` / `-N` and a status dot), the unified diff body (monospace, two-column gutter, green additions `#4caf50`, red deletions `#e05050`, blue hunk headers `#4a9eff`), the agent "what changed" summary card (from `CardVM.summary`), and the sticky decision bar (Merge into main, Discard, Request changes, Approve).
- The conflict variant render: amber `#f0a030` banner, conflicted files pulled to the top with an amber dot, literal git conflict markers (`<<<<<<< ours`, `=======`, `>>>>>>> theirs`) tinted amber, per-hunk Keep ours / Keep theirs / Edit controls, and a Resolve and merge action replacing Merge into main.
- PR mode render: when `maestro.prMode` is on, the primary slot becomes Create PR (or Create draft PR when `maestro.prDraft`), a "PR mode" pill on the branch line, and the `pr-created` terminal note.
- Recovery render: the `merge-cleanup-failed` amber banner ("Merged successfully. Worktree cleanup did not finish.") with a Retry cleanup action and a reassurance note; a mention of `retainBranchOnMerge` framing in the merge-clean confirmation copy.
- Decision-bar action dispatch: each button maps to the correct existing `WebviewToHost` message; verified by controller tests against a fake orchestrator.
- The open-review wiring from a board card into the full-width review screen (protocol guard updated if a new message is introduced).

### OUT (and the owning phase)

- The merge engine itself. `diff`, `merge`, `isStale`, `rebase`, `resolveMerge`, `pushAndPr`, the serialized-merge mutex, `merge-cleanup-failed` + `retryCleanup`, `retainBranchOnMerge`, and the `pr-created` / `releaseWorktree` states all shipped in **M9** (and post-audit polish). Do not reimplement them.
- In-webview hunk-level conflict resolution beyond delegating to the editor. Per **R8** the Edit choice opens the existing M9 `resolve-conflict` (VS Code merge editor) path; an in-board keep-ours / keep-theirs writer that produces real resolved content before `resolveMerge` is a **stretch goal**, explicitly deferred (the drawn chips imply a resolution writer the prototype only simulates; the safe default is the editor hand-off, then `finish-merge`).
- The lane mapping and `selectState` lane grouping. Owned by **P1** (R1). P6 consumes the focused card; it does not redefine lanes.
- The faint italic why / goal field on the card. Introduced in **P1** (R7). P6 reads it for the header; it does not add it.

## File Structure

```
packages/
  extension/
    src/
      diff-parse.ts          NEW: pure unified-diff parser (patch -> files/hunks/lines + diffStat)
      review-render.ts       NEW: pure HTML for the review screen + 3 variants (graphite, escaped)
      merge-helpers.ts       MODIFY: reuse existing helpers; add decision-bar action map only if needed
      controller.ts          MODIFY (only if open-review is a new message): handle it in the switch
      extension.ts           MODIFY: route open-review to the full-width review webview; pass prMode/prDraft
    test/
      diff-parse.test.ts     NEW: parser tests (empty, single-file, multi-file, add/del/context, headers, diffStat)
      review-render.test.ts  NEW: render-branch tests (clean, conflict, PR-mode, cleanup-failed; escaping)
      controller.test.ts     MODIFY: decision-bar action dispatch + open-review (fake orchestrator)
  cockpit/
    src/
      protocol.ts            MODIFY (only if open-review is introduced): add variant, update isWebviewMessage + AGENT_ID_TYPES
    test/
      protocol.test.ts       MODIFY: isWebviewMessage accepts open-review, rejects malformed
```

If P1 already carries focus-into-review through its existing message, the two `protocol.ts` / cockpit edits collapse to nothing and the controller test reuses P1's route. The plan keeps the guard-update invariant either way.

## Tasks

### Task 1: Pure unified-diff parser (`diff-parse.ts`)

**Files:** NEW `packages/extension/src/diff-parse.ts`; NEW `packages/extension/test/diff-parse.test.ts`.

The parser turns a `Diff.patch` string into a render-ready structure. Shape (define and export the types):

```ts
export type DiffLineKind = "add" | "del" | "context";
export interface DiffLine { kind: DiffLineKind; text: string; oldNo?: number; newNo?: number; }
export interface DiffHunk { header: string; oldStart: number; oldLines: number; newStart: number; newLines: number; lines: DiffLine[]; }
export interface DiffFileChange { path: string; oldPath?: string; status: "added" | "modified" | "deleted"; adds: number; dels: number; hunks: DiffHunk[]; }
export interface DiffStat { adds: number; dels: number; }
export interface ParsedDiff { files: DiffFileChange[]; stat: DiffStat; }
export function parseUnifiedDiff(patch: string): ParsedDiff;
```

Parsing rules: split on `diff --git` / `+++` / `---` file boundaries; classify a file `added` when the old side is `/dev/null`, `deleted` when the new side is `/dev/null`, else `modified`; parse each `@@ -oldStart,oldLines +newStart,newLines @@` header (defaulting the omitted count to 1); within a hunk, a `+`-prefixed line is `add` (advances `newNo` only), a `-`-prefixed line is `del` (advances `oldNo` only), a leading-space line is `context` (advances both); per-file `adds` / `dels` count add / del lines; the overall `stat` sums them. An empty patch yields `{ files: [], stat: { adds: 0, dels: 0 } }`. The parser never throws on a malformed patch; it skips lines it cannot classify so the UI degrades to "no diff" rather than crashing.

- [ ] **RED.** Write `diff-parse.test.ts` and watch it fail (no module yet). Vitest sketch:
  ```ts
  import { describe, expect, it } from "vitest";
  import { parseUnifiedDiff } from "../src/diff-parse.js";

  describe("parseUnifiedDiff", () => {
    it("empty patch -> no files, zero stat", () => {
      expect(parseUnifiedDiff("")).toEqual({ files: [], stat: { adds: 0, dels: 0 } });
    });

    it("single modified file: classifies add/del/context and counts diffStat", () => {
      const patch = [
        "diff --git a/foo.ts b/foo.ts",
        "--- a/foo.ts",
        "+++ b/foo.ts",
        "@@ -1,3 +1,4 @@",
        " const a = 1;",
        "-const b = 2;",
        "+const b = 3;",
        "+const c = 4;",
        " export { a };",
      ].join("\n");
      const d = parseUnifiedDiff(patch);
      expect(d.files).toHaveLength(1);
      const f = d.files[0]!;
      expect(f.path).toBe("foo.ts");
      expect(f.status).toBe("modified");
      expect(f.adds).toBe(2);
      expect(f.dels).toBe(1);
      const kinds = f.hunks[0]!.lines.map((l) => l.kind);
      expect(kinds).toEqual(["context", "del", "add", "add", "context"]);
      expect(f.hunks[0]!.oldStart).toBe(1);
      expect(f.hunks[0]!.newStart).toBe(1);
      expect(d.stat).toEqual({ adds: 2, dels: 1 });
    });

    it("hunk header without explicit counts defaults to 1 line", () => {
      const patch = "diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -5 +5 @@\n-old\n+new\n";
      const h = parseUnifiedDiff(patch).files[0]!.hunks[0]!;
      expect(h.oldStart).toBe(5);
      expect(h.oldLines).toBe(1);
      expect(h.newLines).toBe(1);
    });

    it("added file (old side /dev/null) is status 'added'", () => {
      const patch = "diff --git a/new.ts b/new.ts\n--- /dev/null\n+++ b/new.ts\n@@ -0,0 +1,2 @@\n+line one\n+line two\n";
      const f = parseUnifiedDiff(patch).files[0]!;
      expect(f.status).toBe("added");
      expect(f.adds).toBe(2);
      expect(f.dels).toBe(0);
    });

    it("deleted file (new side /dev/null) is status 'deleted'", () => {
      const patch = "diff --git a/old.ts b/old.ts\n--- a/old.ts\n+++ /dev/null\n@@ -1,1 +0,0 @@\n-gone\n";
      expect(parseUnifiedDiff(patch).files[0]!.status).toBe("deleted");
    });

    it("multi-file patch: parses every file and aggregates the overall stat", () => {
      const patch = [
        "diff --git a/one.ts b/one.ts", "--- a/one.ts", "+++ b/one.ts",
        "@@ -1,1 +1,1 @@", "-a", "+b",
        "diff --git a/two.ts b/two.ts", "--- a/two.ts", "+++ b/two.ts",
        "@@ -1,0 +1,2 @@", "+c", "+d",
      ].join("\n");
      const d = parseUnifiedDiff(patch);
      expect(d.files.map((f) => f.path)).toEqual(["one.ts", "two.ts"]);
      expect(d.stat).toEqual({ adds: 3, dels: 1 });
    });

    it("does not throw on a malformed patch", () => {
      expect(() => parseUnifiedDiff("garbage\nnot a diff\n@@ broken")).not.toThrow();
    });
  });
  ```
- [ ] **GREEN.** Implement `parseUnifiedDiff` and the types in `diff-parse.ts` until the tests pass.
- [ ] **COMMIT.** `feat(extension): pure unified-diff parser for the review screen (patch -> hunks/lines + diffStat)`.

### Task 2: Clean review screen render (`review-render.ts`)

**Files:** NEW `packages/extension/src/review-render.ts`; NEW `packages/extension/test/review-render.test.ts`.

`renderReview(card: CardVM, parsed: ParsedDiff): string` returns the full-width screen HTML for the clean path. Internally compose small pure functions: `reviewHeader` (role + engine pill, task, faint italic why line if the card carries a goal from P1, and the branch line `agent/<slug> -> main` in monospace with the arrow in `#6a6a6a`), `filesRail` (one row per `parsed.files` entry: status dot colored green `#4caf50` added / blue `#4a9eff` modified / red `#e05050` deleted, basename in `#e8e8e8`, dir prefix in `#6a6a6a`, right-aligned `+adds` green and `-dels` red), `diffBody` (per hunk: a `@@ ... @@` header row on `#242424` with `#4a9eff` text, then lines: additions `#4caf50` on a faint green row with a `+` gutter mark, deletions `#e05050` on a faint red row with a `-` mark, context `#a0a0a0`, two-column old/new line-number gutter in `#5a5a5a`), `summaryCard` (header "What the agent says" small-caps `#6a6a6a`, body `escapeHtml(card.summary)` on `#242424` with a `#3a3a3a` border), and `decisionBar` (Merge into main as the only filled `#4a9eff` primary, Discard destructive `#e05050`, Request changes secondary, Approve secondary). Every git-supplied or engine-supplied string (file paths, diff line text, summary, slug) is escaped through `escapeHtml`. The palette is emitted as fixed hex (R2), never `var(--vscode-*)`. When `card.diffError` is set, `diffBody` is replaced by an error panel and the Merge button renders disabled.

- [ ] **RED.** Write `review-render.test.ts`. Vitest sketch:
  ```ts
  import { describe, expect, it } from "vitest";
  import { renderReview } from "../src/review-render.js";
  import { parseUnifiedDiff } from "../src/diff-parse.js";
  import type { CardVM } from "@maestro/cockpit";

  function card(o: Partial<CardVM> = {}): CardVM {
    return { id: "a1", roleName: "Reviewer", engineId: "copilot", state: "done", output: "", attention: true, ...o };
  }
  const patch = "diff --git a/foo.ts b/foo.ts\n--- a/foo.ts\n+++ b/foo.ts\n@@ -1,1 +1,2 @@\n const a=1;\n+const b=2;\n";

  describe("renderReview (clean path)", () => {
    it("header shows role, engine and the branch line into main", () => {
      const html = renderReview(card({ summary: "Added b" }), parseUnifiedDiff(patch));
      expect(html).toContain("Reviewer");
      expect(html).toContain("copilot");
      expect(html).toMatch(/agent\/[^<]* -&gt; main|agent\/.* &rarr; main|agent\//);
      expect(html).toContain("main");
    });

    it("changed-files rail lists each file with +/- counts", () => {
      const html = renderReview(card(), parseUnifiedDiff(patch));
      expect(html).toContain("foo.ts");
      expect(html).toContain("+1");
    });

    it("uses graphite palette hex, never vscode css vars (R2)", () => {
      const html = renderReview(card(), parseUnifiedDiff(patch));
      expect(html).toContain("#4a9eff"); // hunk header / primary
      expect(html).toContain("#4caf50"); // additions
      expect(html).not.toContain("var(--vscode-");
    });

    it("decision bar has merge, discard, request-changes (sendBack) and approve", () => {
      const html = renderReview(card(), parseUnifiedDiff(patch));
      expect(html).toContain('data-action="merge"');
      expect(html).toContain('data-action="discard"');
      expect(html).toContain('data-action="sendBack"');
      expect(html).toContain('data-action="approve"');
    });

    it("escapes the agent summary and diff text (no raw HTML injection)", () => {
      const evil = "diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1,1 +1,1 @@\n-old\n+<script>alert(1)</script>\n";
      const html = renderReview(card({ summary: "<img src=x onerror=1>" }), parseUnifiedDiff(evil));
      expect(html).not.toContain("<script>");
      expect(html).not.toContain("<img src=x");
      expect(html).toContain("&lt;script&gt;");
    });

    it("diffError replaces the diff body and disables Merge", () => {
      const html = renderReview(card({ diffError: "git failed" }), { files: [], stat: { adds: 0, dels: 0 } });
      expect(html).toContain("git failed");
      expect(html).toMatch(/data-action="merge"[^>]*disabled|disabled[^>]*data-action="merge"/);
    });
  });
  ```
- [ ] **GREEN.** Implement `renderReview` and its helpers; all strings escaped, palette fixed-hex.
- [ ] **COMMIT.** `feat(extension): full-width clean review screen render over the parsed diff (graphite, escaped)`.

### Task 3: Conflict variant render

**Files:** MODIFY `packages/extension/src/review-render.ts`; MODIFY `packages/extension/test/review-render.test.ts`.

When `card.state === "conflict"` and `card.conflictFiles` is set, `renderReview` pivots: an amber `#f0a030` banner ("Merge conflict in N files"), the conflicted files pulled to the top of the rail with an amber dot, and in the diff body the literal git markers (`<<<<<<< ours`, `=======`, `>>>>>>> theirs`) tinted amber. Each conflict hunk carries an inline Keep ours / Keep theirs / Edit control, and the decision bar's primary slot becomes Resolve and merge (mapping to `finish-merge`) instead of Merge into main. Per **R8**, Edit maps to the existing `resolve-conflict` (open-in-editor) message; the per-hunk keep-ours / keep-theirs chips are rendered but marked as a stretch interaction (a `data-stretch="true"` attribute and a comment) so the v1 path is editor hand-off then `finish-merge`. Resolve and merge stays disabled until the conflict is handled (it is the existing `finish-merge`, which re-probes via `resolveMerge` host-side and re-lists still-unresolved files).

- [ ] **RED.** Append conflict cases. Vitest sketch:
  ```ts
  describe("renderReview (conflict variant)", () => {
    const conflictPatch = "diff --git a/c.ts b/c.ts\n--- a/c.ts\n+++ b/c.ts\n@@ -1,5 +1,5 @@\n<<<<<<< ours\nours line\n=======\ntheirs line\n>>>>>>> theirs\n";
    const conflictCard = card({ state: "conflict", conflictFiles: ["c.ts"] });

    it("shows the amber conflict banner with the file count", () => {
      const html = renderReview(conflictCard, parseUnifiedDiff(conflictPatch));
      expect(html).toContain("#f0a030");
      expect(html).toMatch(/conflict/i);
      expect(html).toContain("c.ts");
    });

    it("renders the literal git conflict markers (escaped)", () => {
      const html = renderReview(conflictCard, parseUnifiedDiff(conflictPatch));
      expect(html).toContain("&lt;&lt;&lt;&lt;&lt;&lt;&lt;");
      expect(html).toContain("=======");
      expect(html).toContain("&gt;&gt;&gt;&gt;&gt;&gt;&gt;");
    });

    it("primary action is Resolve and merge (finish-merge), not merge", () => {
      const html = renderReview(conflictCard, parseUnifiedDiff(conflictPatch));
      expect(html).toContain('data-action="finish-merge"');
      expect(html).not.toContain('data-action="merge"');
    });

    it("Edit delegates to resolve-conflict (R8 editor hand-off)", () => {
      const html = renderReview(conflictCard, parseUnifiedDiff(conflictPatch));
      expect(html).toContain('data-action="resolve-conflict"');
    });

    it("per-hunk keep-ours/keep-theirs chips are marked stretch, not wired to a writer", () => {
      const html = renderReview(conflictCard, parseUnifiedDiff(conflictPatch));
      expect(html).toContain('data-stretch="true"');
    });
  });
  ```
- [ ] **GREEN.** Branch `renderReview` on the conflict state; reuse `escapeHtml` for markers.
- [ ] **COMMIT.** `feat(extension): conflict variant of the review screen (amber markers, finish-merge, R8 editor hand-off)`.

### Task 4: PR mode and cleanup-failed recovery render

**Files:** MODIFY `packages/extension/src/review-render.ts`; MODIFY `packages/extension/test/review-render.test.ts`.

Extend `renderReview` to take review options: `renderReview(card, parsed, opts?: { prMode?: boolean; prDraft?: boolean; retainBranch?: boolean })`. When `opts.prMode` is on (from the real `maestro.prMode` setting), the primary slot becomes Create PR (mapping to `create-pr`), reading "Create draft PR" when `opts.prDraft` (the `maestro.prDraft` setting), the branch line gains a muted "PR mode" pill `#6a6a6a`, and the `pr-created` terminal state renders a note ("Pull request opened. Worktree released, branch kept."). Separately, when `card.state === "merge-cleanup-failed"`, render the recovery banner: amber `#f0a030` left border (never red `#e05050`, since the code already landed), copy "Merged successfully. Worktree cleanup did not finish.", a Retry cleanup primary (mapping to `retry-cleanup`), the escaped `card.error` detail, and a muted "this is housekeeping, not data loss" note. The merge-clean confirmation copy reflects `opts.retainBranch` ("branch kept" vs "branch cleaned up") so a leftover branch is never a surprise (`retainBranchOnMerge`).

- [ ] **RED.** Append PR-mode and recovery cases. Vitest sketch:
  ```ts
  describe("renderReview (PR mode)", () => {
    it("primary becomes Create PR with a PR-mode pill", () => {
      const html = renderReview(card({ summary: "x" }), parseUnifiedDiff(patch), { prMode: true });
      expect(html).toContain('data-action="create-pr"');
      expect(html).toMatch(/PR mode/i);
      expect(html).not.toContain('data-action="merge"');
    });
    it("draft PR reads 'Create draft PR' when prDraft is on", () => {
      const html = renderReview(card(), parseUnifiedDiff(patch), { prMode: true, prDraft: true });
      expect(html).toMatch(/draft PR/i);
    });
    it("pr-created state shows the terminal note", () => {
      const html = renderReview(card({ state: "pr-created" }), parseUnifiedDiff(patch), { prMode: true });
      expect(html).toMatch(/Pull request opened/i);
    });
  });

  describe("renderReview (merge-cleanup-failed recovery)", () => {
    it("shows the amber (not red) cleanup banner with Retry cleanup", () => {
      const html = renderReview(card({ state: "merge-cleanup-failed", error: "disk full" }), parseUnifiedDiff(patch));
      expect(html).toContain('data-action="retry-cleanup"');
      expect(html).toContain("#f0a030");
      expect(html).not.toMatch(/border[^;]*#e05050/); // never red: code is safe
      expect(html).toContain("disk full");
      expect(html).toMatch(/Merged successfully/i);
    });
    it("retainBranch option changes the clean confirmation copy", () => {
      const kept = renderReview(card({ state: "merged" }), parseUnifiedDiff(patch), { retainBranch: true });
      expect(kept).toMatch(/branch kept/i);
    });
  });
  ```
- [ ] **GREEN.** Add the `opts` parameter and the two render branches; escape `card.error`.
- [ ] **COMMIT.** `feat(extension): PR-mode and cleanup-failed recovery branches of the review screen`.

### Task 5: Decision-bar action dispatch (controller)

**Files:** MODIFY `packages/extension/test/controller.test.ts` (and `controller.ts` only if an open-review message is introduced).

Every decision-bar button maps to an already-existing `WebviewToHost` message that the controller (`createCockpit`) already routes: `merge` -> `orch.merge`, `discard` -> `orch.discard`, `sendBack` (Request changes) -> `orch.sendBack`, `approve` -> `orch.approve`, `create-pr` / `finish-merge` / `resolve-conflict` -> `onMergeAction`, `retry-cleanup` -> `orch.retryCleanup`. This task adds controller tests that drive each message through `handle` against a fake `OrchestratorLike` and asserts the right method (or `onMergeAction`) fired. No production change to `controller.ts` is needed for the existing messages (they are already in the exhaustive switch); the only change is if Task 6 introduces `open-review`, in which case the switch gains that case.

- [ ] **RED.** Add dispatch tests. Vitest sketch (fake orchestrator records calls):
  ```ts
  it("Request changes button dispatches sendBack to the same worktree", () => {
    const calls: string[] = [];
    const orch = makeFakeOrch({ sendBack: (id, fb) => { calls.push(`sendBack:${id}:${fb}`); return {} as any; } });
    const cockpit = createCockpit(orch, () => {});
    cockpit.handle({ type: "sendBack", agentId: "a1", feedback: "please retry" });
    expect(calls).toContain("sendBack:a1:please retry");
  });

  it("Merge / Discard / Retry cleanup route to the async orchestrator methods", () => {
    const calls: string[] = [];
    const orch = makeFakeOrch({
      merge: (id) => { calls.push(`merge:${id}`); return Promise.resolve({ status: "clean" }); },
      discard: (id) => { calls.push(`discard:${id}`); return Promise.resolve(); },
      retryCleanup: (id) => { calls.push(`retry:${id}`); return Promise.resolve(); },
    });
    const cockpit = createCockpit(orch, () => {});
    cockpit.handle({ type: "merge", agentId: "a1" });
    cockpit.handle({ type: "discard", agentId: "a1" });
    cockpit.handle({ type: "retry-cleanup", agentId: "a1" });
    expect(calls).toEqual(["merge:a1", "discard:a1", "retry:a1"]);
  });

  it("Create PR / Finish merge / Resolve conflict route through onMergeAction", () => {
    const seen: string[] = [];
    const orch = makeFakeOrch({});
    const cockpit = createCockpit(orch, () => {}, undefined, (m) => seen.push(m.type));
    cockpit.handle({ type: "create-pr", agentId: "a1" });
    cockpit.handle({ type: "finish-merge", agentId: "a1" });
    cockpit.handle({ type: "resolve-conflict", agentId: "a1" });
    expect(seen).toEqual(["create-pr", "finish-merge", "resolve-conflict"]);
  });
  ```
- [ ] **GREEN.** The existing controller already satisfies these; add `makeFakeOrch` if not present. Keep the exhaustive switch's `never` default intact.
- [ ] **COMMIT.** `test(extension): decision-bar action dispatch maps each button to its existing protocol message`.

### Task 6: Open-review wiring from a board card

**Files:** MODIFY `packages/cockpit/src/protocol.ts` and `packages/cockpit/test/protocol.test.ts` (only if a new message is introduced); MODIFY `packages/extension/src/extension.ts` and `packages/extension/src/controller.ts` to route it; MODIFY `packages/extension/test/controller.test.ts`.

A board card needs a way to open the full-width review screen for a `done` / `conflict` / `merge-cleanup-failed` / `detached` agent. Prefer reusing P1's existing focus / drawer route if it already opens a review surface. If a dedicated message is needed, add the minimal `{ type: "open-review"; agentId: string }` to `WebviewToHost`, add `"open-review"` to `AGENT_ID_TYPES`, extend the `switch` in `isWebviewMessage` (the invariant: the guard is updated for any new message), and handle it in the controller's exhaustive switch by routing to the host (which swaps the board for the review webview and computes the diff via `GitWorkspaceManager.diff` if not already cached on the card). Keep the exhaustive `never` default so an unhandled future variant is a compile error.

- [ ] **RED.** If introducing the message, add a protocol-guard test. Vitest sketch:
  ```ts
  it("isWebviewMessage accepts a well-formed open-review and rejects a malformed one", () => {
    expect(isWebviewMessage({ type: "open-review", agentId: "a1" })).toBe(true);
    expect(isWebviewMessage({ type: "open-review" })).toBe(false); // missing agentId
  });
  ```
  And a controller test asserting `open-review` routes to the review opener (a host callback or `onMergeAction`-style sink). If reusing P1's `focus`, instead assert the host opens the review surface for a reviewable state and skip the protocol edit.
- [ ] **GREEN.** Add the variant + guard update + controller case (or reuse P1's route). Run `pnpm -r typecheck` to confirm the exhaustive switches still compile across cockpit, controller, and `render.ts` / `review-render.ts`.
- [ ] **COMMIT.** `feat(cockpit,extension): open a board card into the full-width review screen`.

### Task 7: Full gate green

**Files:** none (verification).

- [ ] Run the repo-root gate: `pnpm -r typecheck`, `pnpm -r test`, `pnpm -r build` (both extension bundles emit). All new tests pass; no exhaustive switch broke; no `var(--vscode-*)` leaked into the review HTML (R2).
- [ ] **COMMIT** (if any final fixups): `chore(extension): P6 diff and merge review screen green on the full gate`.

## Self-Review

Mapping each design-doc 06 requirement to the task that delivers it:

- Header band (agent + engine, task, why line, `agent/<slug> -> main` branch line): Task 2 (`reviewHeader`), reading the P1 goal/why (R7) and the real `agent/`-prefixed branch.
- Left changed-files rail (status dot, basename + dir, `+N` / `-N`): Task 2 (`filesRail`), fed by Task 1's `ParsedDiff.files` and per-file `adds` / `dels`.
- Styled unified diff (gutter, green additions `#4caf50`, red deletions `#e05050`, blue hunk headers `#4a9eff`, context `#a0a0a0`): Task 2 (`diffBody`) over Task 1's hunks / lines.
- Agent "what changed" summary card (`CardVM.summary`): Task 2 (`summaryCard`), escaped.
- Sticky decision bar (Merge into main, Discard, Request changes -> send-back, Approve): Task 2 render + Task 5 dispatch.
- `diffError` panel + Merge disabled: Task 2.
- Conflict variant (amber banner, literal markers, per-hunk choices, Resolve and merge): Task 3, with R8 honored (Edit -> existing `resolve-conflict` editor hand-off; chips marked stretch).
- PR mode (Create PR / Create draft PR, PR-mode pill, `pr-created` note) honoring `maestro.prMode` / `maestro.prDraft`: Task 4.
- `merge-cleanup-failed` recovery banner (amber not red, Retry cleanup, reassurance) and `retainBranchOnMerge` framing: Task 4.
- Action dispatch reusing the existing merge / discard / sendBack / resolve-conflict / finish-merge / create-pr / retry-cleanup messages: Task 5, no new engine logic.
- Open-review wiring from a board card, with `isWebviewMessage` updated for any new message: Task 6.

Invariants held: `isWebviewMessage` updated for any new message (Task 6); exhaustive switches kept with a `never` default (Tasks 5, 6); all git- and engine-supplied text escaped through `escapeHtml` (Tasks 2, 3, 4); graphite palette fixed-hex, no `var(--vscode-*)` per R2 (Tasks 2, 7); diffStat consistent with P1 (Task 1).

Deferred (and to where): in-webview hunk-level keep-ours / keep-theirs that writes real resolved content before `resolveMerge` is a stretch goal, not shipped in v1 (R8); the editor hand-off then `finish-merge` is the v1 path. The merge engine, `isStale` / `rebase` stale-advisory affordance, and the side-by-side-vs-unified toggle (design open question) are out: the engine is M9's, and the toggle is left for a later UI pass. Lane grouping (R1) and the why field (R7) belong to P1 and are consumed here, not redefined.
