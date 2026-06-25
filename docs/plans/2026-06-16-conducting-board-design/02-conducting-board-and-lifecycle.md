# Conducting Board and Agent Lifecycle

_The board where a conductor watches a team of agents at a glance, plus the exact lifecycle and engine-capability rules the cards and drawer obey._

> Part of the [Conducting Board design reference](./README.md). Visual tokens are defined in [01-overview-and-visual-language.md](./01-overview-and-visual-language.md).

This file documents the central surface of Maestro: the Conducting Board, the agent card on it, the drawer that opens from an agent, and the two ways work enters the board (the Dispatch composer and Launch Team). Every lifecycle and lane rule here is traced to the real `@maestro/core` types (`packages/core/src/types.ts`) and the cockpit selectors (`packages/cockpit/src`), so the prototype and the eventual wiring agree. The prototype only simulates the streams and transitions; it is not connected to the real packages.

## The Board

### Purpose

The board is the conductor's single pane. It answers one question without a click: which agents are quietly working, which are waiting on me, and which are finished or stuck. It is calm by default. Color is rationed so that the only thing that pulls the eye is a card that needs a human.

### Layout and components

Three vertical status lanes, left to right:

- **Working** (blue accent #4a9eff). Agents the engine is actively driving. Maps to `preparing` and `working`.
- **Needs you** (amber accent #f0a030). The attention lane. It collects every agent waiting on the conductor: awaiting-review, asking a question (blocked), errored, detached, or a merge that half-landed. This is the lane the eye should find first.
- **Done / Conflict** (green #4caf50 for done and safe, red #e05050 for conflict). Finished work and the one resolvable failure that is not a hard error.

Each lane has a Manrope header with a live count (for example `Needs you · 3`). The canvas is #1a1a1a; lane columns sit on #1e1e1e with #3a3a3a hairline separators. Cards are #242424 tiles. An empty lane shows a #5a5a5a placeholder line, never a hard border, so the board reads as restful rather than broken.

### States and interactions

- Default state is monochrome calm: most cards live in the Working lane with only a thin blue edge.
- When an agent moves into Needs you, its card gets the amber accent and the lane count ticks up. This is the only place the board raises its voice.
- Clicking any card opens the agent drawer (see below) and focuses that agent.
- Cards never reorder on hover; ordering changes only when state changes, so the board does not shuffle under the conductor's cursor.

### Visual treatment

Status is carried by a single accent: a 2px left border on the card plus a small status dot beside the role name, both in the lane color. Body text stays #e8e8e8, secondary lines #a0a0a0, faint metadata #6a6a6a. No card is fully colored in; the accent is the signal, the tile stays neutral so a wall of cards never becomes a wall of color.

### How this maps to the build

The ordering inside and across lanes is already pure and real. `selectState` in `packages/cockpit/src/select.ts` sorts every `CardVM` with `compareCards`, which is **attention-first**: cards where `attention === true` sort ahead of the rest, then ties break by stable `id`. The `attention` flag is not a UI guess; the reducer sets it from the core predicate `stateNeedsAttention(agent.state)` (`packages/cockpit/src/reducer.ts`). So "draw the eye only when a card needs you" is enforced by core policy, not by board styling. The board's three lanes are a presentation grouping over the same `CardVM[]`; the engineer buckets each card by `state` into Working / Needs you / Done-Conflict, and within each lane keeps the attention-first, id-stable order the selector already produces.

### Open questions

- Do we keep `stopped` agents on the board (in Done as a muted tile) or drop them out of view? Core marks `stopped` as terminal but **not** attention, so it would currently fall to the bottom of Done.
- When more than a handful of agents are running, does Working scroll, collapse to a count, or wrap? The selector stays correct either way; this is a layout-only decision.

## Agent Card Anatomy

### Purpose

One card is one running role. It should tell the conductor what this agent is, what engine drives it, why it exists, what it is doing right now, and how far along it is, all without opening the drawer.

### Layout and components

Top to bottom inside a #242424 tile:

1. **Role name** in Manrope (for example `Test Author`), with a status dot in the lane color.
2. **Engine chip**: a small pill naming the engine, sourced from `role.engine.id` and `role.engine.model`. Examples: `copilot`, `claude-sonnet-4.5`, `gpt-5`, `o3`, `gemini`. The chip is #2d2d2d on #242424 with #a0a0a0 text.
3. **Goal / why line**, faint italic #6a6a6a, phrased as a "so that ..." clause (for example _so that the refactor cannot silently break checkout_). This is the one idea worth keeping from the Paperclip concept: a one-line reason the agent exists, framed as intent, not task.
4. **Current task line** in #e8e8e8: the active `task.description`.
5. **Diff stats**: `+adds` in green #4caf50 and `-dels` in red #e05050, derived from the agent's `diff.files` / patch once a diff exists. Hidden until there is a diff.
6. **Elapsed timer** in #6a6a6a, ticking while the agent is non-terminal.
7. **Anatomy row**, a compact one-liner reading `☽ soul · 🔧 5 · ◆ run-tests +2`: the soul glyph for the role's persona, the wrench with a tool count, and the skill diamond with a named skill and count. This row is **omitted entirely** when the agent has none of soul, tools, or skills; we never render empty glyph slots.

### States and interactions

- The accent border and dot color track the agent's lane.
- Diff stats and the anatomy row appear and disappear as data arrives; their absence is meaningful (no diff yet, no skills attached), not a layout gap.
- Clicking anywhere on the card opens the drawer focused on this agent.

### Visual treatment

Glyphs are monochrome and quiet: four-bars equalizer for product/dispatch identity, ◆ for skill, ☽ for soul, 🔧 for tools. They sit in the faint #6a6a6a metadata register so the card's loudest element is always the role name and (when present) the lane accent.

### How this maps to the build

Everything on the card already exists on `CardVM` (`packages/cockpit/src/protocol.ts`): `roleName`, `engineId`, `state`, `summary`, `diff`, `diffError`, `conflictFiles`, `error`, and `attention`. The engine chip is `engineId` (plus model from the role). The goal/why line and the soul/tools/skills anatomy row are **net-new fields** not yet on `CardVM`; they belong to the Agents library (role definitions) and should be threaded through `Role` and onto the card view model. Diff stats are a render of the existing `diff`. The elapsed timer is a UI-derived value (now minus a launch timestamp); core does not yet carry a start time, so the prototype fakes it and the build will need one persisted alongside the agent.

### Open questions

- Where does the "why" line live canonically: on `Role` (so every instance inherits it) or on `Task` (so it can be per-dispatch)? Leaning toward Role with a per-dispatch override in the composer.
- Tool and skill counts need a source. Until the Agents library is wired, treat the anatomy row as decorative and omit it rather than show zeros.

## Lifecycle Mapping

### Purpose

The card and drawer must render exactly the twelve states core can produce, in the right lane, showing the right thing, inviting the right action. This table is the contract.

### States and interactions

The `AgentState` union (`packages/core/src/types.ts`) is the authoritative list. Lane and attention come straight from `NEEDS_ATTENTION_BY_STATE` in `packages/core/src/events.ts`; "terminal" comes from `TERMINAL_BY_STATE`.

| State | Lane | Attention | Card shows | Invites |
| --- | --- | --- | --- | --- |
| `preparing` | Working | no | spinner, "setting up worktree" | nothing (wait) |
| `working` | Working | no | live stream, elapsed timer | open drawer to watch / steer |
| `awaiting-approval` | Needs you | yes | the pending `approvalDetail` (tool · description) | Approve / Deny in drawer |
| `done` | Done | yes | summary + diff stats | review diff, Merge / Discard / Send-back |
| `error` | Needs you | yes | `error` message | read output, Discard, Send-back |
| `stopped` | Done (muted) | no | "stopped by you" | Discard |
| `merged` | Done | no | "merged into base" (terminal) | nothing |
| `discarded` | Done (muted) | no | "worktree discarded" (terminal) | nothing |
| `conflict` | Done (Conflict, red) | yes | `conflictFiles` list | Resolve in editor, then Finish merge |
| `detached` | Needs you | yes | "process gone, worktree kept" | Reattach / Merge / Discard |
| `merge-cleanup-failed` | Needs you | yes | "merged, but worktree cleanup failed" | Retry cleanup |
| `pr-created` | Done | no | "PR opened, branch kept" (terminal) | open PR link |

Notes the engineer must honor:

- `conflict` is **non-terminal** on purpose (core keeps it resolvable), so it stays interactive and stays in the attention set even though it lives visually in the Done/Conflict lane under the red accent.
- `pr-created` is terminal **and not** attention: once a PR carries the review, the board has nothing left to surface, so the card rests quietly in Done. It is still discardable (the branch can be deleted later).
- `detached` means the process is gone but the worktree is preserved on disk; this is the recovery path after a reload, and the only state offering Reattach.
- `merge-cleanup-failed` means the code did land in the branch; only the worktree removal failed. Its single affordance is Retry cleanup. Both `pr-created` and `merge-cleanup-failed` and the conflict resolution flow are detailed in [06-diff-merge-review.md](./06-diff-merge-review.md).

### How this maps to the build (capabilities and graceful degradation)

`Capabilities { streaming, structuredEvents, approvals, steerable }` is per-engine and drives what the drawer is allowed to offer. The UI does not need adapter access: the narrowed `engineCapabilities { approvals, steerable }` is carried onto every `Agent` and through to `CardVM`. Rules:

- Offer **Approve / Deny** only when `approvals === true` and the agent is `awaiting-approval`. An engine without approvals never enters that state, and the drawer must not render an approval panel for it.
- Offer **Steer** only when `steerable === true`. Otherwise the drawer falls back to plain, read-only output streaming.
- `streaming === true` feeds the Output tab live; if an engine cannot stream, the Output tab shows whatever batched text arrives and the elapsed timer still runs.
- `structuredEvents` lets the card render richer action lines (tool calls) instead of raw text; without it, output is plain text only.

This is graceful degradation by capability, not by engine name: a generic ACP engine that reports `approvals: false, steerable: false` collapses the drawer to Instructions / Output / Diff with no approve and no steer, and that is correct, not a bug.

### Open questions

- For `detached`, "Reattach" has no orchestrator verb yet in the webview protocol (which exposes merge, discard, resolve-conflict, finish-merge, create-pr, retry-cleanup, sendBack). Reattach likely maps to hydrate plus relaunch and needs a protocol message defined.
- Should `stopped` and `discarded` auto-fade off the board after some time, or stay until the conductor clears them?

## The Agent Drawer

### Purpose

The drawer is the workbench for one agent. It slides in from the right edge of the board and lets the conductor read the role, watch the stream, inspect the diff, and act, without leaving the board context.

### Layout and components

A right-side panel (the board dims but stays visible behind it), #1e1e1e surface, #3a3a3a left border. Header: role name, engine chip, state pill, close affordance. Body is tabbed:

- **Instructions**: the editable role markdown plus the current task. Editing here updates the role's prompt; saving can feed a re-launch.
- **Output**: the live stream (the agent's accumulated `output`, capped per `OUTPUT_CAP`).
- **Diff**: the changed files and patch, the entry point to Merge / Discard. See [06-diff-merge-review.md](./06-diff-merge-review.md).

Below the tabs, a capability-gated action bar:

- **Approve / Deny** when `engineCapabilities.approvals` and state is `awaiting-approval`.
- **Steer**: a free-text box that injects guidance into the running agent, shown only when `engineCapabilities.steerable`.
- **Send-back**: re-launch a `done` or `conflict` agent in the **same worktree** with new instructions (a free-text feedback box plus a button).

### States and interactions

- **Working / steerable**: Output tab is live; the Steer box is active and sends guidance into the running process.
- **Awaiting-approval**: the drawer foregrounds the approval panel showing `approvalDetail.tool` and `approvalDetail.description`, with Approve and Deny.
- **Done / conflict**: the Diff tab leads, and Send-back is available to relaunch in place with feedback.
- **Blocked variant**: when an agent asks the conductor a question (a blocking ask rather than a tool approval), the drawer renders an **answer-to-unblock** box: the question is shown, the conductor types an answer, and submitting resumes the agent. This is distinct from Approve/Deny (which is a yes/no on a tool action); answer-to-unblock is free text that the agent consumes as input.

### Visual treatment

Tabs use Manrope labels; body copy is Inter on #e8e8e8. Inactive tabs sit at #6a6a6a. The action bar buttons inherit lane semantics: Approve and Merge lean green #4caf50, Deny and Discard lean red #e05050, Steer and Send-back are neutral #2d2d2d with #e8e8e8 text. Capability-disabled actions are not greyed out, they are absent, so the drawer never teases an action the engine cannot perform.

### How this maps to the build

The webview-to-host protocol (`packages/cockpit/src/protocol.ts`) already carries the verbs the drawer needs: `steer` (agentId, input), `approve` (agentId, approvalId, decision allow/deny), `sendBack` (agentId, feedback), `merge`, `discard`, `resolve-conflict`, `finish-merge`, `create-pr`, `retry-cleanup`. Send-back maps to the `sendBack` message, which relaunches in the same workspace. The action bar's visibility is computed from `engineCapabilities` on the focused `CardVM`. The answer-to-unblock box is the one piece without a dedicated protocol message yet; in the prototype it is simulated, and the build should decide whether it rides on `steer` (free-text into a running agent) or needs its own verb.

### Open questions

- Is the blocking "ask the conductor a question" surfaced as its own engine event, or is it modeled as a special approval with a free-text answer? This decides whether answer-to-unblock reuses `steer`/`approve` or gets a new message.
- Editing Instructions on a `working` agent: does saving steer the live agent, or only take effect on the next send-back / relaunch?

## Dispatch Composer

### Purpose

The composer is how a single new agent is born. It is a focused modal for choosing a role, an engine, a why, and a task, then dropping a streaming card onto the board.

### Layout and components

A centered modal over a dimmed board, #242424 surface, #3a3a3a border. Fields, top to bottom:

- **Role preset chips**, sourced from the Agents library. Picking a preset prefills its engine and its instructions (see [03-agents-teams-and-anatomy.md](./03-agents-teams-and-anatomy.md)).
- **New-role free-text field** for an ad-hoc role when no preset fits.
- **Engine pills** (for example `copilot`, `claude-sonnet-4.5`, `gpt-5`, `o3`, `gemini`); selecting a preset chip pre-selects its engine, which the conductor can still override.
- **Goal field** labeled "Goal · the why (so that ...)", which becomes the faint italic line on the card.
- **Task field**, the concrete instruction.
- **Dispatch button**, stamped with the four-bars equalizer mark.

### States and interactions

- Choosing a preset chip fills engine + instructions; the conductor can edit any field afterward.
- Dispatch is disabled until at least a role (preset or free-text) and a task exist.
- On Dispatch, the modal closes and a new card appears in the **Working lane** in `preparing`, then begins streaming as the engine starts.

### Visual treatment

Calm and centered, with the equalizer mark as the only accented element on the Dispatch button (blue #4a9eff fill). Preset chips are #2d2d2d pills; the selected chip gets a thin blue ring. Field labels are Manrope #a0a0a0, inputs Inter #e8e8e8 on #1e1e1e.

### How this maps to the build

Dispatch maps to the protocol `spawn` message (`roleName`, `description`); the role and engine resolve against the Agents library to produce a `Role` and the task description. The new card flows back as an `agent-added` orchestrator event, which the reducer turns into a `CardVM` in `preparing` (attention false, so it sits calmly in Working). The "why" field is the same net-new goal field discussed in the card anatomy section and needs a home on `Role`/`Task`.

### Open questions

- Does the composer let the conductor set autonomy (`manual` / `auto-approve-safe` / `yolo`) per dispatch, or is that fixed by the role preset? `Role.autonomy` exists in core but is not in the `spawn` message.

## Launch a Team

### Purpose

Sometimes the conductor wants a whole team on a problem at once, not one agent at a time. Launch Team dispatches every member of a named team together.

### Layout and components

A command, **"Maestro: Launch Team"**, opens a team picker (a list of teams defined in the Agents library). Selecting a team and confirming dispatches each of its roles. See [03-agents-teams-and-anatomy.md](./03-agents-teams-and-anatomy.md) for how a `Team` is defined as a named group of `Role`s.

### States and interactions

- Picking a team and confirming drops one streaming card per member into the **Working lane** simultaneously, each `preparing` then `working`.
- The Needs you lane stays empty at launch; cards only migrate there as individual members reach approvals, questions, completion, or trouble.

### Visual treatment

The picker matches the Dispatch composer's calm modal styling. On launch, the Working lane populates in one beat rather than one card at a time, so the conductor sees the team arrive as a set.

### How this maps to the build

This maps to the `Team` type in core and the existing Launch Team command and team picker. Each member becomes its own `Agent` with its own worktree, emitting its own `agent-added` event, so the board fills via the same reducer path as a single dispatch. There is no special "team" grouping on the board itself; members are ordinary cards. Any cross-member relationship (shared goal, dependencies) is metadata for a later view, not a board primitive in this slice.

### Open questions

- Should team members carry a shared "team" tag on their cards so the conductor can visually group them, or is the shared `task.description` enough?

## Ambient Chrome

### Purpose

A thin frame that keeps the conductor oriented and lets them tune the board's intensity without leaving it.

### Layout and components

- **Status bar line**: a compact running tally such as `2 running · 3 awaiting review`, derived from lane counts. It lives in the VS Code status bar so it is visible even when the board is not focused.
- **Tweaks panel**: a small settings flyout with three controls: **density** (comfortable / compact card spacing), **live output on/off** (whether cards stream output inline or only in the drawer), and **reduce motion** (suppress timer ticks and stream animation for calmer rendering and accessibility).

### States and interactions

- The status line updates as agents change lanes; "running" counts Working, "awaiting review" counts the attention set in Needs you.
- Tweaks are conductor preferences, not agent state; they re-render the board but never touch orchestration.

### Visual treatment

The status line uses the lane colors sparingly: the "awaiting review" number can take amber #f0a030 when greater than zero, otherwise the line stays #a0a0a0 so a quiet board produces a quiet status line.

### How this maps to the build

The status counts are pure derivations over `CockpitState.cards`: "running" is cards in `preparing`/`working`, "awaiting review" is cards where `attention === true` (the same flag the selector orders by). Tweaks are local UI settings persisted with the extension; "reduce motion" should also respect the editor's own reduced-motion preference. None of this changes core or the orchestrator.

### Open questions

- Does "live output on/off" default off for calm, or on for visibility? Leaning off, with the drawer as the place to watch a stream closely.
- Should density and reduce-motion sync from VS Code settings, or stay board-local toggles?
