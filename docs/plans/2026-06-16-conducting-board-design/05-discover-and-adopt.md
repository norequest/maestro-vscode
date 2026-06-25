# Discover and Adopt

*How Maestro finds ready-made agents and skills that already live in the repo or in installed Copilot plugins, and lets you adopt them into your library rather than authoring from scratch.*

> Part of the [Conducting Board design reference](./README.md). Visual tokens are defined in [01-overview-and-visual-language.md](./01-overview-and-visual-language.md).

---

## Why discovery exists

Every non-trivial repo already accumulates agent and skill definitions: a `.claude/agents/` folder from a past Claude session, Copilot chatmodes committed to `.github/`, a Copilot plugin the team installed last sprint with a bundled security scanner. Without discovery, the user re-invents those agents inside Maestro, creating drift and ignoring existing conventions.

Discovery inverts the creation flow. Instead of "open a blank role editor and author an agent", the primary path becomes "scan, find what exists, review it, and adopt." Adoption is a one-step gesture: the role editor opens pre-filled, a provenance record is written, and the role lands in your library ready to dispatch. Creation from scratch remains available for net-new roles, but it is no longer the default starting point.

The design principle: Maestro is a conductor, not a content management system. It reads the score that already exists before it asks you to compose a new one.

---

## Source taxonomy and confidence tiers

The scanner classifies every discovered item into one of three confidence tiers. Tier determines how the card is badged and what actions are offered.

### HIGH confidence: treat as real agents

These sources contain explicit frontmatter declaring the agent's identity. Maestro can extract name, description, tools list, model, and the body prompt reliably.

| Path pattern | Convention |
|---|---|
| `.claude/agents/*.md` | Claude agent format. Frontmatter keys: `name`, `description`, `tools`, `model`. Body is the system prompt. |
| `.conductor/roles/*.yaml` | Maestro-native. Already a valid role; adopt is instant (provenance only, no transformation). |
| `.github/agents/*.agent.md` | Copilot agent format. Copilot and VS Code renamed "chatmode" to "agent" around v1.106; scan both paths. |
| `.github/chatmodes/*.chatmode.md` | Legacy Copilot chatmode format. Same frontmatter structure; treat identically to `.agent.md`. |

### MEDIUM confidence: likely agents or plan-mode prompts

These files follow recognizable patterns but may be plan-mode prompts or skill wrappers rather than standalone agents. The card is badged `◑ likely agent`. The user must confirm intent before adopting.

| Path pattern | Notes |
|---|---|
| `**/*.prompt.md` | May be a single-turn prompt or an agentic workflow. Check for `tools` or `mode: agent` in frontmatter. |
| `.claude/skills/*/SKILL.md` | Claude skill format. Adopt as a skill (see section 7 and cross-link to [04-reusable-skills.md](./04-reusable-skills.md)), not a role. |
| `.continue/agents/*.yaml` | Continue.dev agent format. YAML body maps cleanly to Maestro role fields. |
| `.cursor/rules/*.mdc` | Cursor rule format. Often scoped to a file glob; treat as instructions-only unless `alwaysApply: true`. |

### LOW confidence: instructions only, not standalone agents

These are workspace-level instruction files that provide guidance to an AI session but are not themselves agents. They appear in the Discover results under a collapsed "Workspace instructions" section with the badge `○ instructions only`. Maestro does not offer Adopt for these; it offers "Browse" so the user can read them and decide whether to copy relevant passages into a new role manually.

| File | Owner |
|---|---|
| `AGENTS.md` | Codex / generic |
| `CLAUDE.md` | Claude / Maestro |
| `GEMINI.md` | Gemini CLI |
| `.github/copilot-instructions.md` | Copilot workspace |

### MCP configs: the tools and skills inventory

MCP configuration files are not agent definitions but they are the authoritative inventory of available tools and skills. The scanner reads them to build the skill-chip list shown on every agent card and to warn on adopt if a required MCP server is not available.

| File | Key to read |
|---|---|
| `.mcp.json` | `mcpServers` |
| `.vscode/mcp.json` | `servers` |

The scanner does not start any MCP server. It reads the config for names and descriptions only.

---

## Copilot plugin discovery

The copilot CLI (verified locally at v1.0.62) registers two marketplaces: `copilot-plugins` and `awesome-copilot`. Installed plugins live at:

```
~/.copilot/installed-plugins/{marketplace}/{plugin}/
```

Each plugin directory contains a `plugin.json` at `.github/plugin/plugin.json` (relative to the plugin root) that bundles three kinds of assets:

- **agents**: markdown or `.agent.md` files with frontmatter, one per agent the plugin provides.
- **skills**: `SKILL.md` directories following the same layout as `.claude/skills/`.
- **mcpServers**: an inline MCP server manifest, keyed the same way as `.mcp.json`.

