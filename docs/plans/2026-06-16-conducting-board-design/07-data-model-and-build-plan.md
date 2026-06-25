# Data Model and Build Plan

_The engineering anchor: ties the drawn Conducting Board UX to the real Maestro codebase, defines the additive data-model deltas, and proposes a build order._

> Part of the [Conducting Board design reference](./README.md).

## Purpose and honesty contract

This file is the bridge between the visual prototype (built in Claude Design, documented in [02](./02-conducting-board-and-lifecycle.md) through 06) and the shipped TypeScript. Everything in the "current data model" section below is real and quoted verbatim. Everything in the "deltas" section is **design-forward**: additive, optional, back-compatible, and not yet in the code. Where a claim is aspirational it is marked "proposed" or "prototype-only". The goal is that a reader can tell, line by line, what exists today versus what the board drawings imply.

## 1. Package map

Eight packages, surveyed from `packages/*/src`. The split holds a strict pure-brain / thin-shell line: only `extension` imports `vscode`.

| Package | One-line responsibility |
| --- | --- |
| `@maestro/core` | Orchestration brain: the `Orchestrator`, the adapter contract (`adapter.ts`), the state machine, and the shared types (`types.ts`, `events.ts`, `workspace.ts`). |
| `@maestro/cockpit` | Pure presenter. The reducer (`reducer.ts`), the attention-first `selectState` (`select.ts`), and the host/webview message `protocol.ts`. No `vscode`, no DOM. |
| `@maestro/config` | `.conductor/` YAML roles and teams: `validator.ts`, `parser.ts`, `serializer.ts`, `loader.ts`, `scaffolder.ts`, plus `KNOWN_ENGINE_IDS` in `types.ts`. |
| `@maestro/conformance` | Shared adapter conformance suite (`suite.ts`) that every engine adapter must pass; Copilot and ACP both run it. |
| `@maestro/workspace` | Real git worktree isolation and merge robustness: `git-workspace-manager.ts` over `git-runner.ts` (the injectable shell seam). |
| `@maestro/adapter-copilot` | Spawns the `copilot` CLI per worktree (`adapter.ts`, `copilot-session.ts`); `args.ts` builds argv; `json-output.ts` is the opt-in structured-event path. |
| `@maestro/adapter-acp` | Generic ACP engine over hand-rolled JSON-RPC (`transport.ts`, `messages.ts`, `session.ts`, `async-queue.ts`); drives `gemini --acp --stdio` and any ACP-speaking engine. |
| `@maestro/extension` | The real VS Code extension. Wires `Orchestrator` + `GitWorkspaceManager` + adapters in `extension.ts`; `controller.ts` owns the cockpit; `roster.ts` (TreeView) + `stage.ts` (webview) + `team-picker.ts` are the UI host. |

## 2. The current data model (baseline)

These are the real shapes from `packages/core/src/types.ts`, quoted as they exist today. Everything in section 3 hangs additively off these.

```ts
/** A reusable worker template. */
export interface Role {
  name: string;
  instructions: string;
  engine: { id: string; model?: string };
  autonomy: "manual" | "auto-approve-safe" | "yolo";
}

/** A named group of roles that can be dispatched together. */
export interface Team {
  name: string;
  roles: Role[];
}
```

```ts
/** The lifecycle state of an agent, owned by the orchestrator. */
export type AgentState =
  | "preparing"
  | "working"
  | "awaiting-approval"
  | "done"
  | "error"
  | "stopped"
  | "merged"
  | "discarded"
  | "conflict"
  | "detached"             // process gone, worktree preserved
  | "merge-cleanup-failed" // code landed, cleanup failed; retryCleanup
  | "pr-created";          // PR opened, worktree released, branch kept (terminal)

/** What an engine adapter can do; drives UI graceful degradation. */
export interface Capabilities {
  streaming: boolean;
  structuredEvents: boolean;
  approvals: boolean;
  steerable: boolean;
}

/** Outcome of merging an agent's branch. */
export type MergeResult =
  | { status: "clean" }
  | { status: "conflict"; files: string[] };
```

Two facts that the deltas lean on heavily:

- `Role.engine.id` is validated against `KNOWN_ENGINE_IDS` (`new Set(["copilot", "acp"])`). An unknown id is an **error**, not a warning, because an adapter binary must never be sourced from config (`validator.ts`, Issue 28 / S9).
- `Team.roles` in YAML is a list of role-name **strings**; `validateTeam` resolves each name against the loaded roles map. An unknown name is a **warning** (the role file may not exist yet), not an error. This reference-by-name pattern is the template every new collection field below reuses.

## 3. Additive, design-forward deltas

All of the following are **proposed** and **optional**. The invariant: every existing role/team YAML, and the `DEFAULT_ROLE` fallback in `scaffolder.ts` (`{ name: "Implementer", engine: { id: "copilot" }, autonomy: "auto-approve-safe", ... }`), must validate **unchanged** when these keys are absent. New keys are read only when present.

### 3a. Role deltas

