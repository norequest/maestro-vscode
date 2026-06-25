# Diff and Merge Review

_The decision surface where a human reads what an agent did, then merges, sends it back, opens a PR, or throws it away._

> Part of the [Conducting Board design reference](./README.md). Visual tokens are defined in [01-overview-and-visual-language.md](./01-overview-and-visual-language.md).

This screen is the moment of truth. An agent has finished in its own git worktree, and the conductor now decides what happens to the work. Everything before this (spawning, watching the stream) is preparation; this is where code actually lands on `main` or does not. The screen has to make a diff legible, make the merge outcome honest (including conflicts and cleanup failures), and keep the irreversible actions one deliberate click away, never one stray click away.

## The review screen (default, clean path)

### Purpose

Give the conductor enough to judge an agent's output without leaving the editor: what changed, why it changed, and a single clear set of next actions. This is a full-width takeover (not a sidebar), because reading a diff in a 300px rail is hostile.

### Layout and components

Three regions stacked under a header, with a sticky footer.

- **Header band.** Background #242424, bottom border #3a3a3a. Left to right: the agent identity (role name + engine badge, e.g. `Reviewer · copilot`), the task description in #e8e8e8 Manrope, and a muted "why" line in #a0a0a0 (the goal the agent was given, so the reviewer judges against intent, not vibes). Below that, the branch line in monospace Inter: `agent/<slug> → main`. The arrow is #6a6a6a; `agent/<slug>` is #a0a0a0; `main` is #e8e8e8. This branch line is literal: it is the `branch` returned by `GitWorkspaceManager.create` (`agent/` + slug) merging into the repo base.
- **Left changed-files list.** A 260px column, background #1e1e1e, border-right #3a3a3a. Each row: a status dot, the file path (basename in #e8e8e8, dir prefix in #6a6a6a), and right-aligned counts `+N` in green #4caf50 and `-N` in red #e05050. Status dot colors: green #4caf50 added, blue #4a9eff modified, red #e05050 deleted. The selected file row gets a #2d2d2d fill and a 2px #4a9eff left border. The list comes straight from `Diff.files`.
- **Main unified diff.** Background #1a1a1a, monospace, with a two-column line-number gutter (old line, new line) in #5a5a5a against a slightly inset #1e1e1e gutter strip. Hunk headers (`@@ -12,7 +12,9 @@`) render on a #242424 row with #4a9eff text. Addition lines: #4caf50 text on a faint green-tinted row; a `+` marker in the gutter. Deletion lines: #e05050 text on a faint red-tinted row; a `-` marker. Context lines: #a0a0a0. The diff body is the `Diff.patch` string parsed for display; we do not re-derive it.
- **Agent "what changed" summary block.** Above or pinned alongside the diff, a #242424 card with a #3a3a3a border holding the agent's own prose summary (`Agent.summary`, the `done` event's `summary`). Header "What the agent says" in #6a6a6a small-caps; body in #e8e8e8. This is the agent's claim; the diff is the evidence. Keeping them adjacent lets the reviewer check one against the other.
- **Sticky decision bar.** Fixed to the bottom, background #242424, top border #3a3a3a, slight upward shadow so it reads as floating over the scrolling diff. Actions, left to right:
  - **Approve** (secondary, #2d2d2d fill, #e8e8e8 text): acknowledge the work is good without merging yet. Useful when several agents are in flight and the conductor wants to batch merges.
  - **Request changes** (secondary): opens a send-back box. On submit this becomes a **Send-back to the same worktree**: the agent re-launches in its existing worktree with the reviewer's note appended, no new branch. See the lifecycle and send-back behavior in [02-conducting-board-and-lifecycle.md](./02-conducting-board-and-lifecycle.md).
  - **Discard** (destructive, #e05050 text, transparent fill, #e05050 border on hover): tear down the worktree and delete the branch. Always behind a confirm.
  - **Merge into main** (primary, the only filled-accent button, #4a9eff): the headline action. In PR mode this slot is replaced (see below).

### States and interactions

- **Loading the diff.** While the orchestrator computes the diff on `done`, the file list and diff body show skeleton rows in #2d2d2d. If diff computation failed (`Agent.diffError`), the diff region shows a #1e1e1e error panel in #a0a0a0 with the error text and a Retry affordance; Merge stays disabled because there is nothing trustworthy to merge against.
- **Selecting a file** scrolls the unified diff to that file's first hunk and highlights its row. Large files collapse by default with a "show 240 more lines" expander.
- **Merge in progress.** The Merge button enters a pending state (spinner, label "Merging…") and the whole bar disables. This is the visible end of the serialized merge: see the mutex note below.
- **Merge clean.** On `MergeResult { status: "clean" }` the screen transitions the agent card to `merged` (green) and either closes the review or shows a compact "Merged into main" confirmation with an Undo-window note (there is no real undo; the note just says the branch was cleaned up or retained).
- **Keyboard.** `j` / `k` move between files, `Enter` on the bar's focused button activates it, `Esc` closes the review without deciding (the agent stays `done`).

### Visual treatment

The diff is the loudest thing on screen and earns it: green #4caf50 and red #e05050 are reserved for additions and deletions and appear nowhere else in this view, so color carries meaning. Blue #4a9eff is the "structure / navigation" hue (hunk headers, selected-file marker, the one primary button), so the eye can find the next action. Everything chrome-level stays in the #1a1a1a / #242424 / #2d2d2d greyscale so the code is the figure and the UI is the ground.

### How this maps to the build

The diff content (`files`, `patch`) and the merge outcome are produced by the real `@maestro/workspace` package (`GitWorkspaceManager.diff` and `.merge`), which already runs real `git worktree` operations. `merge` returns the union `MergeResult` from `@maestro/core` types: `{ status: "clean" }` or `{ status: "conflict"; files }`. The review screen is a cockpit-driven webview rendering over that data, not a reimplementation of git.

### Open questions

- Side-by-side vs unified diff toggle: worth it, or scope creep for v1?
- Where does per-file approval live if a reviewer wants to accept most files but flag one? Today the unit is the whole branch.

## The conflict variant

### Purpose

When a merge cannot apply cleanly, the same screen pivots to a resolution surface instead of bouncing the user out to a raw git mess. The conductor should be able to resolve and finish without leaving the board, or hand off to the editor when the conflict is gnarly.

### Layout and components

Triggered by `MergeResult { status: "conflict"; files }`. The decision bar's outcome flips to a conflict banner (background #2d2d2d, left border 3px amber #f0a030, text #e8e8e8: "Merge conflict in N files"). The file list marks the conflicted files with an amber #f0a030 dot and pulls them to the top.

In the diff body, conflict hunks render the literal git conflict markers, each line tinted amber #f0a030:

- `<<<<<<< ours` opens the local/base side.
- `=======` divides the two sides.
- `>>>>>>> theirs` closes the incoming/agent side.

Each conflict hunk carries an inline three-choice control rendered between the marker and its body: **Keep ours**, **Keep theirs**, and **Edit**. "Keep ours" / "Keep theirs" are #2d2d2d chips; the chosen side highlights with an amber #f0a030 outline. "Edit" opens that hunk for inline text editing (or hands off to the editor's merge view, see below). A footer action **Resolve and merge** replaces "Merge into main" and stays disabled until every conflict hunk has a choice.

### States and interactions

This variant must mirror what the workspace package actually does, so the UI never promises an operation git did not run:

- **Serialized merge mutex.** Merges do not race. The orchestrator chains each merge onto a lock so only one touches the shared git index at a time (`orchestrator.ts`: "Merges serialize: each call chains onto this lock before touching the git index"). In the UI, if a second agent's merge is requested while one is running, its button shows "Waiting for merge lock…" rather than firing concurrently.
- **Stale check + rebase.** Before merging, the screen can call `isStale(agentId)`, which is true when repo HEAD has advanced past the SHA the agent branched from. When stale, a #242424 advisory appears: "main moved since this agent started" with a **Rebase onto main** action that calls `rebase(agentId)`. Rebase returns the same `MergeResult` union: a clean rebase updates the stored base and re-enables Merge; a conflicting rebase drops the user straight into this conflict variant (rebase conflicts and merge conflicts share the marker UI).
- **Resolve.** "Resolve and merge" calls `resolveMerge(agentId)`. That function re-probes for any still-unmerged paths first: if some remain, it returns `{ status: "conflict"; files }` again and the screen re-lists exactly those files with a "still unresolved" note (it does not commit a half-resolved tree). Only when every marker is resolved does it stage and commit, returning `{ status: "clean" }` and moving the agent to `merged`.
- **Conflict is non-terminal.** A conflicted agent is not a dead agent: it sits in the `conflict` state with its worktree preserved, so the conductor can resolve now, send it back for the agent to redo, or discard. Lifecycle in [02-conducting-board-and-lifecycle.md](./02-conducting-board-and-lifecycle.md).

### Visual treatment

Amber #f0a030 is the conflict color and is used only here (marker lines, the conflict dot, the banner border, the chosen-side outline). It is deliberately distinct from the green/red of diff content: a reviewer scanning the file list instantly tells "this changed" (green/blue/red dots) from "this collides" (amber dot).

### How this maps to the build

`merge`, `isStale`, `rebase`, and `resolveMerge` are all real methods on `GitWorkspaceManager` today (milestone M9). The extension already exposes conflict-resolve-in-editor and finish-merge commands, so the in-board "Edit" choice can either edit inline (prototype-drawn) or invoke the editor's native merge view (already wired). The per-hunk Keep ours / Keep theirs chips are the prototype's drawn convenience over the same resolve-then-`resolveMerge` flow; git does the actual merge.

### Open questions

- Inline hunk editing vs always handing off to the VS Code merge editor: which is the default, and do we even ship inline editing for v1?
- "Keep ours / Keep theirs" need to write real resolved content before `resolveMerge`; the drawn chips imply a resolution writer the prototype only simulates.

## PR mode

### Purpose

Some teams never merge straight to `main` locally; they want a pull request and CI. When `maestro.prMode` is enabled in settings, the same review screen targets a PR instead of a local merge.

### Layout and components

The decision bar's primary slot changes from **Merge into main** to **Create PR** (still the single #4a9eff filled button). The branch line in the header gains a small "PR mode" pill in #6a6a6a. A draft indicator reflects `maestro.prDraft`: when on, the button reads "Create draft PR" and shows a faint "draft" tag. The summary block does double duty: its text seeds the PR body, and the task description seeds the PR title.

### States and interactions

- **Create PR** calls `pushAndPr(agentId, opts)`, which pushes `agent/<slug>` to the remote and runs `gh pr create` (honoring `--draft` from `maestro.prDraft`). On success the screen shows the returned `prUrl` as a clickable link and moves the agent to the **`pr-created`** state: the worktree is released but the branch is kept (so the PR keeps its source ref). `pr-created` is terminal.
- **Failure** (push rejected, `gh` missing, no PR URL parsed) surfaces the underlying error in a #1e1e1e panel in #a0a0a0; the agent stays `done` so the user can retry or fall back to local merge.
- PR mode does not run a local conflict resolution: conflicts there are GitHub's job. The conflict variant above is for local merges only.

### How this maps to the build

`pushAndPr` is real on `GitWorkspaceManager` and uses an injectable `shellRunner` for `gh`, so the flow is offline-testable. The `pr-created` state and `releaseWorktree` (worktree gone, branch retained) exist in core/workspace today. `maestro.prMode` and `maestro.prDraft` are real extension settings, and the create-PR command is already wired. The drawn part is the PR-mode framing of this screen; the push-and-open is implemented. Lifecycle states in [02-conducting-board-and-lifecycle.md](./02-conducting-board-and-lifecycle.md).

## Recovery states

### Purpose

Sometimes the code lands but the bookkeeping does not. The screen must distinguish "your merge failed" (code did not land) from "your merge succeeded but I could not tidy up" (code landed, worktree stuck), because the recovery is completely different.

### Layout and components

- **`merge-cleanup-failed`.** This is the awkward-but-safe case: the merge commit is on `main`, but removing the agent's worktree (or deleting its branch) failed. The screen shows a #2d2d2d banner with an amber #f0a030 left border and reassuring copy: "Merged successfully. Worktree cleanup did not finish." plus a **Retry cleanup** primary action and a muted note that the code is already in `main`, so this is housekeeping, not data loss. The agent card carries the `merge-cleanup-failed` badge. Retry calls the extension's retry-cleanup command (the orchestrator's `retryCleanup`); on success the agent settles to `merged`.
- **`retainBranchOnMerge` option.** A settings-level toggle surfaced here as context: when on, a successful merge keeps the agent branch (only the worktree is removed), useful for teams that want the branch to linger for audit or a later PR. The confirmation copy reads "branch kept" instead of "branch deleted" so the conductor is never surprised by leftover branches. `discard` always deletes the branch regardless of this setting.

### States and interactions

- The key reassurance, repeated in copy and color: `merge-cleanup-failed` is **not** a failed merge. The banner never uses red #e05050 (which would imply rollback); it uses amber #f0a030 (attention, not danger) precisely because the code is safe.
- Retry cleanup is idempotent on the user side: pressing it again after a partial cleanup is harmless (`teardown` is a no-op when no record remains).

### How this maps to the build

`merge-cleanup-failed` is a real terminal-ish state in `@maestro/core` AgentState, recovered via the orchestrator's `retryCleanup` / `finishConflictResolution` path, and the extension ships a retry-cleanup command (milestone M9). `retainBranchOnMerge` is a real `GitWorkspaceManagerOptions` flag affecting `cleanup` (worktree removed, branch kept). The drawn part is the reassuring banner and the framing of cleanup-as-housekeeping.

### Open questions

- Should `merge-cleanup-failed` auto-retry once before bothering the human, or always surface immediately?

## How this all maps to the build (summary)

- **Real today (M9 and earlier):** the entire merge engine. Real `git worktree` per agent; `diff` (with NUL-delimited filenames so Georgian and spaced paths survive); `merge` with the conflict-vs-real-failure discrimination; the serialized merge mutex in the orchestrator; `isStale`, `rebase`, `resolveMerge`; `pushAndPr` + `pr-created` + `releaseWorktree` for PR mode; `merge-cleanup-failed` + `retryCleanup`; `retainBranchOnMerge`; and the extension commands for conflict-resolve-in-editor, finish-merge, create-PR, and retry-cleanup, plus the `maestro.prMode` / `maestro.prDraft` settings.
- **Prototype-drawn (this design):** the full-width review layout, the changed-files rail, the styled unified diff, the agent summary card, the sticky decision bar, the per-hunk Keep ours / Keep theirs / Edit conflict control, the PR-mode framing, and the reassuring cleanup-failed banner. The prototype simulates these interactions; it is not wired to the real `@maestro/*` packages.
- **The seam to wire:** the cockpit presenter feeds the webview a render model derived from `Agent` (state, `summary`, `diff`, `conflict`, `diffError`) and the host invokes the real `GitWorkspaceManager` / orchestrator methods on each button. Nothing in this screen needs git logic it does not already have.
