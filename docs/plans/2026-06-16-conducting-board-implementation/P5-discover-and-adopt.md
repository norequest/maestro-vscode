# Maestro P5: Discover and Adopt Implementation Plan

> For agentic workers: REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Execute each task as red -> green -> commit, one subagent per task, with the verification gate green before moving on.

> Part of the [roadmap](./README.md). UX spec: [05](../2026-06-16-conducting-board-design/05-discover-and-adopt.md).

---

## Goal

Make discovery the default entry point for putting an agent in your library. Instead of authoring a role from a blank editor, the user scans what already lives in the repo (a past `.claude/agents/` folder, committed Copilot chatmodes, Continue or Cursor configs) and in installed Copilot plugins, reviews each find with an honest confidence badge, and adopts it in one gesture. Adoption maps the foreign definition to a Maestro `Role`, opens the P4 anatomy editor pre-filled with a provenance line, applies a safety-first autonomy clamp, and persists through the M8 config serializer. The scanner is pure, read-only, and fs-injectable: no process is spawned, no MCP server is started, no `git` runs beyond reading HEAD for provenance.

This phase delivers four real capabilities, not a facade:

1. A pure scanner (`@maestro/config/discover`) that walks the source taxonomy from design 05 and the Copilot installed-plugins tree, returning typed `DiscoveredItem[]`.
2. A confidence classifier (HIGH verified-in-repo · MEDIUM likely-agent · LOW instructions-only) that gates which actions a card offers.
3. A foreign-to-`Role` mapper that enforces `KNOWN_ENGINE_IDS`, clamps autonomy down a notch, and never silently grants write or an unconfigured MCP server.
4. The Library Discover tab (seam R4), the Browse drawer, and the adopt flow wired through the protocol to the scanner and the config serializer (seam R6).

This depends on P3 (the `.conductor/skills/` store and skills library) and P4 (the anatomy editor that adopt pre-fills, plus `Role.tools` and `Role.soul`). Where this plan reads or writes `Role.skills`, `Role.tools`, or `Role.soul`, it treats them as already present from P3/P4.

---

## Architecture

```
packages/config/
  src/
    discover/
      types.ts        DiscoveredItem, Confidence, SourceKind, McpInventory, AdoptDraft
      sources.ts      per-source parsers: frontmatter + body -> raw discovered fields
      classifier.ts   raw source kind -> Confidence tier (verified / likely / instructions)
      mapper.ts       DiscoveredItem -> AdoptDraft (engine allowlist, autonomy clamp, no silent write)
      mcp.ts          read .mcp.json / .vscode/mcp.json -> McpInventory (names only)
      plugins.ts      walk ~/.copilot/installed-plugins -> plugin agents + skills + mcpServers
      scanner.ts      discoverWorkspace(root, fs) + discoverPlugins(home, fs) orchestration
      index.ts        public re-exports

  test/
    discover/
      fixtures/       one tree per source kind (.claude, .github, .continue, .cursor, plugins, mcp)
      sources.test.ts
      classifier.test.ts
      mapper.test.ts
      mcp.test.ts
      plugins.test.ts
      scanner.test.ts

packages/cockpit/src/
  protocol.ts         (+ DISCOVER_RESULTS host message, + scan/adopt/browse webview messages, isWebviewMessage updated, exhaustive switch extended)
  discover-view.ts    pure presenter: DiscoveredItem[] -> grouped, filtered DiscoverVM
  test/discover-view.test.ts

packages/extension/src/
  discover-controller.ts   wires scanner + config serializer to the cockpit (vscode-free, fake-injectable)
  test/discover-controller.test.ts
  extension.ts             (+ activate() delta: register Discover tab, plugin opt-in setting)
```

### Why the scanner lives in `@maestro/config`

The config package already owns the `.conductor/` read/write surface, the injectable `FsReader` (`readFile` / `listFiles` / `exists`), the `KNOWN_ENGINE_IDS` allowlist, the validator, and the serializer. Discovery is the natural extension of that I/O layer: scan foreign formats, classify, map to the same `Role` type the validator already produces, then serialize through the existing `serializeRole`. The scanner imports nothing from VS Code and is fully testable with a fake `FsReader`, exactly like `loadConductorDir`. A new `FsScanner` interface extends `FsReader` with `listDirs` and a `readDir` that distinguishes symlinks, so the scanner can walk trees while still refusing symlink escapes (seam R6).

### Read-only and pure

The scanner never executes a discovered agent, never starts an MCP server, never invokes `copilot`. Its only side effect beyond reads is an optional single `git rev-parse HEAD` to stamp provenance, and that runs in the extension layer (injected as a `() => Promise<string | undefined>`), not inside the pure scanner. `discoverWorkspace` returns data; the extension decides what to do with it.

