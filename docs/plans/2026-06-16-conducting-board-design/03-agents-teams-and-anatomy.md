# Agents, Teams, and Agent Anatomy

_Defines the library surfaces where reusable roles and teams are authored, and the anatomy editor where a single role is composed layer by layer._

> Part of the [Conducting Board design reference](./README.md). Visual tokens are defined in [01-overview-and-visual-language.md](./01-overview-and-visual-language.md).

---

## Agents & Teams Library

### Purpose

The library is the persistent catalog of everything reusable: role cards, saved team configurations, skill procedures, and discoverable community content. It is a full-screen panel opened via the Library mark in the activity-bar strip on the left edge of the Conducting Board. Four tabs run across the top: **Agents | Teams | Skills | Discover**. Skills is detailed in [04-reusable-skills.md](./04-reusable-skills.md). Discover is detailed in [05-discover-and-adopt.md](./05-discover-and-adopt.md).

### Layout and components

The library panel sits at `#1a1a1a` (the outermost background). The tab bar is inset on `#242424` with the active tab underlined in `#4a9eff` (text `#e8e8e8`, inactive `#a0a0a0`). A search field lives to the right of the tab row. Below the tab bar the content area scrolls independently.

---

## Agents Tab

### Purpose

A browseable grid of saved role cards. Each card is a reusable template for a class of work: "TypeScript Reviewer", "Test Writer", "Docs Author". Selecting a card opens the anatomy editor. Dispatching a card to the board requires a task description (the board's quick-dispatch flow handles this; see [02-conducting-board.md](./02-conducting-board.md)).

### Layout and components

Cards sit on `#242424` with a `#3a3a3a` border, 8 px radius. Each card contains:

- **Name** (Manrope 14 px, `#e8e8e8`, semibold)
- **Engine chip** (Inter 11 px, pill at `#2d2d2d`, border `#3a3a3a`, text `#a0a0a0`; e.g. `copilot` or `claude-sonnet-4.5`)
- **Autonomy meter** rendered with the equalizer glyph (three vertical bars of varying fill): short/medium/tall fill maps to Manual / Auto-approve safe / Full auto respectively. A label sits below the glyph in `#6a6a6a` Inter 11 px.
- **Instructions snippet**: the first 60 characters of the role's `instructions` field, clamped to one line, `#a0a0a0` Inter 12 px.
- **Compact anatomy row** (see section below): shown only when the role carries at least one enrichment. Format: `☽ soul · 🔧 5 · ◆ run-tests +1`. Omitted entirely if the role has none.

The grid is three columns at comfortable library width, collapsing to two or one on narrow panel widths.

A `+ New agent` button sits at the top right of the grid. It opens a blank anatomy editor (described below).

### States and interactions

- **Hover**: card border lightens to `#5a5a5a`, a faint `#4a9eff` left-edge accent (2 px) appears.
- **Selected**: same left-edge accent, background shifts to `#2d2d2d`.
- **Context menu** (right-click or ellipsis icon on hover): Edit, Duplicate, Delete, Send to board.
- **Empty state**: centered illustration placeholder, `#6a6a6a` caption "No agents yet. Create your first with + New agent."

---

## Teams Tab

### Purpose

Saved team configurations that dispatch multiple agents at once, each with a shared goal and individual task lines. Teams map to `.conductor/teams/*.yaml` (data-model detail in [07-data-model-and-conductor-config.md](./07-data-model-and-conductor-config.md)).

### Layout and components

Same card grid as Agents. Each card shows:

- **Team name** (Manrope 14 px, `#e8e8e8`, semibold)
- **Agent-count badge**: `3 agents` (Inter 11 px pill, `#2d2d2d` background, `#a0a0a0` text)
- **Shared goal**: one-line snippet of the team's goal field, `#a0a0a0` Inter 12 px.
- **Member chips**: up to four inline agent-name pills (`#2d2d2d` / `#3a3a3a`), followed by `+N` if there are more.
- **Two actions** on hover: `Launch team` (primary, `#4a9eff` text) · `Edit` (secondary, `#a0a0a0` text).

`+ New team` opens the team builder (below).

### Team builder

A right-panel overlay on `#1e1e1e` at 480 px width. Sections top to bottom:

1. **Team name** text input (Manrope 14 px, `#2d2d2d` background, `#3a3a3a` border).
2. **Shared goal** text area (two rows, `#a0a0a0` placeholder "What is this team trying to accomplish?").
3. **Members** list: a multi-select of library agents. Each selected agent appears as a row: agent name chip on the left, a free-text task input on the right ("What should this agent do?"). The task line is per-dispatch; it does not overwrite the role's stored instructions.
4. **Launch team** button (full-width, `#4a9eff` background at hover; `#1a1a1a` text, Manrope 14 px semibold). On confirm, every member is dispatched into the Working lane simultaneously, each in its own worktree. The team builder also offers **Save without launching** to write the team to `.conductor/teams/` for later reuse.

The team builder validates that at least one member has a non-empty task line before enabling Launch.

---

## Agent Anatomy Editor

### Purpose

The anatomy editor is where a single role (a `Role` in `@maestro/core`) is authored or refined. It opens either from a library card ("Edit") or from "+ New agent". The editor composes every layer of the role in a single continuous scroll, guided by a sub-rail on the left.

### Layout and components

The editor splits horizontally:

- **Anatomy sub-rail** (200 px, `#1e1e1e` background, `#3a3a3a` right border): a vertical list of anatomy parts, each with a status dot (filled `#4a9eff` when the section has content, hollow `#3a3a3a` otherwise) and a label. Parts in order: Identity · Soul · Instructions · Tools · Skills · Engine · Autonomy.
- **Scroll canvas** (remaining width, `#1a1a1a`): all sections stacked vertically, separated by `#3a3a3a` 1 px dividers. Clicking a sub-rail item smooth-scrolls the canvas to that section and briefly pulses a `#4a9eff` left-accent on the section header.

A sticky header bar (`#242424`, `#3a3a3a` bottom border) holds the role name (editable inline, Manrope 16 px, `#e8e8e8`), a `Save` button, and a `Discard` link.

---

## Anatomy Section: Identity

**Purpose.** Name and one-line description. The engine and autonomy values are also surfaced here as a read-only summary so the top of the editor always shows the full role contract at a glance.

**Fields:**
- Name: Manrope 14 px text input (pre-filled if editing an existing role).
- Description: Inter 13 px text input, `#a0a0a0` placeholder "A one-line summary of what this agent does."
- Read-only summary line below: `copilot · Auto-approve safe` rendered in `#6a6a6a` Inter 12 px. Updates live as Engine and Autonomy sections change.

---

## Anatomy Section: Soul

**Purpose.** The agent's persistent identity: who it is across every task, independent of what it is currently doing.

**Helper line** (Inter 12 px, `#6a6a6a`, beneath the section header): "who it is"

The Soul section contains a single full-width markdown editor bound to the role's `soul.md` content. The editor is `#1e1e1e` background with `#3a3a3a` border and line-height 1.6 for readability.

**Recommended soul.md structure** (shown as a faint template when the field is empty):

```
## Identity
Who this agent is in one paragraph.

## Principles
Three to five non-negotiable values that shape every decision.

## Voice
Tone and communication style: terse/verbose, formal/informal, etc.

## Priorities
Ordered list: what this agent optimises for when trade-offs arise.

## Red lines
Actions this agent will never take regardless of instructions.
```

Aim for roughly 25 lines. The soul should be stable across months; if a line is only true for one sprint, it belongs in Instructions.

**Precedent note for the build reference.** Soul as a first-class agent artefact has clear prior art. OpenClaw ships `SOUL.md` alongside `AGENTS.md`: the distinction is explicit ("AGENTS.md is what to do; SOUL.md is who to be"). Anthropic's Claude constitutionification is a published value hierarchy that pre-dates most agent frameworks. Maestro's contribution is a formal two-tier precedence model applied at compose time (described in the Precedence section below), plus a per-team charter that unions red lines across members.

---

## Anatomy Section: Instructions

**Purpose.** The task: what this agent does on this job. Changes per dispatch.

**Helper line** (Inter 12 px, `#6a6a6a`): "what it does"

A twin markdown editor, visually identical to the Soul editor but on the right half of the canvas when viewport width allows a two-column view (breakpoint 900 px: below that, Instructions stacks below Soul). The visual pairing reinforces the distinction.

**Disambiguation test** (shown as a collapsed helper panel, expandable): "A line still true after this ticket is closed belongs in Soul. A line that dies with the ticket belongs here."

Instructions map directly to `Role.instructions` in `packages/core/src/types.ts`. Soul, tools, and skills are additive fields not yet in the type; [07-data-model-and-conductor-config.md](./07-data-model-and-conductor-config.md) details how they extend the persisted YAML without breaking the current `Role` interface.

---

## Anatomy Section: Tools

**Purpose.** A grantable subset of capabilities the agent may invoke. Write access is off by default.

**Layout:** A permission grid with two groupings:

**Built-in tools** (Read, Edit, Run, Search, Git): each row has the tool name (Inter 13 px, `#e8e8e8`), a brief description (`#6a6a6a` Inter 12 px), a `Read` toggle and a `Write` toggle. The Write toggle carries an amber (`#f0a030`) "can write" badge and is off by default.

**MCP servers**: a collapsible sub-group below built-ins. Each connected MCP server appears as a header row; its tools expand beneath it with the same read/write toggle pattern.

**Live summary** (right-aligned, Inter 12 px, `#a0a0a0`): "N granted · M can write" recomputes whenever a toggle changes. "Can write" count turns amber (`#f0a030`) when M > 0 to keep write grants visible.

**Helper line** beneath the section header: "Off by default is safe. Write is granted separately from read."

Granted read is shown with a filled green (`#4caf50`) indicator. Granted write is shown with an amber (`#f0a030`) indicator. Neither granted shows `#3a3a3a` hollow.

---

## Anatomy Section: Skills

**Purpose.** Reusable SKILL.md procedures attached to this role as callable steps.

Attached skills appear as `◆` chips (Inter 12 px, `#2d2d2d` background, `#4a9eff` text for the diamond glyph, `#a0a0a0` for the skill name). A chip with a pending upgrade shows the upgrade indicator: `◆ run-tests ⬡ · 4` where `⬡` signals a newer version available and `4` is the step count.

An `+ Add skill` button opens the skill picker. The full shared-skill-library treatment, the picker interaction, and the chip upgrade flow are in [04-reusable-skills.md](./04-reusable-skills.md).

---

## Anatomy Section: Engine

**Purpose.** Which AI engine runs this role's process.

A row of pill buttons: `copilot` (selected by default, `#4a9eff` border and text), `claude-sonnet-4.5`, `gpt-5`, `o3`, `gemini`. Unselected pills are `#2d2d2d` background, `#3a3a3a` border, `#a0a0a0` text. Only one pill may be active at a time.

The selected value writes to `Role.engine.id`. Model variant (e.g. `claude-sonnet-4.5` vs a future `claude-opus-5`) can be refined in a sub-field that appears below the pills when a non-Copilot engine is chosen.

`copilot` is the default because it reuses the developer's existing GitHub Copilot subscription with no additional API key.

---

## Anatomy Section: Autonomy

**Purpose.** How much the agent can do without pausing for human approval.

A segmented control with three segments:

| Segment | Value in `Role.autonomy` | Equalizer glyph fill |
|---|---|---|
| Manual | `"manual"` | one short bar |
| Auto-approve safe | `"auto-approve-safe"` | two medium bars |
| Full auto | `"yolo"` | three tall bars |

Selected segment: `#4a9eff` background, `#1a1a1a` text, Manrope 13 px semibold. Unselected: `#2d2d2d` background, `#a0a0a0` text.

**Helper line** (Inter 12 px, `#6a6a6a`): "Auto-approve safe runs read-only tools without asking, and pauses for anything that can write."

The `"yolo"` value in the type is surfaced in the UI as "Full auto" to keep the label appropriate for professional contexts.

---

## Soul Precedence Model

Maestro's novel contribution to agent composition is a formal two-tier precedence applied when the system preamble is assembled at spawn time.

### Two tiers

**Tier 1: Red lines (non-overridable).** Soul red lines outrank everything else, including task Instructions. Example: a testing agent whose soul says "never weaken a test to make it pass" will refuse an instruction that says "just make the suite green by any means." The engine sees a system preamble where the red line appears before the instruction, and the framing makes the hierarchy explicit.

**Tier 2: Principles and Priorities (overridable defaults).** Soul principles and priorities shape behaviour when the task instruction is silent or ambiguous, but an explicit instruction that conflicts with a principle takes precedence. Example: a soul principle of "prefer small focused commits" yields to an instruction "squash everything into one commit for this PR."

### Composition order

The system preamble is assembled in this order at spawn:

1. Soul (red lines first, then principles, voice, priorities)
2. Instructions (the current task)
3. Tools (the granted permission set, described as constraints)
4. Skills (referenced SKILL.md procedures)
5. The Task (the specific work description from the dispatch)

For the Copilot adapter this maps to the `buildArgs` function that assembles the `--prompt` string passed to `copilot -p`. For the ACP adapter it populates the `session/new` request body. Cross-link: [07-data-model-and-conductor-config.md](./07-data-model-and-conductor-config.md) details exactly where in each adapter the preamble is assembled.

### Shared souls and team charters

A role can reference a shared soul via a `soul:` field in its `.conductor/roles/*.yaml` that resolves to `.conductor/souls/<name>.md`. Multiple roles can share one soul file, which simplifies maintaining a consistent voice across an agent family (e.g. all "reviewer" agents).

At the team level, `.conductor/teams/<team>/charter.md` acts as a team-wide soul overlay. Its red lines union onto every member's red lines. The constraint is: a charter can only tighten, never loosen. A charter cannot grant a permission that a member's own soul red line forbids. The union means an agent working under a team charter respects both its personal red lines and the charter's red lines.

**Closing principle:** A soul earns its place only if removing it would change the agent's commits. If the commits would be identical without the soul, the soul is decorative and should be deleted.

---

## Compact Anatomy Row on Library Cards

Library and discovered cards gain a compact anatomy row beneath the instructions snippet when the role carries at least one enrichment:

```
☽ soul · 🔧 5 · ◆ run-tests +1
```

- `☽ soul` (`#a0a0a0` Inter 11 px): present when a soul.md is attached, either inline or via a shared `soul:` reference.
- `🔧 N` (`#a0a0a0` Inter 11 px): count of granted tools (read or write). The `🔧` glyph turns amber (`#f0a030`) when at least one write grant is active, matching the Tools section's "can write" colouring.
- `◆ skill-name +N` (`#a0a0a0` Inter 11 px): the first attached skill name, followed by `+N` for additional skills. The `◆` glyph is `#4a9eff`.

The row is omitted entirely for roles that have no soul, no granted tools beyond defaults, and no skills. Omission avoids visual noise on simple roles and makes enrichment meaningful at a glance.

---

## How These Surfaces Map to the Build

| UI concept | Current code anchor | Notes |
|---|---|---|
| Role card / anatomy editor | `Role` in `packages/core/src/types.ts` | `{name, instructions, engine, autonomy}`. Soul, description, tools, skills are additive fields for YAML; see 07. |
| Team grid / team builder | `Team` in `packages/core/src/types.ts` | `{name, roles[]}`. Shared goal and per-member task lines are dispatch-time additions. |
| `.conductor/roles/*.yaml` | `@maestro/config` loader/parser | Parsed into `Role`; soul/tools/skills fields are forward-compatible extensions. |
| `.conductor/teams/*.yaml` | `@maestro/config` loader/parser | Parsed into `Team`. Charter at `.conductor/teams/<name>/charter.md`. |
| Autonomy meter (equalizer glyph) | `Role.autonomy` | `"manual"` / `"auto-approve-safe"` / `"yolo"` (UI label: "Full auto"). |
| Engine pill | `Role.engine.id` | `"copilot"` default; `"acp"` for generic ACP family (gemini, etc.). |
| System preamble assembly | `adapter-copilot/src/buildArgs.ts`, `adapter-acp` session/new | Soul first, then instructions, tools, skills, task. Detail in 07. |

---

## Open Questions

1. Should the Soul editor warn when the soul exceeds 25 lines, or is the guidance non-enforced? A soft character-count indicator (amber at 1500, red at 2500) is a candidate.
2. The `"yolo"` autonomy value in the type was chosen for internal expressiveness. If the YAML config surfaces this string directly, operators reading config files will see it. Consider whether the YAML uses `full-auto` and the code maps it, or whether `yolo` stays throughout.
3. Team charter red-line union: when two members have conflicting red lines (agent A says "never push to main"; agent B has no such line), does the charter inherit A's constraint for all members, or only for A? Current intent: charter red lines apply to all members; each agent's own red lines apply only to itself. Needs explicit spec in 07.
4. The discover tab (05) will surface community-published souls and roles. A "fork to local" action on a discovered card should deep-copy soul.md into `.conductor/souls/`, not reference a remote URL, to keep the workspace self-contained. Confirm this is the intended adoption model.
5. The Tools section models MCP servers as a grouped sub-list, but the actual set of connected MCP servers is a VS Code workspace concern, not a per-role concern. The editor needs a mechanism to enumerate available servers at open time. Consider a `maestro.mcpServers` workspace setting or delegating to the VS Code MCP extension manifest.