```ts
// PROPOSED, additive. Every field optional; absence === today's behavior.
export interface Role {
  name: string;
  instructions: string;
  engine: { id: string; model?: string };
  autonomy: "manual" | "auto-approve-safe" | "yolo";

  /** Soul name resolving .conductor/souls/<soul>.md. Identity + red lines. */
  soul?: string;

  /** Granular tool grant. Built-ins + MCP servers; read and write tracked apart. */
  tools?: ToolGrant;

  /** Skill names resolving .conductor/skills/<name>/SKILL.md. Reference-by-name. */
  skills?: string[];
}

export interface ToolGrant {
  /** Built-in capabilities the agent may use. */
  builtins?: {
    read?: ("Read" | "Search")[];
    /** Write-capable built-ins. OFF by default; must be granted explicitly. */
    write?: ("Edit" | "Run" | "Git")[];
  };
  /** Named MCP servers the agent may reach, each scoped read vs write. */
  mcp?: Array<{ server: string; read?: boolean; write?: boolean }>;
}
```

`soul`, every `tools` write entry, and every `skills` name resolve **by name**, exactly like `Team.roles` does today. An unknown skill name or soul name is a **warning** (the file may not exist yet), never a hard error, mirroring `validateTeam`. Write is off unless the YAML opts in.

### 3b. Team deltas

```ts
// PROPOSED, additive.
export interface Team {
  name: string;
  roles: Role[];          // unchanged; resolved by name today

  /** Skills unioned onto EVERY member at spawn. Team-wide capability grant. */
  skills?: string[];

  /** Charter name resolving .conductor/teams/<team>/charter.md. */
  charter?: string;
}
```

The **charter** is a tighten-only concept. Its red lines are unioned with each member soul's red lines; a charter can only add constraints, never relax a soul. This is a composition rule (see section 5), not a stored boolean on `Team`.

### 3c. SkillManifest (a separate object, NOT stored on Role)

A skill is a library object parsed from `SKILL.md` frontmatter. The Role carries only the **name**; the manifest is loaded and resolved separately, so the same skill can be reused across many roles and teams.

```ts
// PROPOSED. Parsed from .conductor/skills/<name>/SKILL.md frontmatter.
export interface SkillManifest {
  name: string;
  description: string;
  /** Tools this skill needs. Surfaces a grant GAP if the role lacks them. */
  allowedTools?: string[];
  /** Where it came from: "conductor" | "claude" | "github" | "copilot-plugin". */
  provenance?: string;
}
```

`allowedTools` is the seam for the permission check in section 6: attaching a skill never auto-grants the tools it lists.

## 4. Proposed `.conductor/` on-disk layout

The board's Library tabs (see [05]) read from a single directory. Skills mirror the Claude Code `.claude/skills/<name>/SKILL.md` convention so existing skill folders can be discovered (section 6c) and adopted.

```
.conductor/
  roles/<role>.yaml         # Role: name, instructions, engine, autonomy, + soul?/tools?/skills?
  teams/<team>.yaml         # Team: name, roles[], + skills?/charter?
  souls/<soul>.md           # identity + red lines, markdown
  skills/<name>/SKILL.md    # SkillManifest frontmatter + skill body (Claude convention)
  teams/<team>/charter.md   # red-lines union, tighten-only
  config.yaml               # OrchestratorConfig (maxParallelAgents, real today)
  .runtime/<agentId>.jsonl  # M7 persistence, real today
```

Only `roles/*.yaml`, `teams/*.yaml`, `config.yaml`, and `.runtime/*.jsonl` exist in the shipped scaffolder. The `souls/`, `skills/`, and `teams/<team>/charter.md` paths are **proposed** additions.

## 5. Composition at spawn

When an agent launches, the engine receives a system preamble assembled in this fixed order:

```
[ Soul ]  ->  [ Instructions ]  ->  [ Tools ]  ->  [ Skills ]  ->  [ Task ]
```

Rationale for the order: identity and red lines first so they frame everything; role instructions next; the granted tool surface and attached skills before the work; the concrete task last. **Soul red lines outrank task instructions.** If a task asks for something a red line forbids, the red line wins. This is a documented contract plus a preamble-construction concern. It is **not** a runtime enforcement engine; Maestro composes the text, the engine honors it.

Where the preamble is built today, and where the new segments slot in:

- **Copilot** (`adapter-copilot/src/args.ts`, `buildArgs`): today the argv is `["-C", workspace.path, "-p", task.description, "-s", "--no-ask-user", "--allow-all"]`. Note that `role.instructions` is **not** currently sent. The composition work threads Soul + Instructions + Tools + Skills + Task into the `-p` payload (or a prepended system message). This is a real, additive change to `buildArgs`.
- **ACP** (`adapter-acp/src/messages.ts` / `session.ts`, the `session/new` request): today `instructions` maps straight to `systemPrompt`. The composition work makes `systemPrompt` the assembled preamble instead of bare instructions, with the Task delivered as the first `user_turn`.

Doing this in both adapters (covered by the shared conformance suite) keeps the two engine families consistent.

## 6. The granular-permission seam

The single rule the board's anatomy editor and Discover flow ([05], [06]) must respect: **read and write are granted separately, and write is off by default.**