### Engine mapping under the hard allowlist

The current validator REJECTS any `engine.id` outside `KNOWN_ENGINE_IDS` (`copilot`, `acp`) as an error, not a warning (argument-injection / unknown-adapter defense). The mapper therefore must collapse every foreign engine hint into exactly `copilot` or `acp` before the draft ever reaches `validateRole`. A foreign agent that names, say, `gpt-4o` maps to `copilot`; a `claude*` or `gemini*` hint maps to `acp`; anything ambiguous defaults to `acp`. The mapper never emits a third id, so adopt can never produce a role the validator would refuse.

### Name and instruction sanitization

Foreign names are untrusted. The validator already blocks names starting with a dash or containing control characters. The mapper pre-sanitizes the mapped `name` (trim, strip control chars, strip a leading dash) so a hostile `.claude/agents/-rf.md` cannot smuggle a flag-like role name, and so the pre-filled editor field is always validator-clean.

### Symlink containment in the scanner (seam R6)

The node-backed `FsReader` already realpath-checks `.conductor/` reads and skips symlinked directory entries. The scanner's node-backed `FsScanner` applies the same rule to every tree it walks: a symlinked entry (file or directory) is skipped, never followed, so discovery cannot become an arbitrary file-read primitive via a planted symlink in `.github/` or `~/.copilot/`. Unit tests assert a symlinked fixture entry is excluded from results.

---

## Scope

### IN (this phase, P5)

- `@maestro/config/discover`: `discoverWorkspace`, `discoverPlugins`, per-source parsers, classifier, mapper, MCP inventory reader, `FsScanner` interface + node-backed impl with symlink containment.
- Confidence tiers HIGH / MEDIUM / LOW per design 05, driving badges and which actions a card offers.
- Foreign-to-`Role` mapper: engine collapsed to the allowlist, autonomy clamped down one notch, write never granted, MCP servers not configured surfaced as unavailable (not granted).
- Copilot plugin scan from `~/.copilot/installed-plugins/{marketplace}/{plugin}/` reading `.github/plugin/plugin.json`; plugin agents marked with invocation stem (`copilot --agent <stem> -p`).
- Cockpit: `DISCOVER_RESULTS` host message, `scan-repo` / `scan-plugins` / `adopt-agent` / `adopt-skill` / `browse-source` webview messages, `isWebviewMessage` updated, exhaustive switches extended, a pure `discover-view` presenter (grouping, filter, confidence trio).
- The Library Discover tab (sticky header, source chips, filter, grouped results, discovered-agent cards, Browse drawer) and the adopt flow that opens the P4 editor pre-filled with a provenance line.
- Adopt writes `.conductor/roles/<name>.yaml` (and discovered skills into `.conductor/skills/<name>/` reusing P3) with a `provenance` block, through the M8 serializer.

### OUT (deferred, with owning phase)

- Live marketplace install: the "Marketplace (soon)" section is a non-interactive placeholder card only. (Future phase, not P5.)
- Executing a discovered agent beyond mapping it to a `Role`: the Dispatch action on a HIGH-confidence card pre-fills the P2 dispatch composer; running it is the P2 / dispatch surface's job, not P5's. P5 only routes the pre-filled payload.
- The rich diff / merge review surface (changed files, unified diff, decision bar): **P6**.
- Provenance staleness re-check on activation (compare stored sha vs current HEAD): noted as an open question in design 05; not built in P5.
- Same-name adopt conflict resolution as a diff view: P5 takes the simple position (prompt to overwrite or auto-suffix `-2`); a richer flow defers to the M9 merge patterns referenced in design 05.

---

## File Structure

New, under `packages/config/src/discover/` and `packages/config/test/discover/`: `types.ts`, `sources.ts`, `classifier.ts`, `mapper.ts`, `mcp.ts`, `plugins.ts`, `scanner.ts`, `index.ts`, plus a `fixtures/` tree and one test file per module. New, under `packages/cockpit/src/`: `discover-view.ts` + test. New, under `packages/extension/src/`: `discover-controller.ts` + test. Additive deltas: `packages/config/src/index.ts` (re-export `./discover/index.js`), `packages/cockpit/src/protocol.ts` (messages + guard + switch), `packages/extension/src/extension.ts` (`activate()` Discover tab wiring + `maestro.discoverPlugins` setting in `package.json` contributes).

`packages/config` keeps mirroring `packages/workspace` in its `package.json` scripts, `tsconfig.json`, `tsconfig.build.json`, and `vitest.config.ts`. The `discover/` subtree adds no new runtime dependency: `yaml` (already present) parses YAML frontmatter and `.continue` YAML; `JSON.parse` handles `.mcp.json` and `plugin.json`. Markdown frontmatter is split with a tiny hand-rolled `---` fence splitter (no `gray-matter` dep).