There is no `copilot plugin list --json` command (confirmed: only `copilot mcp list --json` works). Discovery is therefore a **filesystem scan**, not an API call. The scanner walks `~/.copilot/installed-plugins/` and reads each `plugin.json` it finds.

A plugin agent is invoked by Maestro as:

```
copilot --agent <stem> -p "<prompt>"
```

where `<stem>` is the filename without extension. This is the same invocation the adapter-copilot package already uses for its `--agent` flag path.

Plugin agents appear in the Discover screen grouped under "Copilot plugins", distinct from the "In this repo" group. The source badge for a plugin agent reads `Plugin · <plugin-name>` with a ⧉ glyph marking the external/installed origin.

---

## Mapping a foreign agent to a Maestro Role on adopt

When the user clicks Adopt, the scanner's raw data is transformed into a `Role` object before the editor opens. The mapping rules:

**Instructions.** The file body (everything after the frontmatter block) becomes the role's `instructions` field. If the source has no body and only frontmatter, the `description` value is used as a minimal instructions string and a warning is shown in the editor.

**Engine.** Maestro's `KNOWN_ENGINE_IDS` allowlist permits only two engine families: `copilot` and `acp`. The mapping is:

| Source model / engine hint | Mapped to |
|---|---|
| `model: copilot*` or no model field in a `.github/` agent | `copilot` |
| `model: claude*`, `model: gemini*`, any other non-Copilot value | `acp` |
| `.continue/agents/` or `.cursor/rules/` | `acp` |
| Copilot plugin agent | `copilot` |
| `.conductor/roles/*.yaml` | as declared (already valid) |

The engine field in the pre-filled editor shows the inferred value with an info annotation explaining the mapping. The user can change it before saving.

See [03-agents-teams-and-anatomy.md](./03-agents-teams-and-anatomy.md) for the full role editor and [07-data-model-and-build-plan.md](./07-data-model-and-build-plan.md) for the allowlist implementation.

**Autonomy.** Autonomy is inferred from the source's permission mode, then clamped DOWN one notch as a safety default:

| Source signal | Inferred autonomy | Clamped to |
|---|---|---|
| `permission_mode: bypassPermissions` or equivalent | `autonomous` | `supervised` |
| `permission_mode: acceptEdits` or tool list includes write tools | `supervised` | `manual` |
| No permission field, read tools only | `manual` | `manual` (no clamp needed) |

This clamp is intentional and non-negotiable: a discovered agent's claimed permissions are not verified in context. The user can raise autonomy manually after reviewing.

---

## The Discover screen

Discover is the fourth tab of the Library panel: **Agents | Teams | Skills | Discover**. It is a full-height scrollable surface. The Library panel itself is described in [02-layout-and-navigation.md](./02-layout-and-navigation.md).

### Purpose

Surface everything discoverable in one place, grouped by source, filtered by the user, and actionable in one click.

### Layout and components