- **6a. Tool grants.** `ToolGrant` tracks `read` and `write` as distinct lists. A role with `Read`/`Search` and no `write` block can inspect but never mutate. Granting `Edit`, `Run`, or `Git` is an explicit, visible act in the anatomy editor.
- **6b. Skill grant gaps.** Attaching a skill whose `allowedTools` includes a tool the role has not been granted must **surface the gap** in the UI and require an explicit grant. Maestro never auto-grants a tool just because a skill wants it. The skill attaches in a "needs grant" state until the operator approves.
- **6c. Discover and adopt clamping.** Adopting a role, skill, or MCP server from the Discover surface clamps autonomy **down a notch** (`yolo` -> `auto-approve-safe`, `auto-approve-safe` -> `manual`) and **never** silently grants write or an MCP server that is not actually installed. An adopted-but-unavailable MCP server lands disabled with a visible warning.
- **6d. Engine id stays hard-allowlisted.** None of this loosens the existing discipline: `engine.id` is still checked against `KNOWN_ENGINE_IDS` and is never sourced from arbitrary config (`validator.ts`). Tools, skills, and souls are data the operator grants; the engine binary is not.

## 7. Build order (cheapest to hardest)

Ordered so each step is shippable and de-risks the next.

1. **(a) Reusable skills data model first.** Add `Role.skills?` and `Team.skills?` as pure additive fields that reuse the `Team.roles` reference-by-name resolution already in `validateTeam`. No new resolution machinery, no spawn changes yet. Lowest risk, highest leverage: it makes skills a first-class library object before any UI depends on it.
2. **(b) Soul and Tools fields plus composition-at-spawn.** Add `Role.soul?` and `Role.tools?`, then build the Soul -> Instructions -> Tools -> Skills -> Task preamble in both adapters (section 5). Rationale: the data is inert until something assembles it; this is where it becomes behavior, and the conformance suite guards both engines at once.
3. **(c) Discover and adopt scanners.** Read-only filesystem scanning of `.claude`, `.github`, `.conductor`, and `~/.copilot/installed-plugins`, feeding parsed candidates to the cockpit. No execution, no mutation. Rationale: pure read, easy to test, populates the Library and Discover tabs with real content.
4. **(d) Heavy UI surfaces.** The cockpit + extension webviews: board lanes, the four Library tabs, the anatomy editor, and the diff review screen. Rationale: largest surface, but it sits on stable data once (a) through (c) land, so it is mostly presentation over a known model.
5. **(e) Granular tool-permission enforcement and adopt clamping.** Wire `ToolGrant` read/write separation, skill grant-gap prompts, and the adopt autonomy clamp (section 6) into both the editor and the spawn path. Rationale: hardest because it is cross-cutting (config + cockpit + adapters) and security-sensitive; it lands last so it can enforce against a model that is already proven.

## 8. Real today versus drawn

| Real (shipped, M1-M9) | Drawn only (this reference) |
| --- | --- |
| Worktree isolation + merge robustness (`@maestro/workspace`). See `2026-06-14-maestro-workspace-manager.md`, `2026-06-14-maestro-m9-merge-robustness.md`. | The Conducting Board visual UI: lanes, attention ordering, the live stage layout ([02], [03]). |
| Approvals / steering / send-back (M6). See `2026-06-14-maestro-m6-approvals-steering.md`. | Enriched anatomy with `soul` / `tools` / `skills` on a Role ([04], [05]). |
| Persistence + detached recovery (M7), `detached` state + JSONL. See `2026-06-14-maestro-m7-persistence.md`. | Reusable skills as a library object (`SkillManifest`, Library tabs) ([05]). |
| `.conductor/` YAML roles and teams (M8). See `2026-06-14-maestro-m8-yaml-config.md`. | Discover and adopt (scanning `.claude` / `.github` / `~/.copilot`, clamped adoption) ([06]). |
| Copilot and ACP adapters + shared conformance suite (M2 / M5). See `2026-06-14-maestro-copilot-adapter.md`, `2026-06-14-maestro-m5-acp-adapter.md`. | The rich diff/merge review screen ([04], [06]). |
| Thin cockpit + extension shell (M4). See `2026-06-14-maestro-m4-vscode-cockpit.md`, `2026-06-14-maestro-core-orchestrator.md`. | Composition-at-spawn preamble (Soul -> Instructions -> Tools -> Skills -> Task) as a wired behavior. |

## 9. Cross-links

- [02 · Conducting Board and lifecycle](./02-conducting-board-and-lifecycle.md): the lanes that render `AgentState`; the lifecycle these deltas must not break.
- [03 · The live stage](./03-the-live-stage.md): where the spawn preamble (section 5) and steering surface during a run.
- [04 · Agent anatomy](./04-agent-anatomy.md): the editor for `soul` / `tools` / `skills` and the diff/merge review screen.
- [05 · The Library](./05-the-library.md): the four tabs over `.conductor/` (section 4) and `SkillManifest` as a reusable object.
- [06 · Discover and adopt](./06-discover-and-adopt.md): the read-only scanners (build step c) and the adopt clamping (section 6c).