---

## Tasks

Each task is red -> green -> commit. Commit messages end with the `Co-Authored-By` trailer. The repo-root gate `pnpm -r typecheck && pnpm -r test && pnpm -r build` stays green at every commit.

### Task 1: Discover types and the frontmatter splitter

**Files:** `packages/config/src/discover/types.ts`, `packages/config/src/discover/sources.ts` (splitter only), `packages/config/test/discover/sources.test.ts`.

Define the data the scanner returns and the mapper consumes:

```typescript
export type Confidence = "verified" | "likely" | "instructions";

export type SourceKind =
  | "claude-agent"      // .claude/agents/*.md            HIGH
  | "conductor-role"    // .conductor/roles/*.yaml        HIGH
  | "copilot-agent"     // .github/agents/*.agent.md      HIGH
  | "copilot-chatmode"  // .github/chatmodes/*.chatmode.md HIGH
  | "prompt"            // **/*.prompt.md                 MEDIUM
  | "claude-skill"      // .claude/skills/*/SKILL.md       MEDIUM (adopts as skill)
  | "continue-agent"    // .continue/agents/*.yaml        MEDIUM
  | "cursor-rule"       // .cursor/rules/*.mdc            MEDIUM
  | "instructions"      // AGENTS.md, CLAUDE.md, GEMINI.md, copilot-instructions.md  LOW
  | "plugin-agent"      // ~/.copilot/installed-plugins/.../agents  HIGH (external)
  | "plugin-skill";     // ~/.copilot/installed-plugins/.../skills  MEDIUM (external)

export interface DiscoveredItem {
  kind: SourceKind;
  confidence: Confidence;
  name: string;
  description: string;
  /** File body after frontmatter; the prompt/instructions. */
  body: string;
  /** Tool or MCP-server names declared in frontmatter. */
  declaredTools: string[];
  /** Raw engine/model hint from the source, pre-mapping (e.g. "claude-3-5", "copilot"). */
  engineHint?: string;
  /** Source signal for the autonomy clamp (e.g. "bypassPermissions", "acceptEdits"). */
  permissionHint?: string;
  /** Repo-relative path, or plugin-relative for external items. */
  source: string;
  /** For plugin agents, the `copilot --agent <stem>` stem. */
  pluginStem?: string;
  /** For plugin items, the owning plugin name for the `Plugin · <name>` badge. */
  pluginName?: string;
  /** True only for items adopted as a skill, not a role. */
  isSkill: boolean;
}

/** Split a markdown file into (frontmatter record, body). No gray-matter dep. */
export function splitFrontmatter(text: string): { frontmatter: Record<string, unknown>; body: string };
```

- [ ] Red: `sources.test.ts` asserts `splitFrontmatter` handles (a) a `---` fenced YAML block returning a parsed record and the trailing body, (b) a file with no fence returning `{}` and the full text as body, (c) a fence with malformed YAML returning `{}` and the body after the fence (never throws). Run `pnpm --filter @maestro/config test` -> red.
- [ ] Green: implement `splitFrontmatter` (slice between the first two `---` lines, `parseYaml` the inner block in a try/catch, body is everything after). Implement the `discover/types.ts` types. Run -> green.
- [ ] Commit: `feat(config): discover types and frontmatter splitter`

### Task 2: Per-source parsers with one fixture per source kind

**Files:** `packages/config/src/discover/sources.ts`, `packages/config/test/discover/fixtures/**`, `packages/config/test/discover/sources.test.ts`.

Each parser takes `(text, source)` and returns a partial `DiscoveredItem` (name, description, body, declaredTools, engineHint, permissionHint). Frontmatter keys per design 05: Claude agents use `name` / `description` / `tools` / `model`; Copilot agents and chatmodes use the same frontmatter shape (and a missing model means a Copilot engine); `.prompt.md` checks for `tools` or `mode: agent`; `.continue/agents/*.yaml` maps YAML fields directly; `.cursor/rules/*.mdc` reads `alwaysApply` and a `globs` field. Name falls back to the filename stem when frontmatter omits it.

Create a `fixtures/` tree with one realistic file per source kind: `fixtures/repo/.claude/agents/security-reviewer.md`, `fixtures/repo/.conductor/roles/implementer.yaml`, `fixtures/repo/.github/agents/planner.agent.md`, `fixtures/repo/.github/chatmodes/legacy.chatmode.md`, `fixtures/repo/foo.prompt.md`, `fixtures/repo/.claude/skills/lint/SKILL.md`, `fixtures/repo/.continue/agents/helper.yaml`, `fixtures/repo/.cursor/rules/style.mdc`, `fixtures/repo/CLAUDE.md`.

