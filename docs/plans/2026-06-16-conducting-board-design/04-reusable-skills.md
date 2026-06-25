# Reusable Skills

_Author a skill once in the library, attach it by name to any agent or whole team, edits propagate automatically, missing tool grants surface loudly, and Soul red lines always outrank it._

> Part of the [Conducting Board design reference](./README.md). Visual tokens are defined in [01-overview-and-visual-language.md](./01-overview-and-visual-language.md).

---

## Overview

Skills are named, reusable procedure bodies that can be shared across agents and teams without duplication. The thesis: every skill lives in one place, every attachment is a reference to that place, and every side-effect (grant requirements, blast radius, adoption provenance) is visible before the user commits to a change.

This section covers the full model, the four drawn UX surfaces that implement it, and the minimal data-model delta required to build it on top of the existing `@maestro/core` and `@maestro/config` packages.

---

## The Model

### Storage and composition

A skill is a file at `.conductor/skills/<name>/SKILL.md`. This path mirrors Claude Code's own `.claude/skills/<name>/SKILL.md` convention: a YAML frontmatter block carrying `name`, `description`, and an optional `allowed-tools` list, followed by a freeform markdown body that is the procedure.

A `Role` in `.conductor/config.yaml` carries a `skills` array of skill names, never embedded procedure bodies. A `Team` charter may carry its own `skills` array. At spawn time, the composer resolves each name to its file, then inlines the resolved bodies into the system preamble in the fixed order: Soul, Instructions, Tools, Skills, Task. Skills arrive after Tools because the procedure may reference tool capabilities by name, and it arrives before Task so the agent reads the procedure as standing context rather than a one-shot instruction.

This mirrors the reference-by-name pattern the `@maestro/config` validator already uses for `Team.roles`: an unknown name is a warning, not a crash, which gives the validator graceful degradation when a skill file is missing from the worktree.

Cross-link: [07-data-model-and-build-plan.md](./07-data-model-and-build-plan.md) covers the full TypeScript types and config-validator delta.

### Data-model delta

The change to existing types is additive and back-compatible:

- `Role` gains `skills?: string[]`. Absent means no change to spawn behavior.
- `Team` gains `skills?: string[]`. At spawn, team-level skills are unioned onto each member's resolved list, de-duplicated by name. This is a thin convenience: the team charter is the natural place to declare skills that every member of the team should carry.
- A new `SkillManifest` type carries: `name: string`, `description: string`, `allowedTools?: string[]`, `provenance?: { sourceFile: string; sourceSha: string }`.

The loader builds these manifests by reading each `.conductor/skills/*/SKILL.md` file at activation time and caching the result in memory. No database. No version graph.

### Precedence rule

Soul red lines outrank skill steps, which outrank task instructions. A skill is a reusable procedure, not an identity. An agent whose Soul instructs it never to delete files will refuse a skill step that asks for deletion, and the skill attachment cannot override that. This is not configurable; it is structural.

### Write-grant seam (never silent)

A `SKILL.md` may declare `allowed-tools` in its frontmatter. This declaration is a requirements statement, not an automatic grant. At the moment a skill is attached to an agent, the composer diffs the skill's declared requirements against the agent's existing tool grants. If the skill needs a tool the agent does not have, particularly Write access which is off by default in the base Role, the UI surfaces this conflict loudly and waits for an explicit resolution before completing the attach. Attaching a skill is not a back door to write access.

