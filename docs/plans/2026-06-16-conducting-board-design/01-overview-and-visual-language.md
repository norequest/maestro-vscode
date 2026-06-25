# Maestro Conducting Board: Overview and Visual Language

_Canonical reference for the visual token system, product principles, and information architecture of the Conducting Board north-star design._

> Part of the [Conducting Board design reference](./README.md).

---

## The Pivot

Maestro shipped nine milestones (M1 through M9) as a real, installable VS Code extension. The shipped system includes: parallel agents running in isolated git worktrees, two engine families (Copilot CLI and a generic ACP adapter) behind a shared conformance suite, approve/steer/send-back steering from the UI, persistence with detached-recovery, `.conductor/` YAML role and team configuration, and a production-grade serialized-merge pipeline. The full gate runs 295+ tests across 8 packages.

On 2026-06-16 the founder dogfooded the extension and found the bare roster-plus-stage UI did not match expectations. The gap was not functionality but surface: a plain agent list and a raw log stream did not communicate what was happening, what needed attention, or what the team had accomplished. The founder's reaction was "I expected different."

The decision that followed: design a richer visual "Conducting Board" UX first, in Claude Design, before building more UI. This reference documents the resulting north-star. The interactive hi-fi prototype lives at:

```
https://claude.ai/design/p/87e11d04-30fb-4be6-8ea1-0e120a98618e
```

File name in Claude Design: `Maestro.dc.html`.

This reference is a build document, not a pitch. A frontend engineer and a designer should be able to implement from these files without the prototype being wired to production.

---

## Inspiration and Stance

