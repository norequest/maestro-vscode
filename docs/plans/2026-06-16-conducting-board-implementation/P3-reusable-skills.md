# Maestro P3: Reusable Skills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> Part of the [roadmap](./README.md). UX spec: [04](../2026-06-16-conducting-board-design/04-reusable-skills.md), [03](../2026-06-16-conducting-board-design/03-agents-teams-and-anatomy.md).

---

## Goal

Promote Skills to a first-class, shared library object. A skill is authored once at `.conductor/skills/<name>/SKILL.md` (mirroring Claude Code's own `.claude/skills/<name>/SKILL.md` convention) and attached to any role by NAME via a new additive `Role.skills?: string[]`. The `@maestro/config` package gains a `SkillManifest` parser, a skills loader, a reverse index (skill name to referencing roles, the "used by N agents" blast radius), and skills-aware role serialization. The resolved skill bodies are appended to the spawn input so skills are functional end to end NOW (the cheapest real capability per design 07). The `@maestro/extension` gains the full-screen Library webview shell (tab bar Agents | Teams | Skills | Discover) with the Skills tab fully implemented per design 04. All skill and `role.skills` writes flow through the M8 config serializer, preserving the audit-hardened invariants.

P3 is the data-and-editor deepening: it makes skills real and editable. P4 builds the rich anatomy editor (Soul, Tools) around them and absorbs the spawn-time append into the single ordered preamble.

---

## Architecture

Two packages change, plus a two-line additive delta to `@maestro/core`.

- `@maestro/config` is the data layer: `SkillManifest`, the SKILL.md parser, the skills loader, the reverse index, the compose function (minimal spawn append), and the validator/serializer/scaffolder deltas.
- `@maestro/extension` is the thin shell: the Library webview (its own panel, separate from the Stage), the Skills tab, the Add-skill picker, and the activate wiring (open-library command + skills-in-spawn).

The Library is its OWN webview, separate from the Stage cockpit, exactly as R4 prescribes. Its message protocol lives BESIDE (not inside) the cockpit `protocol.ts`, so the Stage's `isWebviewMessage` and exhaustive switch stay untouched. It reuses the same hardening pattern: an `isLibraryMessage` runtime guard at the webview->host boundary and an exhaustive `switch` in the controller.

### Where the minimal spawn-time append lives (R3)

The orchestrator's `spawn(roleName, description)` builds `task.description = description` verbatim, and `launch` hands `agent.task` + `agent.role` to `adapter.start`. The adapters (`buildArgs` for Copilot, `session/new` for ACP) consume `task.description` + `role` directly. P4 owns the full ordered preamble (Soul, Instructions, Tools, Skills, Task) assembled IN the adapters. So P3's minimal append must NOT touch the adapters: it composes resolved skill bodies into the description string at the extension spawn path, where the role is already resolved from `.conductor/`. `composeSkillPreamble(role, bodies)` is a pure function in `@maestro/config`; the extension prepends its output to the user's task text before `cockpit.handle({type:"spawn"})`. When P4 lands, the assembler moves into the adapters and this prepend is deleted, not duplicated: the compose function is structured (and unit-tested) so P4 imports the same resolver and the move is mechanical.

### Reference-by-name and the unknown-skill WARNING (mirrors Team.roles)

`validateTeam` already treats an unknown role reference as a `ValidationWarning`, not an error (graceful degradation when a file is missing). `Role.skills` follows that precedent: a `skills` value that is not a `string[]` is an ERROR (structural mistake), but a well-formed skill NAME that does not resolve to a loaded manifest is a WARNING. This differs deliberately from `engine.id`, a hard ERROR on an unknown id because it selects a spawnable adapter (Issue 28 / S9). A skill name selects a procedure body, never an executable, so a missing one degrades to "no procedure appended", never a refusal. KNOWN_ENGINE_IDS and the engine-id hard-ERROR path are untouched (R6).

---

## Scope

### IN (owned by P3)

- `Role.skills?: string[]` additive on `@maestro/core` `Role` (absent means no change to spawn behavior).
- `SkillManifest { name; description; allowedTools?; provenance? }` + the SKILL.md frontmatter+body parser.
- Skills loader (read all SKILL.md) and the reverse index (skillName -> Role[], used-by counts).
- Validator delta: `skills` must be `string[]`; an unknown skill name is a WARNING at load.
- Serializer delta: round-trip `role.skills`; write/read SKILL.md.
- Scaffolder delta: create `.conductor/skills/` on first run, seed one example skill.
- The MINIMAL spawn-time skills append (resolved bodies reach the adapter input via the description), tested.
- The Library webview shell + tab bar; the Skills tab in full (grid card with used-by amber-at-3+ pill / source badge / required-tools hint; editor with Procedure body, read/write Required-tools "declared requirements, not grants" grid, Used-by chips + "editing updates all N" caution, Delete with blast-radius confirm; Add-skill picker that attaches a skill to a role).
- A minimal READ-ONLY Agents and Teams listing in their tabs (data exists from M8); Discover is a "coming in P5" placeholder.
- Library protocol messages (open-library, switch-library-tab, skill-create, skill-save, skill-delete, attach-skill, detach-skill) + `isLibraryMessage` guard + the controller routing writes through the M8 serializer (R6).

### OUT (deferred, with owning phase)

- The Add-skill grant-gate (amber "needs Git(write), this agent does not have it yet" with Grant / Attach-without-granting / Cancel). Needs the tools model, so **P4** (R5). In P3 the picker shows only DECLARED requirements; attaching never diffs against grants.
- `Role.soul?`, the tools-grant model, and the rich anatomy editor behind the Agents tab: **P4** (the Agents tab here is read-only).
- The single ordered Soul/Instructions/Tools/Skills/Task preamble assembled in the adapters: **P4** (R3).
- The Discover tab (placeholder only) and adopt-from-`.claude/skills/`: **P5**.
- Team-level skills union (`Team.skills?` unioned onto members at spawn): **P4** with the charter. The `Team.skills?` TYPE may be added back-compatibly in Task 1 as a noted stretch; the union behavior is not wired here.

---

## File Structure

```
packages/core/src/types.ts                  MODIFY  Role.skills?: string[]  (+ optional Team.skills? stretch)

packages/config/src/
  skill-types.ts      NEW   SkillManifest
  skill-parser.ts     NEW   parse SKILL.md -> { manifest, body }
  skill-loader.ts     NEW   loadSkills(root, fs) -> { skills, bodies, warnings, errors }
  skill-index.ts      NEW   buildSkillIndex(roles, manifests) -> used-by reverse map
  compose.ts          NEW   composeSkillPreamble / composeSpawnDescription (R3, replaceable)
  validator.ts        MODIFY skills field on validateRole
  serializer.ts       MODIFY role.skills on serializeRole; + serializeSkill
  scaffolder.ts       MODIFY create skills dir + seed one example
  index.ts            MODIFY re-export the new modules
packages/config/test/  skill-parser / skill-loader / skill-index / compose (NEW); validator / serializer / scaffolder (MODIFY)

packages/extension/src/
  library-protocol.ts    NEW   LibraryToHost / HostToLibrary + isLibraryMessage guard
  library-render.ts      NEW   pure HTML builders (grid card, editor, picker rows, tab bar, ro lists)
  library-html.ts        NEW   getLibraryHtml(...) shell (CSP/nonce, graphite; R2)
  library-controller.ts  NEW   createLibrary(gw, onSnapshot): routes CRUD + attach/detach through config
  library.ts             NEW   LibraryWebviewPanel (vscode runtime; mirrors stage.ts)
  webview/library-main.ts NEW  vanilla-TS client
  webview/library.css    NEW   graphite palette (R2)
  extension.ts           MODIFY maestro.openLibrary command + skills-in-spawn
  build.mjs              MODIFY third webview entry + copy library.css
  package.json           MODIFY contribute maestro.openLibrary + view/title menu
packages/extension/test/  library-protocol / library-render / library-controller (NEW)
```

Build order: `@maestro/core` (types delta) -> `@maestro/config` (data work) -> `@maestro/extension` (Library UI). The config tasks and the extension render/protocol tasks are independent once Task 1 lands, so a data-layer implementer and a render-layer implementer can run concurrently.

---

## Tasks

Each task is red -> green -> commit. Commit messages end with the `Co-Authored-By` trailer (added at commit time).

### Task 1: `Role.skills?: string[]` (additive core delta)

**Files:** `packages/core/src/types.ts`, `packages/core/test/types.test.ts`

- [ ] **Red.** Append a `types.test.ts` case: `expectTypeOf<Role>().toMatchTypeOf<{ skills?: string[] }>()` and a literal `Role` with `skills: ["run-tests"]`. Run `pnpm -F @maestro/core test` -> red.
- [ ] **Green.** Extend `Role` additively (do NOT reorder existing fields): add `/** Names of skills resolved to .conductor/skills/<name>/SKILL.md at spawn. Additive; absent means none. */ skills?: string[];`. Stretch (type only, back-compatible; union is P4): add `skills?: string[]` to `Team`. Drop the stretch if it causes any test churn. Run -> green.
- [ ] **Commit:** `feat(core): add optional Role.skills name list (additive, P3)`.

### Task 2: `SkillManifest` type + SKILL.md parser

**Files:** `packages/config/src/skill-types.ts`, `skill-parser.ts`, `test/skill-parser.test.ts`

A SKILL.md is YAML frontmatter (fenced by `---`) carrying `name`, `description`, optional `allowed-tools`, then a freeform markdown body (the procedure). `SkillManifest { name; description; allowedTools?: string[]; provenance?: { sourceFile; sourceSha } }` (provenance is set only by P5 adoption).

- [ ] **Red.** `skill-parser.test.ts` vitest sketch: `parseSkillMarkdown(runTestsMd, src)` returns `{ manifest, body }` where `manifest.ok` and `value.name === "run-tests"`, `value.allowedTools === ["Run","Git"]`, `body` contains the steps and NOT the frontmatter; missing `name` -> `manifest.ok === false`; no-frontmatter body -> error (not a silent empty manifest); omitted `allowed-tools` -> `allowedTools === undefined`. Run -> red.
- [ ] **Green.** Implement `skill-types.ts` + `skill-parser.ts`: split on the leading `---` fence, `parse` the frontmatter via `yaml`, require non-empty `name`/`description`, reuse `validateRole`'s name-safety guards (no leading dash, no control chars, so a skill name can never become a CLI flag), coerce `allowed-tools` to `string[] | undefined`, keep the body verbatim. Return `{ manifest: ValidationResult<SkillManifest>; body: string }`. Run -> green.
- [ ] **Commit:** `feat(config): SkillManifest type + SKILL.md frontmatter/body parser`.

### Task 3: Skills loader (read all SKILL.md, injectable fs)

**Files:** `packages/config/src/skill-loader.ts`, `test/skill-loader.test.ts`

Mirror `loader.ts`: `loadSkills(workspaceRoot, fs)` lists `.conductor/skills/*` subdirs, reads each `<name>/SKILL.md`, parses, and aggregates. Add a `listDirs(dir)` method to the `FsReader` interface and to the node-backed reader (skip symlinked entries).

- [ ] **Red.** `skill-loader.test.ts` (in-memory fake fs, mirror `loader.test.ts`'s `makeFakeFs`): absent skills dir -> `skills: []`, `errors: []`; one valid `run-tests/SKILL.md` -> one manifest with the parsed `allowedTools`; a malformed SKILL.md -> `skills: []` and a collected error (no throw). Run -> red.
- [ ] **Green.** Implement `loadSkills` returning `{ skills: SkillManifest[]; bodies: Map<string,string>; warnings; errors }` (`bodies` feeds `composeSkillPreamble`). All fs behind the injected `FsReader`. Reuse the node reader's `.conductor` symlink containment unchanged so a symlinked `SKILL.md -> /etc/passwd` is refused (R6). Run -> green.
- [ ] **Commit:** `feat(config): skills loader reads all .conductor/skills/<name>/SKILL.md`.

### Task 4: Reverse index (used-by blast radius)

**Files:** `packages/config/src/skill-index.ts`, `test/skill-index.test.ts`

`buildSkillIndex(roles, manifests)` returns `{ usedBy(name): Role[]; usedByCount(name): number; all(): Map<string, Role[]> }` keyed by skill name. This is the "used by N agents" reading and the data the amber 3+ treatment keys off.

- [ ] **Red.** `skill-index.test.ts` sketch: roles `Tester[run-tests]`, `Impl[run-tests,openapi]`, `Plain` -> `usedBy("run-tests")` names `["Tester","Impl"]`, `usedByCount("openapi") === 1`; an unreferenced manifest -> count 0; a `role.skills` name with no manifest is still counted by NAME (dangling reference shows its blast radius). Run -> red.
- [ ] **Green.** Implement by folding each `role.skills` entry into the map. Index by NAME (a missing manifest is a load warning, not a reason to hide that N roles depend on the name). Run -> green.
- [ ] **Commit:** `feat(config): reverse skill index (used-by counts / blast radius)`.

### Task 5: Minimal spawn-time skills append (R3, replaceable)

**Files:** `packages/config/src/compose.ts`, `test/compose.test.ts`

`composeSkillPreamble(role, bodies)` resolves `role.skills` to procedure bodies and returns a preamble; `composeSpawnDescription(role, bodies, task)` prepends it to the task. The ONE place skills become functional end to end in P3. Deliberately a small pure function so P4 lifts it verbatim and deletes the extension prepend.

- [ ] **Red.** `compose.test.ts` sketch: no skills -> preamble `""` and `composeSpawnDescription` returns the task unchanged; two skills -> bodies inlined in `role.skills` order; a dangling name -> skipped (never throws); with skills -> description ends with the verbatim task. Run -> red.
- [ ] **Green.** `composeSkillPreamble` joins resolved bodies under a stable `## Skills` header, each under `### <name>`. `composeSpawnDescription` returns `task` unchanged on empty preamble, else `${preamble}\n\n${task}`. TSDoc note: "MINIMAL P3 append. P4 replaces with the full Soul/Instructions/Tools/Skills/Task preamble in the adapters (R3). Do not duplicate; P4 imports this resolver and deletes the extension prepend." Run -> green.
- [ ] **Commit:** `feat(config): minimal spawn-time skill preamble compose (R3, P4 absorbs it)`.

### Task 6: Validator delta (skills must be string[]; unknown name warns at load)

**Files:** `packages/config/src/validator.ts`, `test/validator.test.ts`

`validateRole` gains an optional `skills` read. Present-but-not-`string[]` is an ERROR; a well-formed name is carried through. The unknown-name WARNING is NOT raised inside `validateRole` (no manifests in scope); the loader/UI compares `role.skills` against loaded manifests and warns. Mirror `Team.roles`. Engine-id hard-ERROR untouched (R6).

- [ ] **Red.** Append validator cases: a role with `skills: ["run-tests","openapi"]` is ok and carries them; absent `skills` -> `undefined`; `skills: "run-tests"` and `skills: [1,2]` -> errors; an unknown engine id is STILL a hard error. Run -> red.
- [ ] **Green.** After the autonomy check, if `raw["skills"]` is defined require `Array.isArray` + every entry `isString` (else error). Carry the array onto the returned `Role` only when present (preserve the "omit when absent" shape used elsewhere). Comment points at the loader/index for the unknown-name warning, mirroring `validateTeam`. Run -> green.
- [ ] **Commit:** `feat(config): validate optional role.skills (string[] or error; unknown name warns at load)`.

### Task 7: Serializer delta (role.skills round-trip + serializeSkill)

**Files:** `packages/config/src/serializer.ts`, `test/serializer.test.ts`

`serializeRole` writes `skills:` when present, omits it when absent (existing role files unchanged). `serializeSkill(manifest, body)` produces SKILL.md text: `---` frontmatter then the body.

- [ ] **Red.** Append cases: `serializeRole({...implementer, skills:["run-tests"]})` contains `skills:` and round-trips through `parseRoleYaml`; `serializeRole(implementer)` does NOT contain `skills:`; `serializeSkill({name,description,allowedTools:["Run","Git"]}, body)` round-trips through `parseSkillMarkdown` (name, allowedTools, body all preserved). Run -> red.
- [ ] **Green.** Extend `serializeRole`'s doc with `...(role.skills ? { skills: role.skills } : {})`. Implement `serializeSkill`: `stringifyYaml({ name, description, ...(allowedTools ? { "allowed-tools": allowedTools } : {}) })` wrapped in `---\n...\n---\n` then the body, `lineWidth: 120`. Run -> green.
- [ ] **Commit:** `feat(config): serialize role.skills + serializeSkill writes SKILL.md`.

### Task 8: Scaffolder delta (create skills dir + seed one example)

**Files:** `packages/config/src/scaffolder.ts`, `test/scaffolder.test.ts`

`scaffoldIfMissing` additionally creates `.conductor/skills/` and seeds ONE example (`run-tests`) via `serializeSkill` so it parses back cleanly. The existing `if (await fs.exists(conductorDir)) return false` guard keeps this on a fresh `.conductor/` only.

- [ ] **Red.** Append cases: after scaffolding a `skills` dir exists and one `SKILL.md` is written; the seeded SKILL.md parses back to an ok manifest. Run -> red.
- [ ] **Green.** Add a `STARTER_SKILL` (manifest + body). After creating roles/teams dirs, create `skills/run-tests` and write its SKILL.md via `serializeSkill`. Run -> green.
- [ ] **Commit:** `feat(config): scaffold .conductor/skills/ with one seeded example skill`.

### Task 9: Config index re-exports + package gate

**Files:** `packages/config/src/index.ts`

- [ ] Add `export * from` for `skill-types`, `skill-parser`, `skill-loader`, `skill-index`, `compose`.
- [ ] Run `pnpm -F @maestro/config typecheck && pnpm -F @maestro/config test && pnpm -F @maestro/config build` -> all green, `dist/` emits.
- [ ] **Commit:** `feat(config): export skills surface from index`.

### Task 10: Library protocol + `isLibraryMessage` guard

**Files:** `packages/extension/src/library-protocol.ts`, `test/library-protocol.test.ts`

A separate protocol from the cockpit's (R4), living in its own file so the Stage `protocol.ts` is not touched. The shapes that anchor Tasks 11 to 13:

```ts
export type LibraryTab = "agents" | "teams" | "skills" | "discover";

export interface SkillCardVM {
  name: string;
  description: string;
  allowedTools?: string[];                 // DECLARED requirements, never a grant (R5)
  source: "authored" | "plugin";           // "plugin" -> the From-plugin badge (adoption is P5; default "authored")
  usedBy: { roleName: string; engineId: string }[];  // blast radius; amber at length >= 3
}

export interface LibrarySnapshot {
  tab: LibraryTab;
  skills: SkillCardVM[];
  roles: { name: string; engineId: string; skills: string[] }[];  // read-only Agents tab
  teams: { name: string; roleNames: string[] }[];                 // read-only Teams tab
  editing?: SkillCardVM;          // open skill editor (create-mode marker when name is "")
  picker?: { roleName: string };  // open Add-skill picker bound to a role
}

export type HostToLibrary = { type: "library-state"; snapshot: LibrarySnapshot };

export type LibraryToHost =
  | { type: "open-library" }
  | { type: "switch-library-tab"; tab: LibraryTab }
  | { type: "skill-create" }
  | { type: "skill-save"; name: string; description: string; body: string; allowedTools?: string[] }
  | { type: "skill-delete"; name: string }
  | { type: "attach-skill"; roleName: string; skillName: string }
  | { type: "detach-skill"; roleName: string; skillName: string };
```

- [ ] **Red.** `library-protocol.test.ts` sketch: `isLibraryMessage` accepts each well-formed variant; rejects `null`, a `switch-library-tab` with no/invalid `tab`, an `attach-skill` missing `skillName`, a `skill-save` with non-string `name`, and an unknown `type`. Run `pnpm -F @maestro/extension test` -> red.
- [ ] **Green.** Implement `isLibraryMessage` with an exhaustive `switch` over `type` validating per-type string fields (`tab` in the LibraryTab set; `attach`/`detach` require both names; `skill-save` requires `name`/`description`/`body` strings + optional `allowedTools` is `string[]`), `default: return false`. Mirror `isWebviewMessage`'s structure exactly. Run -> green.
- [ ] **Commit:** `feat(extension): Library webview protocol + isLibraryMessage guard`.

### Task 11: Pure library render branches (cards, editor, picker, tab bar, ro lists)

**Files:** `packages/extension/src/library-render.ts`, `library-html.ts`, `test/library-render.test.ts`

`getLibraryHtml(scriptUri, styleUri, nonce, cspSource)` is the pure shell with the strict CSP (reuse `makeNonce`/`escapeHtml` from `html.ts`). `library-render.ts` holds pure HTML builders, testable without a DOM. The render functions emit class names; `library.css` owns the graphite colors (R2: fixed graphite, NOT `var(--vscode-*)`).

- [ ] **Red.** `library-render.test.ts` sketch:
  - `renderTabBar("skills")` contains all four tab labels, `data-tab="skills"`, and an `active` marker on Skills.
  - `renderSkillCard(card)` shows the name, `used by 1`, and the required-tools hint; goes `amber` at `usedBy.length >= 3`; shows a `plugin` source badge when `source === "plugin"`; `escapeHtml`s the description (a `<img onerror>` does not survive).
  - `renderSkillEditor(card, body)` renders the body, the literal label `declared requirements, not grants`, and the used-by chips; shows `updates all 3` at 3+; the Delete affordance is present (modal copy names the dependent roles).
  - `renderPickerRows([card], "Tester")` lists the skill with its DECLARED requirements and NO `Grant` flow (R5).
  - `renderRoleList([{name:"Tester",engineId:"copilot",skills:["run-tests"]}])` lists the name + engine, no editor.
  Run -> red.
- [ ] **Green.** Implement the builders. Every interpolation of skill-authored text (name, description, body, role names) goes through `escapeHtml`. Amber threshold `usedBy.length >= 3` emits an `amber` class. The editor's Required-tools header carries the literal `declared requirements, not grants`. Picker rows show the declared `allowedTools` hint and no grant diff. `getLibraryHtml` mirrors `getStageHtml`'s CSP/nonce exactly. Run -> green.
- [ ] **Commit:** `feat(extension): pure Library render branches (skill grid/editor/picker/tabs, escaped, graphite)`.

### Task 12: Library controller (route skill CRUD + attach/detach through config)

**Files:** `packages/extension/src/library-controller.ts`, `test/library-controller.test.ts`

`createLibrary(gw, onSnapshot)` is the testable heart. It holds the current snapshot, handles inbound `LibraryToHost` messages, and routes every WRITE through an injected `ConfigGateway` (the seam over `@maestro/config`'s serializer + node fs), so it is unit-tested against a fake gateway with zero disk I/O. All writes land in `.conductor/` via the serializer (R6): `skill-save`/`skill-create` write SKILL.md via `serializeSkill`; `attach`/`detach` mutate `role.skills` and rewrite role YAML via `serializeRole`; `skill-delete` removes the skill dir. After every write it reloads, rebuilds the reverse index, and pushes a fresh snapshot so used-by counts stay live.

- [ ] **Red.** `library-controller.test.ts` sketch (fake `ConfigGateway` recording calls):
  - `open-library` then `switch-library-tab` push snapshots; the second has `tab === "agents"`.
  - the open snapshot's skill carries `usedBy: [{roleName:"Tester",engineId:"copilot"}]` (computed from the loaded roles).
  - `skill-save` calls `gw.saveSkill` then re-`loadSkills` (refresh).
  - `attach-skill` with a new name -> `setRoleSkills("Tester", ["run-tests","openapi"])`; attaching an already-present name is idempotent (no duplicate).
  - `detach-skill` -> `setRoleSkills("Tester", [])`.
  - `skill-delete` -> `gw.deleteSkill("run-tests")` then refresh.
  Run -> red.
- [ ] **Green.** Define `ConfigGateway` (`loadSkills`, `loadRoles`, `loadTeams`, `saveSkill(manifest, body)`, `deleteSkill(name)`, `setRoleSkills(roleName, skills)`). Implement `createLibrary`: internal `tab` + caches; `handle` switches over `LibraryToHost` (exhaustive, `default: never`); reads push a snapshot; writes call the gateway, then reload + rebuild used-by + push. `attach-skill` appends the name if absent (dedup); `detach-skill` filters it out. The controller never imports node fs; the real gateway (a thin wrapper over `loadSkills`/`serializeSkill`/`serializeRole` + node fs) is built in Task 13. Run -> green.
- [ ] **Commit:** `feat(extension): Library controller routes skill CRUD + attach/detach through config (R6)`.

### Task 13: Library panel + webview client + activate wiring (openLibrary + skills-in-spawn)

**Files:** `library.ts`, `webview/library-main.ts`, `webview/library.css`, `extension.ts`, `build.mjs`, `package.json`. Tests: covered by Tasks 10-12 (pure pieces); the panel/client are glue verified by build + typecheck + manual F5.

- [ ] **Panel** `library.ts`: a `LibraryWebviewPanel` mirroring `StageWebviewPanel` (full-screen `createWebviewPanel`, `getLibraryHtml`, `onDidReceiveMessage` gated by `isLibraryMessage`, `post(snapshot)`), wiring messages into `createLibrary`'s `handle`, loading `dist/webview/library-main.js` + `dist/webview/library.css`.
- [ ] **Client** `webview/library-main.ts`: `acquireVsCodeApi`; on `{type:"library-state"}` render via the pure builders (tab bar + active tab body); delegate clicks: tab -> `switch-library-tab`; `+ New skill` -> `skill-create`; card click -> open editor; editor Save -> `skill-save`; Delete (after the in-webview confirm modal) -> `skill-delete`; picker row -> `attach-skill`; chip remove -> `detach-skill`. Post `{type:"open-library"}` on load.
- [ ] **CSS** `webview/library.css`: the graphite palette from design 01 (R2), NOT theme vars (card `#242424`, page `#1a1a1a`, amber `#f0a030`, blue `#4a9eff`).
- [ ] **build.mjs**: add a third esbuild entry `src/webview/library-main.ts -> dist/webview/library-main.js` (browser IIFE, same options as the stage webview) and copy `library.css`.
- [ ] **package.json**: contribute `{ "command": "maestro.openLibrary", "title": "Maestro: Open Library", "icon": "$(library)" }` + a `view/title` menu on `maestro.roster`.
- [ ] **extension.ts** (two additive deltas):
  1. In `setupConducting`, build the real `ConfigGateway` (over `@maestro/config` + node fs) and a `LibraryWebviewPanel`, store on `conducting`. Register `maestro.openLibrary` to reveal it (warn via `NO_FOLDER_MESSAGE` when no folder, like `openStage`).
  2. In `maestro.spawnAgent`, after `selectedRole` is resolved and BEFORE `cockpit.handle({type:"spawn"})`: `const skills = await loadSkills(repoRoot, fsReader); const spawnDescription = composeSpawnDescription(selectedRole, skills.bodies, description);` then spawn with `spawnDescription`. R3 minimal append, with the TSDoc note that P4 moves it into the adapters. Existing QuickPick / scaffold / error-surfacing untouched.
- [ ] Run `pnpm -F @maestro/extension typecheck && test && build` -> green; `dist/webview/library-main.js` + `library.css` emitted.
- [ ] **Commit:** `feat(extension): Library panel + Skills tab UI; resolve role.skills into spawn input (R3/R4/R6)`.

### Task 14: Full gate + roadmap status

**Files:** `docs/plans/2026-06-16-conducting-board-implementation/README.md` (status note only)

- [ ] Run the repo-root gate: `pnpm -r typecheck`, `pnpm -r test`, `pnpm -r build` -> all green (config grows by the parser/loader/index/compose/validator/serializer/scaffolder tests; extension grows by protocol/render/controller tests). Confirm both extension webview bundles (stage + library) emit.
- [ ] Add a "P3 (Reusable Skills) DONE" note to the roadmap status. Do not edit other phase docs.
- [ ] **Commit:** `docs: mark P3 (Reusable Skills) done; next is P4 (Soul + Tools + grant-gate)`.

---

## Self-Review

Map each design requirement to the task that delivers it, and confirm the seams.

- **`Role.skills?: string[]`, additive, back-compatible** (design 04 data-model delta): Task 1. Absent means no spawn change (Task 5 returns the task unchanged with no skills).
- **`SkillManifest` + `.conductor/skills/<name>/SKILL.md` (Claude Code convention)** (design 04 storage): Tasks 2-3.
- **Used-by reverse index / blast radius** (design 04 used-by index): Task 4; surfaced on the card and editor caution (Task 11) and computed live in the controller (Task 12).
- **Validator: skills must be string[]; unknown name is a WARNING mirroring Team.roles** (design 04 reference-by-name): Task 6. Unknown engine id stays a hard ERROR (R6).
- **Serialize/parse round-trip for role.skills + SKILL.md**: Task 7.
- **Scaffolder creates skills dir (seed example)** (design 04 one new directory): Task 8.
- **Minimal spawn-time append so skills are functional now, replaceable by P4** (R3): Task 5 + Task 13 wiring. The compose fn carries the TSDoc note that P4 absorbs it; logic is not duplicated.
- **Library shell + tab bar Agents | Teams | Skills | Discover** (R4, design 03 library): Tasks 10-13. Discover renders a "coming in P5" placeholder; Agents/Teams are read-only listings.
- **Skills tab in full: grid (used-by amber 3+, source badge, required-tools hint), editor (Procedure body, declared-requirements grid, used-by chips + "editing updates all N" caution, Delete blast-radius confirm), Add-skill picker** (design 04): Task 11 (render) + Task 12 (CRUD/attach) + Task 13 (panel/client).
- **Add-skill picker has NO grant-gate yet; declared requirements only** (R5): Task 11 `renderPickerRows` asserts no `Grant` flow; the amber Grant/Attach-without-granting lands in P4.
- **All writes through the M8 config serializer; `.conductor` symlink containment + KNOWN_ENGINE_IDS preserved** (R6): Task 12 (`ConfigGateway` over the serializer) + Task 3 reuses the containment-enforcing node reader + Task 6 keeps the engine-id hard ERROR.
- **`isWebviewMessage` invariant untouched; the Library adds its own `isLibraryMessage` guard + exhaustive switch**: Task 10. The cockpit `protocol.ts` is not modified.
- **Graphite palette, not theme vars** (R2): Tasks 11/13 `library.css`.
- **Escaping / webview message validation** (audit invariants): Task 11 (all skill text through `escapeHtml`) + Task 10 (`isLibraryMessage`).

**Deferred, on purpose, with owning phase:** grant-gate, `Role.soul?`, tools-grant model, rich anatomy editor behind the Agents tab, single ordered adapter preamble -> P4. Discover tab + adopt-from-`.claude/skills/` + provenance drift badge -> P5. Team-level skills union -> P4 (the `Team.skills?` type may be added back-compatibly in Task 1 as a noted stretch; the union behavior is not wired here).

**House invariants:** no em dashes anywhere in prose, code, comments, or commit messages; every task is red -> green -> commit with a vitest sketch; the full gate `pnpm -r {typecheck,test,build}` stays green at every commit.