- [ ] Red: `sources.test.ts` reads each fixture file and asserts the matching parser extracts the expected `name`, `description`, and an `engineHint` consistent with design 05's mapping table (Claude agent -> `claude*` hint, `.github/` agent with no model -> a copilot hint, Continue/Cursor -> an acp hint). Run -> red.
- [ ] Green: implement one parser per source kind in `sources.ts`. Run -> green.
- [ ] Commit: `feat(config): per-source discovered-agent parsers with fixtures`

### Task 3: Confidence classifier

**Files:** `packages/config/src/discover/classifier.ts`, `packages/config/test/discover/classifier.test.ts`.

```typescript
/** Map a source kind to its confidence tier. Pure, total over SourceKind. */
export function classify(kind: SourceKind): Confidence;
```

HIGH (`verified`): `claude-agent`, `conductor-role`, `copilot-agent`, `copilot-chatmode`, `plugin-agent`. MEDIUM (`likely`): `prompt`, `claude-skill`, `continue-agent`, `cursor-rule`, `plugin-skill`. LOW (`instructions`): `instructions`. The switch is exhaustive over `SourceKind` (a `never` default), so adding a kind without classifying it is a compile error.

- [ ] Red: `classifier.test.ts` asserts each kind maps to its tier and that `verified` is returned only for the five HIGH kinds (the green tick is reserved for verified-in-repo). Run -> red.
- [ ] Green: implement the exhaustive switch. Run -> green.
- [ ] Commit: `feat(config): confidence classifier for discovered items`

### Task 4: Foreign-to-Role mapper (engine allowlist, autonomy clamp, no silent write)

**Files:** `packages/config/src/discover/mapper.ts`, `packages/config/test/discover/mapper.test.ts`.

```typescript
export interface Provenance {
  sourcePath: string;
  upstreamSha?: string;
  adoptedAt: string; // ISO date
}

export interface AdoptDraft {
  role: Role;                 // validator-clean: engine is "copilot" | "acp" only
  provenance: Provenance;
  /** Skill chips marked unverified until the user saves. */
  proposedSkills: string[];
  /** Tools the source wanted but no MCP server provides them; shown red, NOT granted. */
  unavailableTools: string[];
  /** Set when autonomy was clamped down, for the editor's info annotation. */
  autonomyClampNote?: string;
}

export function mapToRole(
  item: DiscoveredItem,
  mcp: McpInventory,
  provenance: Provenance,
): AdoptDraft;
```

Mapping rules, all enforced and tested:

- **Engine collapses to the allowlist.** `engineHint` matching `copilot*` (or a `.github/` source with no model) -> `copilot`; `claude*`, `gemini*`, any other non-copilot hint, and `.continue` / `.cursor` sources -> `acp`; plugin agent -> `copilot`; a `conductor-role` keeps its already-valid engine. The mapper NEVER emits an id outside `KNOWN_ENGINE_IDS`, so `validateRole(draft.role)` always passes.
- **Instructions.** `body` becomes `instructions`; if `body` is empty, `description` is used and the draft notes the fallback.
- **Name sanitization.** Trim, strip control characters, strip a leading dash, fall back to filename stem; the result is validator-clean.
- **Autonomy clamp down one notch.** `bypassPermissions` (would be the most permissive) -> clamp to `auto-approve-safe`; `acceptEdits` or a write-tool present -> clamp to `manual`; read-only / no signal -> `manual`. The mapper sets `autonomyClampNote` whenever it lowered the value. (Design 05's `autonomous`/`supervised` vocabulary maps onto Maestro's `yolo`/`auto-approve-safe`/`manual` triple; the clamp is always strictly downward.)
- **Write is never granted silently.** Any declared write tool (or a write-capable MCP server) lands in `proposedSkills` as a chip, but `Role.tools` write stays off (P4's default). A declared tool whose MCP server is absent from `mcp` goes into `unavailableTools`, never into a grant.

- [ ] Red: `mapper.test.ts` asserts: a `claude-agent` maps engine to `acp`; a `.github/` agent with no model maps to `copilot`; a hostile name `-rf` is sanitized; a `bypassPermissions` source clamps to `auto-approve-safe` with a note; a write tool with no configured MCP server appears in `unavailableTools` and not in the role; and `validateRole(draft.role).ok === true` for every produced draft. Run -> red.
- [ ] Green: implement `mapToRole`, reusing `KNOWN_ENGINE_IDS` and the name-sanitization rules that mirror the validator. Run -> green.
- [ ] Commit: `feat(config): foreign-agent to Role mapper with engine allowlist and autonomy clamp`

### Task 5: MCP inventory reader

**Files:** `packages/config/src/discover/mcp.ts`, `packages/config/test/discover/fixtures/repo/.mcp.json`, `fixtures/repo/.vscode/mcp.json`, `packages/config/test/discover/mcp.test.ts`.

```typescript
export interface McpServerInfo { name: string; description?: string; writeCapable: boolean; }
export interface McpInventory { servers: McpServerInfo[]; }

export async function readMcpInventory(root: string, fs: FsReader): Promise<McpInventory>;
```

Read `.mcp.json` (key `mcpServers`) and `.vscode/mcp.json` (key `servers`), union by server name, names and descriptions only. Never start a server. `writeCapable` is a coarse heuristic (server name or declared tools mention `write` / `edit` / `fs`), used only to decide whether the mapper may treat a declared write tool as available. Missing or malformed files yield an empty inventory without throwing.

- [ ] Red: `mcp.test.ts` reads both fixtures and asserts the union of server names, that descriptions survive, and that a malformed `.vscode/mcp.json` does not throw (empty contribution). Run -> red.
- [ ] Green: implement `readMcpInventory` over `FsReader`. Run -> green.
- [ ] Commit: `feat(config): MCP inventory reader for .mcp.json and .vscode/mcp.json`

### Task 6: FsScanner and Copilot plugin scan with a fixture installed-plugins tree

**Files:** `packages/config/src/discover/plugins.ts`, `packages/config/src/discover/scanner.ts` (FsScanner interface + node impl), `packages/config/test/discover/fixtures/home/.copilot/installed-plugins/**`, `packages/config/test/discover/plugins.test.ts`.

Extend the read surface with a scanner-only fs interface that can walk trees while honoring symlink containment:

```typescript
export interface FsScanner extends FsReader {
  /** Sub-directory names of `dir`, excluding symlinked entries. [] if dir absent. */
  listDirs(dir: string): Promise<string[]>;
}
```

`discoverPlugins(home, fs)` walks `~/.copilot/installed-plugins/{marketplace}/{plugin}/`, reads each plugin's `.github/plugin/plugin.json`, and enumerates its bundled `agents` (each -> a `plugin-agent` `DiscoveredItem` with `pluginStem` = filename stem and `pluginName`), `skills` (each -> a `plugin-skill` item, `isSkill: true`), and inline `mcpServers` (folded into the inventory passed to the mapper). Enumeration is a filesystem scan, never a `copilot plugin list` call (no such command). A plugin agent records `pluginStem` so the dispatch path can later invoke `copilot --agent <stem> -p`.

The node-backed `FsScanner` (mirroring `makeNodeFsReader`) skips symlinked directory and file entries in `listDirs` / `listFiles`, so a symlinked plugin or a symlinked entry inside `.github/` is never followed.

Create `fixtures/home/.copilot/installed-plugins/copilot-plugins/sec-kit/.github/plugin/plugin.json` declaring one agent, one skill, and one mcpServer, plus the agent and `SKILL.md` files it references. Add one symlinked fixture entry (or a test double that reports `isSymbolicLink`) to assert it is skipped.

- [ ] Red: `plugins.test.ts` (with a fake `FsScanner` over the fixture map) asserts: the `sec-kit` agent is discovered as `plugin-agent` with the right `pluginStem` and `pluginName`; its skill is `plugin-skill` with `isSkill: true`; its inline mcpServer is surfaced; and a symlinked entry is excluded. Run -> red.
- [ ] Green: implement `FsScanner`, `discoverPlugins`, and the symlink-skipping node impl. Run -> green.
- [ ] Commit: `feat(config): Copilot plugin scan with symlink-safe FsScanner`

### Task 7: Workspace scanner orchestration (read-only, symlink-contained)

**Files:** `packages/config/src/discover/scanner.ts`, `packages/config/src/discover/index.ts`, `packages/config/src/index.ts` (re-export), `packages/config/test/discover/scanner.test.ts`.

```typescript
export interface DiscoverResult {
  items: DiscoveredItem[];
  mcp: McpInventory;
  /** Paths the scanner could not read (permission denied, etc.), for the design-05 "scan incomplete" banner. */
  skipped: string[];
}

export async function discoverWorkspace(root: string, fs: FsScanner): Promise<DiscoverResult>;
```

`discoverWorkspace` walks a bounded allowlist of directories (`.github/`, `.claude/`, `.conductor/`, `.continue/`, `.cursor/`) plus the LOW-tier instruction files at the root and a shallow scan for `*.prompt.md` (the open-question default: allowlisted dirs, not a full-tree walk, to stay fast on a monorepo). For each file it picks the parser by path, runs `classify`, and assembles a `DiscoveredItem`. It reads the MCP inventory once via `readMcpInventory`. Every read is wrapped so a per-file error pushes the path to `skipped` rather than throwing, and the node-backed `FsScanner` skips symlinked entries so the scan can never escape the workspace. The scanner is pure and read-only: no spawn, no MCP startup, no `git`.

- [ ] Red: `scanner.test.ts` runs `discoverWorkspace` against the `fixtures/repo` tree (via a fake `FsScanner`) and asserts: every fixture source kind appears exactly once with its expected confidence; the MCP inventory is populated; a symlinked `.yaml` planted in `.claude/agents/` is absent from `items` and the scan still returns the real items; an unreadable path lands in `skipped` without throwing. Run -> red.
- [ ] Green: implement `discoverWorkspace`, re-export the discover surface from `discover/index.ts` and from `packages/config/src/index.ts`. Run -> green.
- [ ] Commit: `feat(config): read-only workspace discovery scanner`

### Task 8: Pure discover-view presenter in the cockpit

**Files:** `packages/cockpit/src/discover-view.ts`, `packages/cockpit/test/discover-view.test.ts`.

A pure presenter the Discover tab renders verbatim, mirroring how `selectState` produces `CockpitState`:

```typescript
export interface DiscoverCardVM {
  id: string;          // stable: source path
  name: string;
  description: string;
  sourceBadge: string; // ".claude/agents" or "Plugin · sec-kit"
  engineId: "copilot" | "acp";
  confidence: Confidence;
  skillChips: string[];        // up to 4, overflow folds to "+N more"
  overflowSkills: number;
  canDispatch: boolean;        // HIGH confidence only
  canAdopt: boolean;           // not "instructions" tier
  isSkill: boolean;
}
export type DiscoverGroup = "in-repo" | "plugins" | "instructions" | "marketplace";
export interface DiscoverVM {
  groups: Array<{ group: DiscoverGroup; label: string; count: number; cards: DiscoverCardVM[] }>;
  scanning: boolean;
  scanError?: string;
}
export function selectDiscover(
  items: DiscoveredItem[],
  filter: string,
  activeChip: DiscoverGroup | "all",
  scanning: boolean,
  scanError?: string,
): DiscoverVM;
```

Grouping per design 05: `in-repo` (HIGH and MEDIUM repo items), `plugins` (plugin-sourced), `instructions` (LOW, collapsed), `marketplace` (always one placeholder card, never interactive). The free-text filter matches name, description, and skill chip labels; non-matching cards are dropped from the count. `canDispatch` is true only for `verified` confidence; `canAdopt` is false for the `instructions` tier (Browse only). The engine palette and confidence-trio mapping stay on the design's fixed graphite tokens (seam R2): the green tick is reserved for `verified`, amber for `likely`, grey for `instructions`.

- [ ] Red: `discover-view.test.ts` asserts: items group into the right buckets with correct counts; a filter narrows cards and updates counts; `canDispatch` is false for a MEDIUM item; `canAdopt` is false for a LOW item; skill chips cap at 4 with a correct `overflowSkills`; the marketplace group always carries exactly one non-interactive placeholder. Run -> red.
- [ ] Green: implement `selectDiscover`. Run -> green.
- [ ] Commit: `feat(cockpit): pure discover-view presenter with grouping and filter`

### Task 9: Protocol messages, guard, and exhaustive switches

**Files:** `packages/cockpit/src/protocol.ts`, `packages/cockpit/test/protocol.test.ts`.

Add the host->webview result message and the webview->host messages:

```typescript
// HostToWebview gains:
| { type: "discover-results"; items: DiscoveredItem[]; mcp: McpInventory; scanError?: string }

// WebviewToHost gains:
| { type: "scan-repo" }
| { type: "scan-plugins" }
| { type: "adopt-agent"; itemId: string }
| { type: "adopt-skill"; itemId: string }
| { type: "browse-source"; itemId: string }
```

`HostToWebview` becomes a union, so its consumers must switch exhaustively. `adopt-*` and `browse-source` carry an `itemId` (the source path), not an `agentId`, so they are NOT added to `AGENT_ID_TYPES`; the guard validates `itemId` as a string for them. `scan-repo` / `scan-plugins` carry no id. Extend `isWebviewMessage`'s switch (every new case validated, `default` still returns false) and keep it total.

- [ ] Red: `protocol.test.ts` asserts `isWebviewMessage` accepts each new well-formed message, rejects `adopt-agent` with a missing/non-string `itemId`, rejects `scan-repo` with junk extra-but-wrong shape only where required, and still rejects unknown types. A type-level test asserts a `HostToWebview` switch without the `discover-results` case fails to compile (exhaustiveness). Run -> red.
- [ ] Green: extend the unions, the guard switch, and any `HostToWebview` consumer switch in the cockpit. Run -> green.
- [ ] Commit: `feat(cockpit): discover/adopt protocol messages with updated isWebviewMessage`

### Task 10: Discover controller (scanner + serializer wiring, vscode-free)

**Files:** `packages/extension/src/discover-controller.ts`, `packages/extension/test/discover-controller.test.ts`.

A pure controller (no `vscode` import, mirroring the split that keeps `controller.ts` unit-testable) that owns the scan-and-adopt cycle:

```typescript
export interface DiscoverDeps {
  scanWorkspace(): Promise<DiscoverResult>;
  scanPlugins(): Promise<DiscoverResult>;       // resolves empty when the plugin opt-in is off
  headSha(): Promise<string | undefined>;       // single git rev-parse, injected
  writeRole(name: string, yaml: string): Promise<void>;   // through @maestro/config serializer
  writeSkill(name: string, item: DiscoveredItem): Promise<void>; // reuses P3 skills store
  mcpInventory(): McpInventory;
  openAnatomyEditor(draft: AdoptDraft): void;   // P4 editor, pre-filled
  openSkillEditor(item: DiscoveredItem, provenance: Provenance): void;
  emit(msg: HostToWebview): void;
}
export function createDiscoverController(deps: DiscoverDeps): {
  handle(msg: Extract<WebviewToHost, { type: "scan-repo" | "scan-plugins" | "adopt-agent" | "adopt-skill" | "browse-source" }>): void;
};
```

`scan-repo` / `scan-plugins` run the scanner and `emit` a `discover-results`. `adopt-agent` looks up the item, runs `mapToRole` with the injected `headSha` provenance, and calls `openAnatomyEditor(draft)` (the editor's Save is what persists, via `writeRole` -> `serializeRole`, so adopt is never a silent write). `adopt-skill` copies the SKILL.md once into `.conductor/skills/<name>/` with a provenance block (reusing the P3 store) and opens the skill editor. The serializer output for an adopted role includes a `provenance` block:

```yaml
provenance:
  source: .claude/agents/security-reviewer.md
  sha: a3f8c1d
  adoptedAt: 2026-06-16
```

(P5 extends `serializeRole` additively to emit an optional `provenance` block when the role carries one; round-trips through the parser without becoming a validation error.)

- [ ] Red: `discover-controller.test.ts` with a fake `DiscoverDeps` asserts: `scan-repo` emits `discover-results` carrying the scanned items; `adopt-agent` for a HIGH item opens the anatomy editor with a draft whose engine is in the allowlist, whose autonomy is clamped, and whose provenance carries the injected sha; `adopt-agent` does NOT call `writeRole` directly (the editor Save does); `adopt-skill` calls `writeSkill` and opens the skill editor; `browse-source` is routed without mutating anything. Run -> red.
- [ ] Green: implement `createDiscoverController` and the additive `provenance` serializer support. Run -> green.
- [ ] Commit: `feat(extension): discover controller wiring scanner to config serializer`

### Task 11: Discover tab, Browse drawer, and adopt UI in the extension

**Files:** `packages/extension/src/extension.ts` (activate delta), `packages/extension/package.json` (contributes the `maestro.discoverPlugins` setting), the Library webview Discover-tab markup/handlers (extending the R4 Library shell), `packages/extension/test/*` as applicable.

Wire the real surface (seam R4): the Discover tab joins `Agents | Teams | Skills | Discover` in the Library shell. On first open it auto-runs `scan-repo`; the "Scan repo" button re-runs it; while scanning, the animated dot replaces the label. Render from `selectDiscover` output: sticky header, source filter chips (all / In this repo / Copilot plugins / Marketplace soon, the last dimmed and non-interactive), free-text filter, grouped collapsible sections, discovered-agent cards (source badge, confidence trio, engine chip, up to 4 skill chips, Browse / Dispatch / Adopt), and the right-side Browse drawer (Instructions / Skills / Source tabs + an Open file action). Adopt posts `adopt-agent` (or `adopt-skill`); Dispatch (HIGH only) pre-fills the P2 dispatch composer with the mapped draft without adopting. Plugin scanning is gated behind `maestro.discoverPlugins` (default false); when off, `scan-plugins` resolves empty and the Copilot-plugins group shows the design-05 "Nothing found here" empty state. All webview HTML stays on the graphite palette (seam R2) and routes user content through the existing `escapeHtml` so a hostile discovered name or body cannot inject markup.

- [ ] Red: extend the extension webview/controller test (or the existing cockpit-host test harness) to assert the Discover tab posts `scan-repo` on first reveal, that an `adopt-agent` message reaches the discover controller, and that with `maestro.discoverPlugins` off no plugin read is attempted. Run the package test -> red.
- [ ] Green: implement the activate delta, the `contributes.configuration` entry for `maestro.discoverPlugins`, and the Discover-tab + drawer markup/handlers. Run -> green.
- [ ] Commit: `feat(extension): Discover tab, Browse drawer, and adopt flow`

### Task 12: Full-gate verification and Self-Review pass

**Files:** none (verification only) beyond any fix-ups surfaced.

- [ ] Run the repo-root gate: `pnpm -r typecheck && pnpm -r test && pnpm -r build`. All packages green; both extension bundles emit.
- [ ] Walk the Self-Review checklist below; fix any gap and re-run the gate.
- [ ] Commit: `chore(p5): verify full gate green for Discover and Adopt`

---

## Self-Review

Map each design-05 requirement to the task that delivers it, and confirm every invariant.

- [ ] **Source taxonomy and tiers (design 05).** HIGH (`.claude/agents`, `.conductor/roles`, `.github/agents/*.agent.md`, `.github/chatmodes/*.chatmode.md`), MEDIUM (`*.prompt.md`, `.claude/skills/*/SKILL.md`, `.continue/agents`, `.cursor/rules`), LOW (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.github/copilot-instructions.md`) are each parsed (Task 2) and classified (Task 3) with one fixture per source kind.
- [ ] **Both Copilot paths scanned.** `.agent.md` and legacy `.chatmode.md` are distinct source kinds, both HIGH (Tasks 2, 3).
- [ ] **MCP configs are the tools inventory, not started.** `.mcp.json` (`mcpServers`) and `.vscode/mcp.json` (`servers`) read for names only; no server launched (Task 5).
- [ ] **Copilot plugin discovery is a filesystem scan.** `~/.copilot/installed-plugins/{marketplace}/{plugin}/.github/plugin/plugin.json` enumerated by walking the tree, not by a `copilot plugin list` call; plugin agents record the `copilot --agent <stem> -p` stem (Task 6).
- [ ] **Confidence: green only for verified.** `verified` is the only tier that earns the green tick; amber is `likely`, grey is `instructions`; the classifier switch is exhaustive (Tasks 3, 8).
- [ ] **Engine allowlist enforced on adopt.** The mapper collapses every foreign hint to `copilot` or `acp` so `validateRole(draft.role).ok` always holds; no unknown engine id can ever be produced (Task 4), honoring `KNOWN_ENGINE_IDS`.
- [ ] **Autonomy clamped down a notch.** Inferred autonomy is always lowered one tier with an info note; never raised silently (Task 4).
- [ ] **Write never granted silently; unconfigured MCP never enabled.** Declared write tools become unverified chips, not grants; a tool with no matching MCP server lands in `unavailableTools` shown red, never enabled (Tasks 4, 5).
- [ ] **Name sanitization.** Foreign names are trimmed, control-char stripped, and de-dashed so they are validator-clean and cannot smuggle a CLI flag (Task 4), mirroring the validator's existing defense.
- [ ] **Scanner is read-only and pure.** No spawn, no MCP startup, no `git` inside the scanner; the single HEAD read is injected at the controller layer (Tasks 7, 10).
- [ ] **Symlink containment respected by the scanner (seam R6).** The node-backed `FsScanner` skips symlinked entries in every walked tree; unit tests assert a planted symlink is excluded (Tasks 6, 7).
- [ ] **Adopt persists through the M8 serializer (seam R6).** Roles write to `.conductor/roles/<name>.yaml` and skills to `.conductor/skills/<name>/` via the config package, with a provenance block that round-trips (Tasks 10, 11).
- [ ] **Adopt opens the P4 editor pre-filled, no silent write.** The draft (provenance line, clamped autonomy, unverified skill chips) opens the anatomy editor; only the editor's Save persists (Tasks 10, 11).
- [ ] **`isWebviewMessage` updated and exhaustive switches kept total (seam R4).** New `scan-repo` / `scan-plugins` / `adopt-agent` / `adopt-skill` / `browse-source` messages validated (`itemId` checked, not added to `AGENT_ID_TYPES`); `HostToWebview` consumers switch exhaustively over the new `discover-results` (Task 9).
- [ ] **Graphite palette (seam R2).** All Discover and Browse-drawer markup uses the design's fixed tokens, not `var(--vscode-*)`; discovered content is escaped before render (Task 11).
- [ ] **Discover is the fourth Library tab (seam R4).** Tab joins the R4 Library shell; depends on P3 (skills store, skill editor reuse) and P4 (anatomy editor, `Role.tools` for the write-grant gate).
- [ ] **Deferred, with owner.** Live marketplace install is a placeholder card only; executing a discovered agent beyond mapping is the P2 dispatch surface; the rich diff review is P6; provenance staleness and same-name conflict-as-diff are open questions, not P5.
- [ ] **House rules.** No em dashes in prose, code, comments, or commit messages; every task ends in a commit with the `Co-Authored-By` trailer; the repo-root gate is green at every commit.