The three resolution options are: grant the required tool to the agent (the agent's Tools grid updates), attach without granting (the chip is flagged amber until resolved), or cancel. These map directly to the inline-expansion row in the Add-skill picker, described below.

### Used-by index (blast radius)

The loader builds a reverse index from skill name to the list of Role names that reference it. This index is shown as "used by N agents" everywhere the skill appears: on the library card, in the skill editor, and on the picker row. Its purpose is to make the blast radius of an edit visible before the edit happens.

Editing a skill is allowed and is the whole point: it propagates to all referencing agents on the next spawn. Before a delete or a rename that would break references, the UI shows a confirmation modal that states the count and the dependent Role names in plain body text. It does not silently rewrite dependents.

### Adopt-from-Discover

A skill discovered in the project repo (at `.claude/skills/*/SKILL.md`) or inside a Copilot plugin is not used as a live link. It is copied once into `.conductor/skills/` with a `provenance` block that records the source file path and the SHA of the file at the moment of adoption. From that point on, it is a local library skill referenced by name like any other.

If the recorded provenance SHA differs from the current content of the upstream file at its original path, a passive "differs from source" badge appears on the library card with a one-click re-adopt action. Re-adopting updates the local copy and records the new SHA. There is no version graph and no automatic sync; this is an explicit, visible choice.

Cross-link: [05-discover-and-adopt.md](./05-discover-and-adopt.md) covers the Discover tab and the adoption flow in detail.

### Team-level skills

A Team charter may declare skills that union onto every member at spawn. De-duplication is by name: if a Role already declares `run-tests` and the Team also declares `run-tests`, the agent receives one copy of the procedure. The team-skills shortcut is a convenience for teams where every agent should share a standard operating procedure, such as "always run the test suite before declaring done."

---

## Skills Library Tab

### Purpose

Present every authored and adopted skill as a scannable grid, reveal blast radius and tool requirements at a glance, and provide a single entry point for creating new skills.

### Layout and components

The Library section header tabs read: `Agents | Teams | Skills | Discover`. The Skills tab renders a two-column grid below a header row.

Header row: `◆ Skills` on the left in #e8e8e8, Manrope medium. A `+ New skill` outline pill on the right, #3a3a3a border, #a0a0a0 label, hover shifts border to #4a9eff.

Each card is #242424 background, 6px border-radius, 1px #3a3a3a border. On hover, the border lifts to #4a9eff at 60% opacity. Cards do not have a shadow at rest; the border change is the entire hover affordance, keeping the board calm.

Card anatomy (top to bottom):

1. Top row: `◆ <name>` on the left in #e8e8e8, Manrope medium. A source badge on the right: `Authored here` in #6a6a6a, or `From plugin · sec-kit` with a ⧉ glyph in #6a6a6a for adopted skills. The ⧉ glyph signals an external origin without using color.

2. Description: up to two lines of #a0a0a0 body text, Inter regular. Truncated with an ellipsis if longer.

3. Footer row: `◆ used by N agents` on the left, and a tool requirement hint such as `needs Run · Git(write)` on the right in #5a5a5a, Inter small.

### States and interactions

**Low usage (under 3 agents):** The "used by" label is #6a6a6a. The card background stays #242424. No ambient color.

**High usage (3 or more agents):** The "used by" label switches to amber #f0a030. The card receives a faint amber wash: `background: color-mix(in srgb, #f0a030 4%, #242424)`. This is not a warning; it is a signal that this skill has meaningful blast radius and edits should be considered carefully.

**Clicking a card** opens the Skill Editor panel (described below). No inline expansion on the grid.

**`+ New skill`** opens the Skill Editor in create mode with empty fields.

### Seed examples from the prototype

| Name | Used by | Source | Needs |
|---|---|---|---|
| run-tests | 4 agents | Authored here | Run · Git(write) |
| openapi | 2 agents | Authored here | Read · Edit |
| scan | 5 agents | From plugin · sec-kit | Read · Run |
| write-changelog | 1 agent | Authored here | Read · Edit |
| review-diff | 3 agents | Authored here | Read · Git |

`scan` carries the `From plugin · sec-kit` badge and the ⧉ glyph. `run-tests` and `scan` trigger the amber high-usage treatment at 4 and 5 referencing agents respectively. `review-diff` is exactly at the threshold of 3 and also receives the amber treatment.

### Visual treatment

No icons other than ◆ and ⧉. No avatars. No status dots. The grid is deliberately quiet: information density comes from the footer row, not from visual decoration. The #242424 card sits 2dp above the #1a1a1a page background, established by the background color difference rather than a box-shadow, which keeps the surface flat and calm.

### How this maps to the build

The grid is a webview component inside `@maestro/extension`. The data source is the `SkillManifest[]` array from the loader, which the extension passes to the webview via the existing host-to-webview protocol. The used-by count comes from the reverse index built at activation. No live file-watching is required for the initial implementation; a refresh button or re-activation is sufficient.

### Open questions

- Should the grid support drag-to-reorder for personal organization, or is alphabetical sort sufficient?
- Should adopted skills show a "differs from source" badge on the grid card, or only in the editor? Both surfaces are reasonable; the editor-only approach is less cluttered.

---

## Skill Editor

### Purpose

Provide a focused editing surface for a single skill, surfacing its identity, procedure body, declared tool requirements, and live blast radius before any save.

### Layout and components

The editor panel uses the same two-pane pattern as the Agent anatomy editor: a narrow left sub-rail for navigation, a scrollable right canvas for content.

**Left sub-rail** (approximately 160px, #1a1a1a background, 1px #3a3a3a right border):

- `Identity` section link
- `Procedure` section link
- `Required tools` section link
- A 1px #3a3a3a horizontal divider
- `Used by (N)` label, with N small green dots (#4caf50, 6px diameter) below it representing each referencing agent. The dots are non-interactive affordances showing the count visually; they do not link to agents.

**Right canvas** (scrollable, #1a1a1e background):

**Identity section:**
- `Skill name` text input, #2d2d2d background, 1px #3a3a3a border, #e8e8e8 text, Inter.
- `Description` text input, same styling, placeholder "One sentence: what does this skill do?"

**Procedure section:**
- Label `Procedure` in #a0a0a0 small caps.
- A large textarea, #1e1e1e background (one step darker than the canvas to recede), 1px #3a3a3a border, min-height approximately 240px, monospace font (Menlo/Consolas/monospace stack), #e8e8e8 text. This holds the raw markdown procedure body exactly as it will appear in the SKILL.md file below the frontmatter.
- A sub-label below the textarea in #5a5a5a: `Markdown. Rendered as-is into the system preamble at spawn.`

**Required tools section:**
- Label `Required tools` in #a0a0a0 small caps, followed by the note: `Declared requirements, not grants. Each agent grants these itself.`
- A two-column permission grid. Row per tool (Read, Edit, Run, Git, Browser). Columns: `Read` (green check #4caf50 if declared, gray dash #5a5a5a if not) and `Write` (same, but the `Write` column header carries a small lock glyph in #6a6a6a). The lock is a visual reminder that write grants are not automatic and require explicit confirmation at attach time.
- Checkboxes are directly editable: toggling a Write checkbox updates `allowed-tools` in the frontmatter when saved.

**Used by section:**
- A label `Used by` in #a0a0a0.
- An inline amber caution immediately right of the count when N is 3 or more: `⚠ editing updates all N agents` in #f0a030, Inter small. Below the N threshold this line is absent.
- Agent chips, one per referencing Role. Each chip is #2d2d2d, 4px radius, format: `<Role name> · <engine>`, for example `Tester · copilot`, `Implementer · copilot`, `Reviewer · claude-sonnet-4.5`, `Security · copilot`. The engine tag is in #6a6a6a; the role name is in #a0a0a0. Chips are non-interactive in this surface; they are read-only blast-radius indicators.

### States and interactions

**Create mode:** Skill name and description are empty. Procedure textarea shows a placeholder: `# Run tests\n1. Run the full test suite...\n`. Required tools grid starts with all dashes. Used by shows zero dots and no amber caution. The sticky footer shows only `Save` (blue #4a9eff, disabled until name is non-empty).

**Edit mode (existing skill):** All fields pre-populated. The amber caution appears if the skill is used by 3 or more agents. Saving in this state immediately propagates: the next spawn of any referencing agent will use the updated procedure.

**Delete:** A red ghost button `Delete skill` sits in the sticky footer on the left, opposite the blue `Save` button on the right. Ghost styling: transparent background, 1px #e05050 border, #e05050 label. Clicking opens a confirmation modal (centered, #242424, 6px radius, deep rgba shadow).

The confirmation modal body reads: "Delete `<name>`? This skill is referenced by N agents: <comma-separated Role names>. Those agents will lose this skill on next spawn. This cannot be undone." Two buttons: `Cancel` (#a0a0a0 text, no border) and `Delete` (solid #e05050 background, #e8e8e8 text). The plain-body statement of count and names is intentional: the user should read the consequences, not just click through a count.

**Rename (via the name input):** Changing the name field and saving does not silently rewrite referencing Role config files. Instead, the save triggers an inline warning below the name input: "Renaming will break N references in .conductor/config.yaml. Update those references manually or cancel." The save is not blocked, but the warning is prominent.

### Visual treatment

The procedure textarea uses a slightly darker background (#1e1e1e) than the canvas (#1a1a1e approximation, or the same #1a1a1a used for sidebar backgrounds). This is the standard code-editor recession pattern: the editable body feels like a code surface, not a form field. Monospace font reinforces that the content is structured text, not flowing prose.

The amber ⚠ caution in the Used by section uses the attention amber #f0a030 without any background wash: the text alone is sufficient signal in a focused editor context.

### How this maps to the build

The Skill Editor is a route or panel within the Library webview. The sticky footer uses `position: sticky; bottom: 0` inside the scrollable canvas, with a 1px #3a3a3a top border and #1a1a1a background to lift it visually from the scroll content. The editor reads from and writes to the `SkillManifest` in memory; a `saveSkill` host command writes the SKILL.md file to disk via `node:fs` in the extension host. The delete confirmation modal is an inline webview modal, not a VS Code `showWarningMessage`, because the modal needs to render the dependent agent names as styled text.

### Open questions

- Should the Procedure textarea support a split preview pane (markdown rendered on the right)? The procedure is inlined verbatim, so rendering is not strictly necessary for authoring, but it would help authors verify formatting.
- Should chips in the Used by section link to the agent anatomy editor? This adds navigation but also adds complexity in the webview router.

---

## Add-Skill Picker (from Agent Anatomy Editor)

### Purpose

Let the user attach a library skill to an agent, surface the write-grant seam inline before the attachment completes, and allow discovery of repo-level skills that have not yet been adopted.

### Layout and components

The picker opens as a centered modal approximately 480px wide, #242424 background, 6px border-radius, deep `rgba(0,0,0,0.6)` box-shadow. It overlays the agent anatomy editor without dismissing it.

**Header:** `Add skill to <Agent name>` in #e8e8e8 Manrope medium. Below it, a search input spanning the full modal width: #1e1e1e background, 1px #3a3a3a border, placeholder `Search skills...`, Inter.

**Section: IN LIBRARY**

A label `IN LIBRARY` in #5a5a5a, small caps, Inter. Below it, one row per library skill matching the search query.

Each row (36px tall, 8px vertical padding):

- Left: `◆ <name>` in #e8e8e8 Manrope, a description excerpt in #a0a0a0 Inter below it (one line, truncated).
- Right: `N agents shared` in #6a6a6a (or #f0a030 if N is 3 or more), then the tool requirement hint `needs Read · Git(write)` in #5a5a5a.

Row hover: background shifts to #2d2d2d.

**Section: DISCOVERED IN REPO**

A label `DISCOVERED IN REPO` in #5a5a5a, small caps. Below it, rows for any `.claude/skills/*/SKILL.md` files found in the project that are not yet in `.conductor/skills/`.

Each row adds a hollow badge `○ not yet in library` in #6a6a6a on the right side. On row hover, an `Adopt and attach` link appears in #4a9eff at the far right. Clicking `Adopt and attach` copies the file to `.conductor/skills/`, records provenance, and immediately attaches the skill to the agent, equivalent to a library skill attach.

### Signature interaction: write-grant conflict

When the user clicks a skill row and the skill's `allowed-tools` includes a tool the agent does not currently have (for example, `Git(write)` when the agent only has `Git(read)`), the row expands inline rather than completing the attach. The expansion:

- The row gains a 3px left border in amber #f0a030.
- The description line is replaced with amber #f0a030 text: `<skill name> needs Git(write). This agent does not have it yet.`
- Three action buttons appear below the text, left-aligned, 4px gap:
  1. `Grant Git(write) to <Agent>` with an #f0a030 outline border and #f0a030 label. Clicking this updates the agent's Tools grid in `.conductor/config.yaml`, then completes the attach. The row collapses and a success toast appears.
  2. `Attach without granting` in #a0a0a0 with no border. Clicking completes the attach but leaves a faint amber flag on the skill chip in the agent's anatomy panel until the grant is explicitly added or the skill is removed.
  3. `Cancel` in #6a6a6a with no border. Clicking collapses the row back to its default state.

Only one row can be expanded at a time. Clicking a different row collapses any open expansion.

### States and interactions

**Empty search:** All library skills listed, all discovered-repo skills listed below.

**Active search query:** Both sections filter to matching skills. If a section produces no matches, its label and empty-state note `No matches` in #5a5a5a are shown rather than hiding the section entirely.

**Skill already attached:** A skill the agent already carries is shown with a gray check `✓ attached` badge on the right and the row is non-interactive (#5a5a5a label, no hover state).

**Close:** Clicking outside the modal or pressing Escape closes it. Partial state (an expanded write-grant row) is discarded.

### Visual treatment

The modal background (#242424) sits one step lighter than the #1a1a1a page background, the same elevation as agent cards. The deep shadow grounds it above the anatomy editor content. The amber expansion border uses the full attention amber #f0a030 at full opacity: this is the loudest color signal in the system, appropriate for a gate that prevents a silent privilege escalation.

### How this maps to the build

The picker is a webview modal (rendered inside the existing Stage webview or the Library webview, depending on where it is triggered). The host supplies the full `SkillManifest[]` list and the current agent's `allowedTools` set via a message on open. The grant action sends a `grantToolToAgent` host command that updates the config file via `@maestro/config`'s serializer. The adopt-and-attach action sends an `adoptSkill` host command that copies the source file, records provenance, then triggers a `saveSkill` followed by `attachSkillToAgent`. Both commands are idempotent.

### Open questions

- Should the picker support multi-select attach (checkbox per row, one `Attach selected` button) for the initial implementation, or is one-at-a-time sufficient?
- For the "Attach without granting" path, should the amber flag on the chip in the anatomy panel link directly to the write-grant conflict row in the picker, or just open the picker fresh?

---

## Reference Made Visible: Chips in Agent Anatomy and Cards

### Purpose

Make it immediately legible that a skill attachment is a shared reference, not a local copy, without requiring the user to open the picker or the library.

### Layout and components

**In the agent anatomy editor (Skills section):**

Each attached skill renders as a chip. The chip format is: `◆ <name> ⬡ · N`

- `◆` is the skill sigil in #a0a0a0.
- `<name>` is the skill name in #e8e8e8 Manrope.
- `⬡` is the shared-reference glyph in #6a6a6a, a small hexagon (U+2B21) indicating this is a library reference not a local copy.
- `· N` is the usage count (number of agents that also hold this skill) in #6a6a6a.

The chip is #2d2d2d, 4px radius, 6px horizontal padding, 4px vertical padding. On hover, the border lifts to 1px #4a9eff. Clicking the chip opens the Skill Editor for that skill, not the agent's own anatomy.

If the skill has the "attach without granting" amber flag, the chip border is 1px #f0a030 at rest instead of #3a3a3a, and a small amber dot precedes the sigil. The tooltip on hover reads: `<skill name> needs <tools>. Grant access or remove this skill.`

**In the compact agent card anatomy row (on the Conducting Board):**

The compact row shows `◆ run-tests +2` (the primary skill name plus a count of additional skills) using the same ◆ sigil. The `+2` is in #6a6a6a. At this size there is no ⬡ glyph or usage count; the compact row is purely informational. Clicking the row opens the agent anatomy editor panel.

### States and interactions

**Zero skills attached:** The Skills section in the anatomy editor shows a dashed placeholder `◆ No skills · Add one` in #5a5a5a, with the dashed border being 1px dashed #3a3a3a. Clicking opens the Add-skill picker.

**One skill:** `◆ run-tests ⬡ · 4`. Full chip.

**Multiple skills:** Each chip on its own line in the anatomy section. The compact card row collapses to `◆ run-tests +N`.

**Drift badge:** If the loader detects that a skill's provenance SHA differs from the current upstream file, the chip gains a small `↑` glyph in #a0a0a0 after the ⬡. Tooltip: `This adopted skill differs from its source. Re-adopt in the Library to update.`

### Visual treatment

The ⬡ glyph is the key: it is the single visual signal that distinguishes a shared library reference from hypothetical future local overrides. It should be present but not loud, hence #6a6a6a rather than a more prominent color. The usage count following it gives the blast radius a second reading directly on the chip, so a user editing an agent's skills sees the impact without opening the library.

### How this maps to the build

The chip renders in the anatomy section of the Agent anatomy panel (inside the Stage webview). The data is already in the host's in-memory skill index; the extension passes `attachedSkills: SkillManifest[]` alongside the agent state in the anatomy message. Clicking a chip sends a `openSkillEditor` message to the host, which navigates the Library webview to the skill editor for that name. The compact card row in the Conducting Board lane reads the same `attachedSkills` array from the agent's state object and renders the `◆ <primary> +N` string in the card renderer.

### Open questions

- Should the `+N` in the compact card be a tooltip-trigger that lists the other skill names on hover, or is that too much hover complexity for the board surface?
- Should clicking the ⬡ glyph specifically (rather than the whole chip) open the Library skills grid, while clicking the name part opens the editor? This two-target chip pattern could feel precious at this size.

---

## Why This Feature is Low-Cost to Build

The skill library is the highest-leverage UX addition in terms of build effort relative to user impact. The data-model change is two optional fields (`skills?: string[]` on `Role` and `Team`), one new type (`SkillManifest`), one new directory (`.conductor/skills/`), and one new file-loader function. The `@maestro/config` validator already has the reference-by-name pattern for `Team.roles`; `skills` reuses the same resolution logic.

The library UI is the larger lift, but it is scoped to the Library webview and does not touch the Conducting Board lane renderer, the Orchestrator state machine, the CopilotAdapter, the ACP adapter, or the merge pipeline. The write-grant seam reuses the existing Tools grid in the anatomy editor; the picker is a new modal but its host commands (`grantToolToAgent`, `adoptSkill`, `attachSkillToAgent`) are thin wrappers over the config serializer already in `@maestro/config`.

The full-gate test count should grow by roughly 15 to 25 tests: loader unit tests (name resolution, reverse index, provenance diff), config validator tests (skills field presence and unknown-name warning), picker host command tests, and at least one anatomy-panel integration test for the chip render with ⬡ and amber flag.

Cross-link: [07-data-model-and-build-plan.md](./07-data-model-and-build-plan.md) tracks the exact types, validator changes, and test plan.