The design borrows selectively from [Paperclip](https://github.com/paperclipai/paperclip), a self-hosted web dashboard for running an "AI company" with an org chart, per-agent budgets, and hire/fire controls.

**What Maestro borrows:**

- Per-agent goal context: every agent card shows a one-line "why" alongside its current status.
- Diff-centric review: completed work is reviewed as a diff before it is merged, not accepted blindly.
- Team-at-a-glance: the primary surface is the whole team, not a single agent's log.

**What Maestro explicitly rejects:**

- The company/CEO/budget metaphor. Agents are not employees; there is no org chart, no budget counter, no hire/fire vocabulary.
- The non-interactive heartbeat default. Paperclip shows you a dashboard you watch. Maestro is live-steerable: you can approve, redirect, and send back.
- Per-agent API-key auth. Maestro reuses each tool's own login via CLI subprocess. No API key is ever entered into Maestro. This is a first-class constraint, not a nice-to-have.

Maestro stays editor-native, subscription-auth, and live-steerable. The visual language follows from those constraints.

---

## Product Principles

- **Editor-native.** Maestro lives inside VS Code as a real extension, not a separate web app or Electron shell. It integrates with the native activity bar, panels, and webview host.
- **Model-agnostic via engine adapters.** The Copilot CLI adapter and the generic ACP adapter both pass the same conformance suite. Swapping engines does not change the UI contract.
- **Worktree isolation.** Each agent works in its own real `git worktree`. Branches do not collide. The board reflects this with per-card branch labels.
- **Review-the-diff before merge.** No agent's output lands in the working tree without the user opening a diff screen and explicitly choosing to merge or discard.
- **Calm-until-attention.** The board stays visually quiet, near-monochrome, until an agent needs the user. Color is a signal, not decoration.
- **Live-steerable.** Where the engine's declared `Capabilities` permit it, the user can approve a checkpoint, steer the agent mid-run, and send completed work back for a follow-up pass. The UI surfaces only the controls that the active engine supports.

---

## The Hero Decision: The Conducting Board

The primary surface is a lane-based **Conducting Board**: a kanban-style view of all active agents, grouped by lifecycle state, calm until something needs the user's attention.

Lanes (detail in [02-conducting-board-and-lifecycle.md](./02-conducting-board-and-lifecycle.md)):

| Lane | Signal color | Meaning |
|------|-------------|---------|
| Working | Blue dot only | Agent is running; no action required |
| Needs You | Amber border + ⚠ chip | Agent is waiting for approval, steering input, or conflict resolution |
| Done | Green dot | Agent finished; diff is ready to review |
| Conflict | Red border in Done | Merge encountered a conflict; manual resolution is required |

The board is the default screen. It does not auto-scroll, animate continuously, or compete for visual attention while agents are working. A user can glance at it, see nothing amber or red, and return to their own editing.

Clicking an agent card opens a right-hand **Agent Drawer**: a slide-in panel showing the log stream, current goal, branch, skill assignment, and any available steering controls. The drawer does not navigate away from the board; the card remains visible in the lane behind it.

---

## Information Architecture and Navigation Map

Navigation lives in a narrow **left sub-rail** anchored to the VS Code activity-bar panel. Two top-level destinations:

```
[ ≡ ]  Conducting Board     (default, always reachable)
[ ⬡ ]  Library              (Agents & Teams manager)
```

### Surfaces and how a user moves between them

```
VS Code Activity Bar
└── Maestro Panel (webview host)
    ├── LEFT SUB-RAIL
    │   ├── Board icon  ──────────────────────────────────► Conducting Board (lane view)
    │   │                                                        │
    │   │   [ + Dispatch ]  (FAB, opens centered modal)         │
    │   │   [ Launch Team ] (opens centered modal)              │
    │   │                                                        │
    │   │                                            Card click ▼
    │   │                                       Agent Drawer (right slide-in)
    │   │                                       Review Diff button ▼
    │   │                                       ──────────────────────────
    │   │                                       Diff / Merge Review screen
    │   │                                       (full-width, replaces board)
    │   │
    │   └── Library icon  ────────────────────────────────► Library (full-screen)
    │                                                            │
    │                                            Tabs ──────────┤
    │                                            Agents         │
    │                                            Teams          │
    │                                            Skills         │
    │                                            Discover       │
    │                                          (detail: 03, 04, 05)
    │
    └── Modals (centered, float over board or library)
        ├── Dispatch Composer   (new single-agent task)
        └── Launch Team         (pick a team from .conductor/config.yaml)
```

The Diff/Merge Review screen (detail in [06-diff-merge-review.md](./06-diff-merge-review.md)) is the only surface that fully replaces the board. All other interactions layer on top: the drawer slides in, modals float, chips appear in-place.

The Library tabs are documented in:
- Agents and Teams: [03-agents-teams-and-anatomy.md](./03-agents-teams-and-anatomy.md)
- Skills: [04-reusable-skills.md](./04-reusable-skills.md)
- Discover: [05-discover-and-adopt.md](./05-discover-and-adopt.md)

---

## Visual Language

### Design philosophy

The canvas is near-monochrome graphite. Color appears **only** to signal state or demand attention. The only persistent chroma in a calm session is the active-engine pill (a small blue or teal badge in the header) and the status dot on each card. Everything else is shades of the background stack.

This is not minimalism for its own sake. It means that when an amber border appears on a card, it is impossible to miss. The signal-to-noise ratio is the feature.

### Background stack

| Token | Value | Usage |
|-------|-------|-------|
| `bg-stage` | `#1a1a1a` | Overall panel and board background |
| `bg-card` | `#242424` | Agent cards, modal surfaces, library rows |
| `bg-raised` | `#2d2d2d` | Dropdowns, tooltips, hover overlays, sub-panels |
| `bg-code` | `#1e1e1e` | Log streams, diff surfaces, markdown code blocks |
| `border-default` | `#3a3a3a` | Card borders, dividers, input outlines |
| `border-hover` | `#4a4a4a` | Card border on hover, focused inputs |

### Text scale

| Token | Value | Usage |
|-------|-------|-------|
| `text-primary` | `#e8e8e8` | Agent name, headings, active labels |
| `text-secondary` | `#a0a0a0` | Goal line, sub-labels, timestamps |
| `text-tertiary` | `#6a6a6a` | Metadata, inactive tab labels |
| `text-ghost` | `#5a5a5a` | Placeholder text, disabled states |

### Status colors (signal only)

These values appear **only** on status dots, border accents, and attention chips. They are never used as background fills for large surfaces.

| Token | Value | Meaning |
|-------|-------|---------|
| `status-working` | `#4a9eff` | Agent is running (blue) |
| `status-attention` | `#f0a030` | Needs user action: approval, steer, write permission (amber) |
| `status-done` | `#4caf50` | Work complete or permission granted (green) |
| `status-conflict` | `#e05050` | Blocked: merge conflict, error, destructive gate (red) |

Amber carries a dual meaning: "needs you" as an approval gate, and "can write" as a permission request. Both resolve when the user acts. Green means safe: the agent finished, a merge succeeded, a permission was granted. Red means something broke or requires manual intervention.

### Typography

| Role | Family | Weight | Usage |
|------|--------|--------|-------|
| Labels, headings | Manrope | 500 / 600 | Card titles, section headers, chip labels, modal titles |
| Body, code | Inter | 400 / 500 | Goal lines, log streams, diff text, description paragraphs |

Both fonts are loaded from the extension's bundled assets or the VS Code webview font stack. Do not depend on system fonts for these specific families.

### Glyph vocabulary

These glyphs appear as small inline marks, not large icons. They reinforce meaning without color.

| Glyph | Name | Usage |
|-------|------|-------|
| Four-bars equalizer `≡` (or SVG equivalent) | Product / dispatch mark | Maestro header, dispatch trigger, board identity |
| Diamond `◆` | Skill sigil | Marks a skill chip on a card or in the Skills library |
| Crescent `☽` | Soul | Decorative identity mark on the agent drawer header (engine personality) |
| Wrench `🔧` | Tools | Tool-access row in the agent drawer; shows what the agent can call |
| Small hexagon `⬡` | Shared reference | Marks a shared context file or reference artifact |
| External link `⧉` | Plugin / external source | Marks a Discover item sourced from outside the local workspace |
| Warning `⚠` | Write / attention | Appears in the Needs-You chip when the agent has requested write access or a human decision |

### Radius and geometry

| Element | Radius | Notes |
|---------|--------|-------|
| Cards | 6px | Agent cards, modal containers, library rows |
| Chips | 4px | Status chips, engine pills, skill badges |
| Buttons | 6px | Matches card radius for visual cohesion |
| Inputs | 4px | Matches chip radius |

### Core repeating components (language-level)

**Card** (`#242424`, border `#3a3a3a`, radius 6px): the atom of the board. On hover, the border lifts to `#4a4a4a` and the card surface may lift 1px via a subtle box-shadow (`0 2px 8px rgba(0,0,0,0.4)`). A card in the Needs-You lane gains an `#f0a030` left border accent (3px). A card in Conflict gains `#e05050`. Cards never animate continuously; motion happens only on state transitions.

**Chip** (`bg-raised` or transparent, border `border-default`, radius 4px): inline metadata. Used for status labels ("Working"), skill sigils, branch names, and attention markers. Chips are not interactive by default; when they are (like an approval chip), they gain a hover state.

**Lane header**: a small all-caps Manrope 500 label in `text-tertiary`, with a count badge. No separator line is needed; the spatial grouping of cards below is sufficient. The lane header is not sticky unless the board scrolls vertically.

**Centered modal** (`#242424`, radius 6px, deep shadow `0 24px 64px rgba(0,0,0,0.7)`, backdrop `rgba(0,0,0,0.6)`): used for the Dispatch Composer and Launch Team picker. Width is fixed at 560px on a standard panel; it does not stretch to fill. The modal never has a colored header bar. The title is `text-primary` Manrope 600 at the top-left; a subtle close button sits top-right.

**Left anatomy sub-rail**: a narrow column (48px) anchored to the left of any full-screen panel (Board, Library, Diff Review). It carries icon buttons for top-level navigation and, on the Board, the Dispatch FAB. The pattern is reused across editors to keep spatial muscle memory consistent.

**Agent Drawer**: slides in from the right, covering roughly 40% of the board width. It does not push cards left; it overlays with a left-edge shadow. The drawer header shows agent name, engine pill, branch badge, and the soul glyph `☽`. Below the header: goal line, log stream on `bg-code`, and a footer strip with available steering controls.

---

## Prototype Status and Caveats

The interactive hi-fi exists at:

```
https://claude.ai/design/p/87e11d04-30fb-4be6-8ea1-0e120a98618e
```

Caveats for engineers reading this reference:

- **Session-state only.** All board data is held in client-side state and resets on reload. There is no persistence layer in the prototype.
- **Simulated streaming.** Log lines are emitted on timers. Real streaming from the `@maestro/adapter-copilot` or `@maestro/adapter-acp` packages is not connected.
- **Simulated timers.** Agent elapsed-time counters tick via `setInterval`. The real packages expose event timestamps; the mapping to display time is specified in [07-data-model-and-build-plan.md](./07-data-model-and-build-plan.md).
- **No real actions.** Approve, steer, send-back, merge, and discard buttons update prototype state only. Wiring to the real `Orchestrator` API is covered in [07-data-model-and-build-plan.md](./07-data-model-and-build-plan.md).
- **No engine subprocess.** The prototype has no concept of a real Copilot CLI or ACP process. Engine-specific capability flags (which controls appear) are hard-coded per card in the prototype.

The token values, glyph vocabulary, component geometry, and information architecture documented in this file are the canonical source. If the prototype diverges from this document, this document takes precedence during implementation.

For what is already built in the real packages versus what is only drawn, see [07-data-model-and-build-plan.md](./07-data-model-and-build-plan.md).