**Sticky header** (background #1a1a1a, border-bottom #3a3a3a):

- Left: "Discovered" heading in Manrope 13 px semibold #e8e8e8.
- Right: "Scan repo" button. On first load the scan runs automatically. On subsequent loads it uses a cached result; the button re-runs the scan. While scanning, a progress indicator (animated #4a9eff dot) replaces the button label.
- Below the heading: source filter chips (all / In this repo / Copilot plugins / Marketplace soon) in Inter 11 px. Active chip: background #2d2d2d, text #e8e8e8, border #3a3a3a. Inactive: text #6a6a6a, no border. "Marketplace (soon)" chip is dimmed and non-interactive (#5a5a5a text).
- Below chips: free-text filter input. Placeholder "Filter by name, skill, or source" in #6a6a6a. Searches name, description, and skill chip labels.

**Results area**: grouped into collapsible sections separated by a thin rule (#3a3a3a).

Section headers are sticky within scroll (background #1a1a1a, Manrope 11 px semibold, uppercase, #a0a0a0). They show the source group name and a count badge.

Sections:

1. **In this repo** (HIGH and MEDIUM confidence items found in the current workspace).
2. **Copilot plugins** (items from `~/.copilot/installed-plugins/`).
3. **Workspace instructions** (LOW confidence, collapsed by default, expand chevron).
4. **Marketplace (soon)** (placeholder section, one card with lock icon and "Coming soon" in #6a6a6a).

**Empty state**: if no items are found in a section, show "Nothing found here" in #6a6a6a Inter 12 px, centered.

### Discovered agent card

Background #242424, border #3a3a3a, radius 6 px, padding 12 px. On hover: border #4a9eff at 50 % opacity.

Card anatomy (top to bottom):

- **Row 1**: name (Manrope 13 px semibold #e8e8e8) · source badge · engine chip.
  - Source badge examples: `.claude/agents` with a `◆` glyph (skill / agent convention marker) for repo agents; `Plugin · sec-kit` with a `⧉` glyph for plugin agents. Badge background #2d2d2d, border #3a3a3a, text #a0a0a0, Inter 10 px.
  - Engine chip: same chip style as the role editor. `copilot` in #4a9eff; `acp` in #a0a0a0.
- **Row 2**: confidence trio.
  - `✓ verified in repo` (shown only for HIGH confidence): tick in #4caf50, label #a0a0a0 Inter 11 px.
  - `◑ likely agent` (MEDIUM confidence): glyph #f0a030, label #a0a0a0.
  - `○ instructions only` (LOW confidence): glyph #6a6a6a, label #6a6a6a.
  - Green (#4caf50) is used ONLY for the verified tick. Amber (#f0a030) is used for "likely agent". No other status color appears in the confidence row.
- **Row 3**: description, Inter 12 px #a0a0a0, max 2 lines, truncated with ellipsis.
- **Row 4**: skill chips (tools or MCP server names extracted from frontmatter). Up to 4 chips shown; overflow collapsed to `+N more`. Chip style: background #2d2d2d, border #3a3a3a, text #6a6a6a, `◆` prefix for skill-type chips, `⧉` for external MCP tools.
- **Row 5**: action row, right-aligned.
  - **Browse**: text button #a0a0a0, opens the Browse drawer.
  - **Dispatch**: text button #a0a0a0, available for HIGH confidence items only. Opens the Dispatch modal (pre-filled with this agent) without adopting to library. Cross-link: [06-dispatch-and-execution.md](./06-dispatch-and-execution.md).
  - **Adopt**: filled button background #4a9eff, text #1a1a1a, Manrope 12 px medium. Primary action.

### Browse drawer

Opens as a right-side panel overlay (width 420 px, background #1a1a1a, left border #3a3a3a, z-index above the Conducting Board canvas). Three tabs: **Instructions | Skills | Source**.

- **Instructions tab**: the agent body rendered as plain text in Inter 12 px #a0a0a0, scrollable.
- **Skills tab**: list of skills and MCP tools the agent declared, each with name and description if available.
- **Source tab**: the raw file content in a monospace block (Inter Mono 11 px #a0a0a0, background #242424). An "Open file" action (link style #4a9eff) opens the source in the VS Code editor.

Close: `✕` button top-right, or click outside the drawer. No keyboard trap.

### States and interactions

**Loading**: on scan start, each section header shows a pulsing skeleton bar in place of its count. Cards animate in as the scanner emits results (streaming appearance, not batch).

**Filter active**: non-matching cards fade to opacity 0.35 and lose interactivity. Matching cards remain full opacity. Section headers update their counts to reflect the filtered set.

**Zero results after filter**: show "No matches. Try a broader filter." inline below the chips.

**Scan error** (file system permission denied, etc.): amber (#f0a030) inline banner below the sticky header. "Scan incomplete: some paths could not be read." with a Details link that lists the skipped paths.

---

## The adopt flow

1. User clicks **Adopt** on a card.
2. The role editor opens ([03-agents-teams-and-anatomy.md](./03-agents-teams-and-anatomy.md)) pre-filled with:
   - `name`: from frontmatter or filename stem.
   - `description`: from frontmatter description field.
   - `instructions`: the file body.
   - `engine`: mapped per the table in the mapping section above.
   - `autonomy`: clamped value per the safety rules above.
   - `skills`: chips pre-populated from the source's `tools` or MCP server declarations, but marked `unverified` until the user saves.
3. A provenance banner appears below the editor title (background #2d2d2d, border #f0a030 left 3 px, text #a0a0a0 Inter 11 px):
   > Adopted from `.claude/agents/security-reviewer.md` · sha `a3f8c1d` · 2026-06-16
   - The `source path` and `upstream sha` (HEAD sha of the workspace at scan time) are stored in the saved role's metadata and written into the `.conductor/roles/*.yaml` file as a `provenance` block.
4. The user reviews, optionally edits fields, and clicks **Save role**.
5. A confirmation toast appears bottom-right (background #242424, border #4caf50 left 3 px, text #e8e8e8 Inter 12 px): "security-reviewer added to library". Auto-dismisses after 4 seconds.

**Safety clamps that cannot be overridden at adopt time** (they can be changed manually after save):

- Adopting NEVER silently grants write permissions or enables an MCP server that is not listed in the current workspace's MCP config. If the source declares `write_files` tool and no write-capable MCP server is configured, the skill chip is shown in red (#e05050) with a warning: "Tool not available. Configure MCP server or remove."
- Autonomy is always clamped DOWN one tier from the source's declared value, as described above. The editor shows the clamped value with an info annotation: "Autonomy lowered one tier from source. Raise only after review."

**Discovered skills** follow the same adopt-to-library path described in [04-reusable-skills.md](./04-reusable-skills.md): copy the SKILL.md content once into `.conductor/skills/<name>/`, write a provenance block, then reference the skill by name in any role. The skill card in Discover uses the same Browse / Adopt actions. "Adopt" for a skill opens the skill editor (not the role editor).

---

## Visual treatment

The Discover screen uses the same dark background (#1a1a1a canvas, #242424 cards, #2d2d2d interactive states) as the rest of the Conducting Board. The only surface-specific color note: the confidence trio is the one place where three different status colors appear together. Green (#4caf50) is strictly reserved for the verified tick. Amber (#f0a030) marks "likely agent" uncertainty. Grey (#6a6a6a) marks instructions-only. Red (#e05050) appears only in error states (unavailable tool warning, scan error banner). Blue (#4a9eff) appears only on the Adopt button and the "Open file" link.

Source badges and engine chips use the same token set as the role editor chips defined in 03, so the visual vocabulary stays consistent across Library, Discover, and the Conducting Board canvas.

The Browse drawer slides in from the right with a 160 ms ease-out translate. The backdrop does not dim (the drawer is additive, not modal). The role editor that opens on Adopt is the same editor pane described in 03; it replaces the Discover tab content so the user sees the pre-filled form in context.

---

## How this maps to the build

**What is prototype-only today**: the Discover screen exists in the Claude Design prototype as a simulated tab. No scanner code runs. The card data is static fixture JSON. The adopt flow pre-fills the role editor via prototype-level state; no `.conductor/roles/*.yaml` file is written.

**Where the real implementation goes**:

The `.conductor/` config package (`@maestro/config`, introduced in M8) already contains a loader and scaffolder for `.conductor/roles/*.yaml`. The discovery scanner is the natural extension of that package: a new `discoverWorkspace(root: string)` export that walks the paths defined in the source taxonomy above and returns a typed `DiscoveredItem[]` array. The scanner must be read-only (no execution, no MCP server startup, no `git` commands beyond reading HEAD sha for provenance). It runs inside the extension host process, not in a worker.

The cockpit (`@maestro/cockpit`) receives discovered items via a new `DISCOVER_RESULTS` message in the host-to-webview protocol. The Discover tab renders from that message. The `ADOPT_AGENT` webview-to-host message carries the mapped role payload; the host writes it to `.conductor/roles/<name>.yaml` and sends back a `ROLE_SAVED` confirmation.

The MCP config scanner (reading `.mcp.json` and `.vscode/mcp.json`) can reuse the extension's existing workspace file-access APIs. No new permissions are needed beyond what M4 already declared in `package.json` (`workspaceContaining`).

Plugin discovery (`~/.copilot/installed-plugins/`) requires access to the user's home directory. This is a standard VS Code extension capability but should be gated behind a user setting (`maestro.discoverPlugins: true`, default false on first install) to avoid surprising users with home-dir reads.

See [07-data-model-and-build-plan.md](./07-data-model-and-build-plan.md) for the full data model, the KNOWN_ENGINE_IDS allowlist, and the sprint breakdown that includes the discovery scanner as a discrete build unit.

---

## Open questions

1. **Scan scope**: should the scanner walk the entire workspace tree for `*.prompt.md` (MEDIUM tier) or limit to a configurable set of directories? A full walk on a large monorepo could be slow; a default allowlist (`.github/`, `.claude/`, `.conductor/`, `.continue/`, `.cursor/`) may be safer.

2. **Plugin opt-in UX**: the `maestro.discoverPlugins` setting is a reasonable gate, but should the first Discover scan prompt the user interactively ("Maestro found Copilot plugins. Include them in discovery?") rather than defaulting to a silent skip?

3. **Provenance staleness**: when the user next opens the Discover tab, should Maestro compare the stored `upstream sha` against the current HEAD and surface a "Source has changed" warning on adopted roles? This is valuable but adds a git-read on activation.

4. **Dispatch without adopt**: the Dispatch action on a discovered card runs the agent once without saving it to the library. Should the dispatch record (in the JSONL persistence log, M7) include the raw source path instead of a role ID? The data model in 07 should take a position.

5. **Conflict on adopt**: if a role with the same name already exists in `.conductor/roles/`, should Maestro silently version it (`security-reviewer-2.yaml`), prompt the user, or open a diff view? The M9 merge-robustness patterns are a useful reference here.

6. **Skill deduplication**: if a discovered plugin bundles a skill that already exists in `.conductor/skills/`, the adopt flow should detect the collision and ask the user whether to overwrite, rename, or skip. The 04-reusable-skills.md spec should own this rule; flag it for alignment.
