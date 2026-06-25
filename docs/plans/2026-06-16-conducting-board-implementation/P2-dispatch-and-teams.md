# Maestro P2: Dispatch and Teams Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> Part of the [roadmap](./README.md). UX spec: [02](../2026-06-16-conducting-board-design/02-conducting-board-and-lifecycle.md).

**Goal:** Replace the bare spawn InputBox with a real **Dispatch composer** rendered inside the P1 Conducting Board webview (graphite palette per R2), and wire **Launch Team** through that same surface. From the board a conductor can: pick a role preset from `.conductor/roles` (or type a free-text ad-hoc role), pick an engine (a `KNOWN_ENGINE_IDS` family plus an optional model variant), write a Goal (the "why", per R7), write a Task, and Dispatch a streaming card into the Working lane. They can also pick a team from `.conductor/teams` and launch every member at once. The old InputBox spawn survives as a fallback command.

**Architecture:** Keep the signature "pure brain, thin shell" split. The composer's option lists and the message it builds are pure, testable functions in `@maestro/cockpit` (a `composer.ts` selector over `Role[]`/`Team[]` plus the dispatch-message builder) with zero VS Code and zero DOM. The protocol gains one new `dispatch` `WebviewToHost` variant (carrying optional role overrides, engine id, model, goal, and the task) plus an optional `goal` on the existing `spawn` path that P1 introduced; `isWebviewMessage` is extended in lockstep and the controller's exhaustive `switch` dispatches it (registering an ad-hoc role then spawning with overrides, or spawning a preset with overrides). The extension provides the composer's data (load `.conductor/` once, hand the pure selector the resulting `Role[]`/`Team[]`), renders the composer panel inside the board webview, and wires the `+ New agent` and `Launch team` entry points. `Orchestrator.launchTeam` and the existing pure `team-picker.ts` / `teamQuickPickItems` are reused unchanged for the team path.

**Tech Stack:** TypeScript ESM (cockpit + config mirror core), VS Code extension API + `@types/vscode`, esbuild for the extension bundles, Vitest. Vanilla TS/DOM for the composer panel (no UI framework), graphite palette tokens from P1 (R2), not `var(--vscode-*)`.

**The one design bet (inherited):** the composer is a pure function of its option lists. Everything branchy (which engine families exist, which preset prefills which engine and instructions, whether Dispatch is enabled, what message a given form state produces) lives in pure `@maestro/cockpit` functions and the controller, all unit-tested. The webview panel is a dumb renderer that reads those pure outputs and posts the one `dispatch` message.

---

## Scope

**IN (this phase, P2):**
- A pure composer model in `@maestro/cockpit`: `composerOptions(roles, teams)` (preset chips with name + default engine + an instructions snippet; team rows; the engine family list `copilot`/`acp` with their model variants `claude-sonnet-4.5`/`gpt-5`/`o3`/`gemini`) and `buildDispatchMessage(form)` (the pure form-state to `WebviewToHost` builder, including the Dispatch-enabled predicate).
- Protocol: a new `dispatch` `WebviewToHost` variant `{ roleName?, newRoleName?, engineId?, model?, goal?, description }`, plus carrying `goal?` on the `spawn` variant (introduced in P1; P2 consumes and may add it if P1's exact shape differs, see the Task 2 note). `isWebviewMessage` extended; the controller's exhaustive `switch` handles `dispatch`.
- Core: a back-compatible dispatch path. `spawn(roleName, description, opts?)` gains an optional `{ goal?; engineId?; model? }` overrides bag; a new `dispatch(spec)` convenience registers an ad-hoc role (when only a free-text name is given) then spawns. The existing `spawn(roleName, description)` two-arg call keeps working unchanged.
- Extension: the composer panel inside the board webview (graphite, R2), the `+ New agent` and `Launch team` entry points, the data plumbing (load `.conductor/` roles + teams, hand them to the pure selector), the `maestro.launchTeam` command wired into the composer's Launch-team path, and the old InputBox `maestro.spawnAgent` kept as a fallback command.

**OUT (tracked, owning phase):**
- Reusable skills on a role / in the composer: **P3**.
- Editing the new role's anatomy beyond name, engine (id + model), goal, and instructions (soul, tools grants, attached skills): **P4**.
- Discover-sourced roles (foreign agents/plugins) appearing as composer presets: **P5**.
- The drawer, lanes, board chrome, and the `goal` field's own introduction on the spawn path: **P1** (P2 consumes the goal field; it does not own the board or the field's first appearance).
- Autonomy-per-dispatch override: deferred (the design lists it as an open question; P2 inherits autonomy from the preset role and leaves ad-hoc roles at a safe default, see Task 3).

---

## File Structure

```
packages/cockpit/                      EXISTING pure presenter (@maestro/cockpit)
  src/
    protocol.ts                        MODIFY: + "dispatch" variant; spawn gains goal?; isWebviewMessage + AGENT_ID handling
    composer.ts                        NEW pure: composerOptions(roles, teams) + buildDispatchMessage(form) + canDispatch(form)
    index.ts                           MODIFY: export the composer surface + the new protocol types
  test/
    composer.test.ts                   NEW: option building, preset prefill, engine families, message build, enabled predicate
    protocol.test.ts                   MODIFY (or NEW if absent): isWebviewMessage accepts dispatch, rejects malformed

packages/core/                         EXISTING orchestration brain (@maestro/core)
  src/
    orchestrator.ts                    MODIFY: spawn gains opts?; new dispatch(spec); back-compat preserved
    types.ts                           MODIFY: + DispatchSpec; Task gains goal?; spawn opts type
  test/
    orchestrator.dispatch.test.ts      NEW: spawn overrides, ad-hoc role registration, goal threading, back-compat

packages/extension/                    EXISTING VS Code extension (@maestro/extension)
  src/
    composer-data.ts                   NEW pure-ish: loadComposerData(repoRoot, fsReader) -> { roles, teams, errors } (thin over loadConductorDir)
    controller.ts                      MODIFY: handle "dispatch" (registerRole for ad-hoc, then spawn with overrides)
    render-composer.ts                 NEW pure: renderComposerHTML(options) graphite panel markup (no DOM, escaped)
    extension.ts                       MODIFY: wire + New agent / Launch team entry points; keep InputBox spawn as fallback
    webview/main.ts                    MODIFY: open/close composer, build + post the dispatch message
    webview/style.css (or board css)   MODIFY: graphite composer panel styles (R2 tokens from P1)
  test/
    composer-data.test.ts              NEW: maps loadConductorDir result to composer data; surfaces errors
    render-composer.test.ts            NEW: panel renders chips/pills/fields, escapes role + instructions text
    controller.dispatch.test.ts        NEW (or extend controller.test.ts): fake orch asserts dispatch routing
```

**Build order:** `@maestro/cockpit` and `@maestro/core` changes are pure and land first (protocol + composer selector, then the core dispatch path). `@maestro/extension` depends on both built `dist`s, so rebuild cockpit + core before the extension's esbuild step. The pure composer selector (cockpit) and the core dispatch path touch disjoint packages, so their implementers can run concurrently after the protocol `dispatch` shape is fixed (Task 1).

---

## Tasks

### Task 1: Protocol · the `dispatch` message + `spawn` goal, guarded

**Files:**
- Modify: `packages/cockpit/src/protocol.ts`
- Modify (or create): `packages/cockpit/test/protocol.test.ts`
- Modify: `packages/cockpit/src/index.ts`

**Context:** The board already speaks a rich `WebviewToHost` union with the runtime guard `isWebviewMessage` (an object with a known `type` literal, an `AGENT_ID_TYPES` set, and a per-type `switch`). The composer needs ONE new variant that does NOT carry an `agentId` (a dispatch creates an agent; it does not target one), so it must NOT be added to `AGENT_ID_TYPES`. Per R7, P1 adds an optional `goal` on the `spawn` path; P2 relies on it and threads it through `dispatch`. If P1's `spawn` shape already carries `goal?`, do not redefine it, just reference it; if this phase lands before that addition, add `goal?: string` to the `spawn` variant here (it is additive and back-compatible either way).

- [ ] **Step 1 (red): extend `protocol.test.ts`** to assert the new variant is accepted and malformed ones rejected:
```ts
import { describe, expect, it } from "vitest";
import { isWebviewMessage } from "../src/protocol.js";

describe("isWebviewMessage · dispatch", () => {
  it("accepts a preset dispatch (roleName + description)", () => {
    expect(isWebviewMessage({ type: "dispatch", roleName: "Test Author", description: "write tests" })).toBe(true);
  });
  it("accepts an ad-hoc dispatch (newRoleName + description) with engine + goal", () => {
    expect(
      isWebviewMessage({
        type: "dispatch",
        newRoleName: "Doc Writer",
        engineId: "copilot",
        model: "gpt-5",
        goal: "so the API is documented",
        description: "document the public API",
      }),
    ).toBe(true);
  });
  it("requires a string description and at least no wrong-typed fields", () => {
    expect(isWebviewMessage({ type: "dispatch", roleName: "X" })).toBe(false); // no description
    expect(isWebviewMessage({ type: "dispatch", description: 7 })).toBe(false); // bad description
    expect(isWebviewMessage({ type: "dispatch", description: "ok", engineId: 9 })).toBe(false); // bad optional
  });
  it("dispatch carries no agentId (not in AGENT_ID_TYPES)", () => {
    // A dispatch without agentId must still validate; the guard must not demand one.
    expect(isWebviewMessage({ type: "dispatch", roleName: "X", description: "y" })).toBe(true);
  });
});
```

- [ ] **Step 2: run it red** · `pnpm -F @maestro/cockpit test` → FAIL (dispatch unknown).

- [ ] **Step 3 (green): edit `packages/cockpit/src/protocol.ts`.** Add the variant to the union (keep `spawn`'s `goal?` if P1 added it; otherwise add it):
```ts
  | { type: "spawn"; roleName: string; description: string; goal?: string }
  | {
      type: "dispatch";
      /** A registered/preset role to spawn. Mutually informative with newRoleName. */
      roleName?: string;
      /** A free-text ad-hoc role name to register then spawn. */
      newRoleName?: string;
      /** Engine family id; must be a KNOWN_ENGINE_IDS member (validated host-side). */
      engineId?: string;
      /** Engine model variant, e.g. "claude-sonnet-4.5" | "gpt-5" | "o3" | "gemini". */
      model?: string;
      /** The "why" (so that ...); the faint italic card line. */
      goal?: string;
      /** The concrete task instruction. */
      description: string;
    }
```
Extend `isWebviewMessage`. `dispatch` is NOT added to `AGENT_ID_TYPES`. Add the case with optional-field type checks (a helper `isOptString = (v) => v === undefined || isString(v)` keeps it tidy):
```ts
    case "dispatch":
      return (
        isString(m["description"]) &&
        isOptString(m["roleName"]) &&
        isOptString(m["newRoleName"]) &&
        isOptString(m["engineId"]) &&
        isOptString(m["model"]) &&
        isOptString(m["goal"])
      );
```
The `spawn` case keeps `isString(roleName) && isString(description)` and additionally allows `isOptString(m["goal"])`.

- [ ] **Step 4: export from `index.ts`** if any new exported type is introduced (the union is already exported via `WebviewToHost`; no new export needed unless a `DispatchForm` type is shared, which Task 6 owns).

- [ ] **Step 5: run green** · `pnpm -F @maestro/cockpit test && pnpm -F @maestro/cockpit typecheck` → all pass.

- [ ] **Step 6: commit** · `feat(cockpit): add dispatch WebviewToHost variant + spawn goal; guard them`.

---

### Task 2: Cockpit · the pure composer selector

**Files:**
- Create: `packages/cockpit/src/composer.ts`
- Create: `packages/cockpit/test/composer.test.ts`
- Modify: `packages/cockpit/src/index.ts`

**Context:** The composer's option lists and message-building are pure. `composerOptions(roles, teams)` turns the loaded `Role[]` + `Team[]` into chips and rows the panel renders, and exposes the engine families (the two `KNOWN_ENGINE_IDS`, `copilot` and `acp`) each with their model variants. `buildDispatchMessage(form)` turns a form state into a `WebviewToHost` `dispatch` (or returns `null` when `canDispatch` is false). The instructions snippet is a short, single-line preview of the role's instructions (the design's "instructions snippet"). This file imports only `@maestro/core` types and `./protocol.js`; no VS Code, no DOM, no fs.

- [ ] **Step 1 (red): write `packages/cockpit/test/composer.test.ts`:**
```ts
import { describe, expect, it } from "vitest";
import type { Role, Team } from "@maestro/core";
import { composerOptions, buildDispatchMessage, canDispatch, ENGINE_FAMILIES } from "../src/composer.js";

const role = (over: Partial<Role> = {}): Role => ({
  name: "Test Author",
  instructions: "Write thorough unit tests for the changed code before implementing it.",
  engine: { id: "copilot" },
  autonomy: "auto-approve-safe",
  ...over,
});

describe("composerOptions", () => {
  it("maps roles to preset chips with name, default engine, and an instructions snippet", () => {
    const opts = composerOptions([role()], []);
    const chip = opts.presets[0]!;
    expect(chip.roleName).toBe("Test Author");
    expect(chip.engineId).toBe("copilot");
    expect(chip.instructionsSnippet.length).toBeLessThanOrEqual(120);
    expect(chip.instructionsSnippet).toContain("Write thorough");
  });
  it("carries the role model into the chip when present", () => {
    const opts = composerOptions([role({ engine: { id: "acp", model: "gemini" } })], []);
    expect(opts.presets[0]!.engineId).toBe("acp");
    expect(opts.presets[0]!.model).toBe("gemini");
  });
  it("maps teams to rows with a role-count summary", () => {
    const team: Team = { name: "Strike", roles: [role(), role({ name: "Reviewer" })] };
    const opts = composerOptions([], [team]);
    expect(opts.teams[0]!.name).toBe("Strike");
    expect(opts.teams[0]!.roleCount).toBe(2);
  });
  it("exposes the two known engine families with model variants", () => {
    const ids = ENGINE_FAMILIES.map((f) => f.id);
    expect(ids).toEqual(["copilot", "acp"]);
    const allModels = ENGINE_FAMILIES.flatMap((f) => f.models);
    expect(allModels).toEqual(expect.arrayContaining(["claude-sonnet-4.5", "gpt-5", "o3", "gemini"]));
  });
});

describe("canDispatch + buildDispatchMessage", () => {
  it("needs a role (preset or new) and a non-blank task", () => {
    expect(canDispatch({ description: "" })).toBe(false);
    expect(canDispatch({ roleName: "Test Author", description: "  " })).toBe(false);
    expect(canDispatch({ description: "do it" })).toBe(false); // no role at all
    expect(canDispatch({ roleName: "Test Author", description: "do it" })).toBe(true);
    expect(canDispatch({ newRoleName: "Doc Writer", description: "do it" })).toBe(true);
  });
  it("builds a preset dispatch message, trimming and dropping empty optionals", () => {
    const msg = buildDispatchMessage({ roleName: "Test Author", description: "  write tests  ", goal: "" });
    expect(msg).toEqual({ type: "dispatch", roleName: "Test Author", description: "write tests" });
  });
  it("builds an ad-hoc dispatch with engine, model, and goal", () => {
    const msg = buildDispatchMessage({
      newRoleName: "Doc Writer",
      engineId: "copilot",
      model: "gpt-5",
      goal: "so the API is documented",
      description: "document the public API",
    });
    expect(msg).toMatchObject({
      type: "dispatch",
      newRoleName: "Doc Writer",
      engineId: "copilot",
      model: "gpt-5",
      goal: "so the API is documented",
      description: "document the public API",
    });
  });
  it("returns null when the form cannot dispatch", () => {
    expect(buildDispatchMessage({ description: "" })).toBeNull();
  });
});
```

- [ ] **Step 2: run it red** · `pnpm -F @maestro/cockpit test` → FAIL (module not found).

- [ ] **Step 3 (green): write `packages/cockpit/src/composer.ts`.** Shape:
```ts
import type { Role, Team } from "@maestro/core";
import type { WebviewToHost } from "./protocol.js";

/** Engine families the composer offers. Ids are the two KNOWN_ENGINE_IDS; models are the variants shown as a second pill row. */
export const ENGINE_FAMILIES: ReadonlyArray<{ id: string; label: string; models: readonly string[] }> = [
  { id: "copilot", label: "Copilot", models: ["claude-sonnet-4.5", "gpt-5", "o3"] },
  { id: "acp", label: "ACP", models: ["gemini", "claude-sonnet-4.5"] },
];

export interface PresetChip {
  roleName: string;
  engineId: string;
  model?: string;
  /** One-line preview of role.instructions, capped (no newlines). */
  instructionsSnippet: string;
}
export interface TeamRow { name: string; roleCount: number; }
export interface ComposerOptions {
  presets: PresetChip[];
  teams: TeamRow[];
  engines: typeof ENGINE_FAMILIES;
}

/** A composer form's working state (what the panel holds before Dispatch). */
export interface DispatchForm {
  roleName?: string;
  newRoleName?: string;
  engineId?: string;
  model?: string;
  goal?: string;
  description: string;
}

const SNIPPET_CAP = 120;
function snippet(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > SNIPPET_CAP ? `${oneLine.slice(0, SNIPPET_CAP - 1)}…` : oneLine;
}

export function composerOptions(roles: readonly Role[], teams: readonly Team[]): ComposerOptions {
  return {
    presets: roles.map((r) => ({
      roleName: r.name,
      engineId: r.engine.id,
      ...(r.engine.model !== undefined ? { model: r.engine.model } : {}),
      instructionsSnippet: snippet(r.instructions),
    })),
    teams: teams.map((t) => ({ name: t.name, roleCount: t.roles.length })),
    engines: ENGINE_FAMILIES,
  };
}

export function canDispatch(form: DispatchForm): boolean {
  const hasRole =
    (typeof form.roleName === "string" && form.roleName.trim() !== "") ||
    (typeof form.newRoleName === "string" && form.newRoleName.trim() !== "");
  return hasRole && form.description.trim() !== "";
}

/** Build the dispatch message, dropping blank optionals. Returns null when the form is not dispatchable. */
export function buildDispatchMessage(form: DispatchForm): Extract<WebviewToHost, { type: "dispatch" }> | null {
  if (!canDispatch(form)) return null;
  const put = (v: string | undefined): string | undefined => {
    const t = v?.trim();
    return t ? t : undefined;
  };
  return {
    type: "dispatch",
    ...(put(form.roleName) ? { roleName: put(form.roleName) } : {}),
    ...(put(form.newRoleName) ? { newRoleName: put(form.newRoleName) } : {}),
    ...(put(form.engineId) ? { engineId: put(form.engineId) } : {}),
    ...(put(form.model) ? { model: put(form.model) } : {}),
    ...(put(form.goal) ? { goal: put(form.goal) } : {}),
    description: form.description.trim(),
  };
}
```
(`ENGINE_FAMILIES` is the single source of truth for the engine/model pills; the host validates the chosen `engineId` against `KNOWN_ENGINE_IDS` again in Task 4 so a tampered webview cannot inject an unknown engine, R6.)

- [ ] **Step 4: export from `index.ts`** · `composerOptions`, `buildDispatchMessage`, `canDispatch`, `ENGINE_FAMILIES`, and the types `ComposerOptions`, `PresetChip`, `TeamRow`, `DispatchForm`.

- [ ] **Step 5: run green** · `pnpm -F @maestro/cockpit test && pnpm -F @maestro/cockpit typecheck` → pass.

- [ ] **Step 6: commit** · `feat(cockpit): pure composer selector (options + dispatch-message builder)`.

---

### Task 3: Core · dispatch with overrides + ad-hoc role, back-compatible

**Files:**
- Modify: `packages/core/src/orchestrator.ts`
- Modify: `packages/core/src/types.ts`
- Create: `packages/core/test/orchestrator.dispatch.test.ts`

**Context:** Today `spawn(roleName, description)` requires a registered role and builds the `Task`. P2 needs three things, all additive: (1) a `goal` carried onto the agent so the board can show the why line (R7 added the field; here we thread it onto `Task`), (2) per-dispatch engine overrides (`engineId`, `model`) so a preset can be sent to a different engine without editing the role file, and (3) an ad-hoc role path: when only a free-text name is given, register a minimal role then spawn. The existing two-arg `spawn` MUST keep working unchanged (the InputBox fallback and `launchTeam` both call it).

- [ ] **Step 1 (red): write `packages/core/test/orchestrator.dispatch.test.ts`** (using the existing FakeEngineAdapter + fake workspace pattern from the current core tests):
```ts
import { describe, expect, it } from "vitest";
// import { makeOrchestrator, FakeEngineAdapter, ... } from existing test helpers

describe("Orchestrator.spawn overrides + dispatch", () => {
  it("keeps the two-arg spawn working (back-compat)", () => {
    const { orch } = setup(); // registers a "copilot" adapter + an "Implementer" role
    const a = orch.spawn("Implementer", "do the thing");
    expect(a.role.name).toBe("Implementer");
    expect(a.task.description).toBe("do the thing");
  });

  it("threads goal onto the task", () => {
    const { orch } = setup();
    const a = orch.spawn("Implementer", "do it", { goal: "so checkout cannot break" });
    expect(a.task.goal).toBe("so checkout cannot break");
  });

  it("applies an engine override without mutating the registered role", () => {
    const { orch, roles } = setup(); // also registers an "acp" adapter
    const a = orch.spawn("Implementer", "do it", { engineId: "acp", model: "gemini" });
    expect(a.role.engine).toEqual({ id: "acp", model: "gemini" });
    expect(roles.get("Implementer")!.engine.id).toBe("copilot"); // original untouched
  });

  it("dispatch registers an ad-hoc role then spawns it", () => {
    const { orch } = setup();
    const a = orch.dispatch({ newRoleName: "Doc Writer", engineId: "copilot", description: "write docs", goal: "so docs exist" });
    expect(a.role.name).toBe("Doc Writer");
    expect(a.role.engine.id).toBe("copilot");
    expect(a.task.goal).toBe("so docs exist");
    expect(orch.getAgent(a.id)).toBeDefined();
  });

  it("dispatch with a known roleName spawns that preset with overrides", () => {
    const { orch } = setup();
    const a = orch.dispatch({ roleName: "Implementer", model: "gpt-5", description: "do it" });
    expect(a.role.name).toBe("Implementer");
    expect(a.role.engine.model).toBe("gpt-5");
  });

  it("dispatch with neither roleName nor newRoleName throws", () => {
    const { orch } = setup();
    expect(() => orch.dispatch({ description: "do it" })).toThrow();
  });
});
```

- [ ] **Step 2: run it red** · `pnpm -F @maestro/core test` → FAIL.

- [ ] **Step 3 (green): edit `packages/core/src/types.ts`.** Add `goal?: string` to `Task`. Add the spawn opts + dispatch spec types:
```ts
export interface Task { id: string; description: string; roleName: string; goal?: string; }

/** Per-dispatch overrides applied without mutating the registered Role. */
export interface SpawnOptions { goal?: string; engineId?: string; model?: string; }

/** A single-agent dispatch: either a preset roleName or a free-text newRoleName, plus the task. */
export interface DispatchSpec {
  roleName?: string;
  newRoleName?: string;
  engineId?: string;
  model?: string;
  goal?: string;
  description: string;
}
```

- [ ] **Step 4 (green): edit `packages/core/src/orchestrator.ts`.** Widen `spawn` and add `dispatch`. `spawn` stays callable with two args:
```ts
spawn(roleName: string, description: string, opts: SpawnOptions = {}): Agent {
  const base = this.roles.get(roleName);
  if (!base) throw new Error(`Unknown role: ${roleName}`);
  // Apply engine overrides onto a COPY so the registered role is never mutated.
  const role: Role =
    opts.engineId !== undefined || opts.model !== undefined
      ? {
          ...base,
          engine: {
            id: opts.engineId ?? base.engine.id,
            ...(opts.model ?? base.engine.model ? { model: opts.model ?? base.engine.model } : {}),
          },
        }
      : base;
  const id = this.idGen();
  const task: Task = {
    id: `task-${id}`,
    description,
    roleName,
    ...(opts.goal !== undefined ? { goal: opts.goal } : {}),
  };
  const agent: Agent = { id, task, role, state: "preparing", log: [] };
  this.agents.set(id, agent);
  this.emitter.emit({ kind: "agent-added", agent });
  this.tryStart(agent);
  return agent;
}

/**
 * Convenience for the composer: a preset spawn with overrides, OR an ad-hoc role.
 * When newRoleName is given (and roleName is not), register a minimal role under
 * that name (engine defaulted to the chosen engineId or "copilot", a generic
 * instruction, manual-safe autonomy) then spawn it. registerRole is idempotent.
 */
dispatch(spec: DispatchSpec): Agent {
  if (spec.roleName) {
    return this.spawn(spec.roleName, spec.description, {
      ...(spec.goal !== undefined ? { goal: spec.goal } : {}),
      ...(spec.engineId !== undefined ? { engineId: spec.engineId } : {}),
      ...(spec.model !== undefined ? { model: spec.model } : {}),
    });
  }
  if (spec.newRoleName) {
    const role: Role = {
      name: spec.newRoleName,
      instructions: `Ad-hoc role dispatched from the Conducting Board. ${spec.description}`,
      engine: {
        id: spec.engineId ?? "copilot",
        ...(spec.model !== undefined ? { model: spec.model } : {}),
      },
      autonomy: "auto-approve-safe",
    };
    this.registerRole(role);
    return this.spawn(role.name, spec.description, spec.goal !== undefined ? { goal: spec.goal } : {});
  }
  throw new Error("dispatch requires either roleName or newRoleName");
}
```
Note: the engine override does NOT validate `engineId` against an allowlist here. Core trusts its caller; the `.conductor`-sourced allowlist (`KNOWN_ENGINE_IDS`) is enforced at the config/extension boundary in Task 4 (R6). An unknown engine still fails safely: `launch()` already calls `fail(agent, "No adapter for engine ...")` when no adapter is registered.

- [ ] **Step 5: run green** · `pnpm -F @maestro/core test && pnpm -F @maestro/core typecheck` → pass; the existing `launchTeam`/`spawn` tests still green (back-compat).

- [ ] **Step 6: commit** · `feat(core): spawn overrides (goal/engine/model) + dispatch(spec) ad-hoc role; back-compat`.

---

### Task 4: Extension · composer data (load `.conductor/` for the panel)

**Files:**
- Create: `packages/extension/src/composer-data.ts`
- Create: `packages/extension/test/composer-data.test.ts`

**Context:** The panel needs the loaded `Role[]` and `Team[]`. The extension already loads `.conductor/` via `loadConductorDir(repoRoot, fsReader)` (it returns `{ roles, teams, config, warnings, errors }`). This thin module wraps that into the shape `composerOptions` wants and surfaces config errors so the panel/host can warn, mirroring how `maestro.spawnAgent` and `maestro.launchTeam` already surface `loaded.errors`. It also enforces the engine allowlist guard helper used in Task 6: `isKnownEngineId(id)` over `KNOWN_ENGINE_IDS` from `@maestro/config` (R6), so a dispatch carrying a tampered `engineId` is refused before it reaches core. Keep this file injectable-fs and vscode-free so it unit-tests.

- [ ] **Step 1 (red): write `packages/extension/test/composer-data.test.ts`** with a fake `FsReader` (or a fake `loadConductorDir` injection). Assert:
```ts
// loadComposerData returns { roles, teams, errors } from a fake .conductor/.
it("maps loaded roles and teams through", async () => {
  const data = await loadComposerData(repoRoot, fakeReaderWithOneRoleOneTeam);
  expect(data.roles.map((r) => r.name)).toContain("Implementer");
  expect(data.teams.length).toBe(1);
  expect(data.errors).toEqual([]);
});
it("surfaces config errors", async () => {
  const data = await loadComposerData(repoRoot, fakeReaderWithBadRole);
  expect(data.errors.length).toBeGreaterThan(0);
});
it("isKnownEngineId guards the engine allowlist", () => {
  expect(isKnownEngineId("copilot")).toBe(true);
  expect(isKnownEngineId("acp")).toBe(true);
  expect(isKnownEngineId("evil")).toBe(false);
});
```

- [ ] **Step 2: run it red** · `pnpm -F @maestro/extension test` → FAIL.

- [ ] **Step 3 (green): write `packages/extension/src/composer-data.ts`:**
```ts
import { loadConductorDir, KNOWN_ENGINE_IDS, type FsReader } from "@maestro/config";
import type { Role, Team } from "@maestro/core";

export interface ComposerData {
  roles: Role[];
  teams: Team[];
  errors: Array<{ source: string; errors: string[] }>;
}

export async function loadComposerData(repoRoot: string, fs: FsReader): Promise<ComposerData> {
  const loaded = await loadConductorDir(repoRoot, fs);
  return { roles: loaded.roles, teams: loaded.teams, errors: loaded.errors };
}

/** The host-side allowlist gate: a dispatch engineId must be a known adapter (R6). */
export function isKnownEngineId(id: string): boolean {
  return KNOWN_ENGINE_IDS.has(id);
}
```
(If `KNOWN_ENGINE_IDS`/`FsReader` are not yet re-exported from `@maestro/config`'s index, this task also adds those exports there. The loader and types files already define them.)

- [ ] **Step 4: run green** · `pnpm -F @maestro/extension test && pnpm -F @maestro/extension typecheck` → pass.

- [ ] **Step 5: commit** · `feat(extension): composer-data loader over .conductor/ + engine allowlist gate`.

---

### Task 5: Controller · route the `dispatch` message

**Files:**
- Modify: `packages/extension/src/controller.ts`
- Modify (or create): `packages/extension/test/controller.dispatch.test.ts`

**Context:** The controller's `handle` switch is exhaustive (`never` default). Add a `dispatch` case. The controller already owns `OrchestratorLike`; extend it with the new `dispatch` method (and the widened three-arg `spawn`) so the fake orchestrator in tests can assert the call. For an ad-hoc dispatch the host does NOT need to call `registerRole` separately: core's `dispatch(spec)` does the register-then-spawn internally (Task 3), so the controller just forwards the spec. Engine-allowlist refusal (Task 4's `isKnownEngineId`) happens at the extension/data boundary before `handle` is reached, not in the pure controller; the controller stays a thin forwarder.

- [ ] **Step 1 (red): extend the controller test** with a fake orch recording `dispatch` calls:
```ts
it("routes a preset dispatch to orch.dispatch", () => {
  const { orch, calls } = fakeOrch(); // fakeOrch now records dispatch(spec)
  const cockpit = createCockpit(orch, () => {});
  cockpit.handle({ type: "dispatch", roleName: "Test Author", description: "write tests", goal: "so it is tested" });
  expect(calls).toContainEqual({ kind: "dispatch", spec: { roleName: "Test Author", description: "write tests", goal: "so it is tested" } });
});
it("routes an ad-hoc dispatch (newRoleName) to orch.dispatch", () => {
  const { orch, calls } = fakeOrch();
  const cockpit = createCockpit(orch, () => {});
  cockpit.handle({ type: "dispatch", newRoleName: "Doc Writer", engineId: "copilot", description: "docs" });
  expect(calls.at(-1)).toMatchObject({ kind: "dispatch", spec: { newRoleName: "Doc Writer", engineId: "copilot" } });
});
it("a throwing dispatch is routed to onError, not thrown", () => {
  const { orch } = fakeOrch();
  (orch.dispatch as any) = () => { throw new Error("Unknown role: Ghost"); };
  const onError = vi.fn();
  const cockpit = createCockpit(orch, () => {}, onError);
  cockpit.handle({ type: "dispatch", roleName: "Ghost", description: "x" });
  expect(onError).toHaveBeenCalledWith(expect.stringContaining("Unknown role"));
});
```

- [ ] **Step 2: run it red** · FAIL.

- [ ] **Step 3 (green): edit `packages/extension/src/controller.ts`.** Add to `OrchestratorLike`:
```ts
  spawn(roleName: string, description: string, opts?: { goal?: string; engineId?: string; model?: string }): Agent;
  dispatch(spec: {
    roleName?: string; newRoleName?: string; engineId?: string; model?: string; goal?: string; description: string;
  }): Agent;
```
(Reuse the core `SpawnOptions`/`DispatchSpec` types by importing them rather than re-declaring inline; the inline shapes above are illustrative.) Add the case before the exhaustive default, inside the existing try/catch so a throw routes to `onError`:
```ts
        case "dispatch": {
          const { type: _t, ...spec } = message; // drop the discriminant; pass the rest as the spec
          orch.dispatch(spec);
          break;
        }
```
The existing `spawn` case is unchanged (still works for the InputBox fallback). The `never` default still compiles because `dispatch` is now handled.

- [ ] **Step 4: run green** · `pnpm -F @maestro/extension test && pnpm -F @maestro/extension typecheck` → pass.

- [ ] **Step 5: commit** · `feat(extension): controller routes dispatch -> orch.dispatch (try/catch -> onError)`.

---

### Task 6: Extension · the composer panel (pure render + webview wiring)

**Files:**
- Create: `packages/extension/src/render-composer.ts`
- Create: `packages/extension/test/render-composer.test.ts`
- Modify: `packages/extension/src/webview/main.ts`
- Modify: the board webview CSS (the P1 board stylesheet; graphite tokens, R2)

**Context:** The composer is a centered overlay inside the P1 board webview (a dimmed board behind it). `renderComposerHTML(options)` is a pure HTML-string builder (no DOM) for the panel: the preset chips (name + engine chip + the instructions snippet), the new-role free-text field, the engine pills (family + model variants from `options.engines`), the Goal field labeled "Goal · the why (so that ...)", the Task field, and the Dispatch button stamped with the four-bars equalizer mark. ALL role names and instruction snippets are run through the existing `escapeHtml` (from `./html.js`) so a malicious `.conductor` role cannot inject markup (the same hard rule M4 set for engine output). The webview client opens the panel (on a `+ New agent` board affordance), reads the form, builds the message with the pure `buildDispatchMessage`, posts it, and closes the panel. The panel uses the graphite palette and tokens P1 defined (R2), not `var(--vscode-*)`.

- [ ] **Step 1 (red): write `packages/extension/test/render-composer.test.ts`:**
```ts
import { describe, expect, it } from "vitest";
import { renderComposerHTML } from "../src/render-composer.js";
import { composerOptions } from "@maestro/cockpit";

const opts = composerOptions(
  [{ name: "Test Author", instructions: "<b>write</b> tests", engine: { id: "copilot" }, autonomy: "auto-approve-safe" }],
  [{ name: "Strike", roles: [] }],
);

describe("renderComposerHTML", () => {
  it("renders a preset chip with the role name and engine", () => {
    const html = renderComposerHTML(opts);
    expect(html).toContain("Test Author");
    expect(html).toContain("copilot");
    expect(html).toContain('data-role="Test Author"');
  });
  it("renders engine pills for every family and model variant", () => {
    const html = renderComposerHTML(opts);
    expect(html).toContain('data-engine="copilot"');
    expect(html).toContain('data-engine="acp"');
    expect(html).toContain("claude-sonnet-4.5");
    expect(html).toContain("gemini");
  });
  it("renders the goal + task fields and a dispatch button", () => {
    const html = renderComposerHTML(opts);
    expect(html).toContain("so that");          // the Goal label hint
    expect(html).toContain('data-action="dispatch"');
    expect(html).toContain('data-action="new-role"'); // the free-text new-role field
  });
  it("escapes role names and instruction snippets (no markup injection)", () => {
    const evil = composerOptions(
      [{ name: "<img src=x>", instructions: "<script>alert(1)</script>", engine: { id: "copilot" }, autonomy: "manual" }],
      [],
    );
    const html = renderComposerHTML(evil);
    expect(html).not.toContain("<img src=x>");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;img");
  });
});
```

- [ ] **Step 2: run it red** · FAIL.

- [ ] **Step 3 (green): write `packages/extension/src/render-composer.ts`.** Pure string builder over `ComposerOptions`, escaping every role-sourced string via `escapeHtml`. Graphite classes (R2): the panel surface, chips, pills, fields, and the equalizer-marked Dispatch button. Carry the role name on `data-role`, the engine id on `data-engine`, the model on `data-model`, and use `data-action="dispatch" | "new-role" | "preset" | "engine"` hooks the client reads. No `var(--vscode-*)`; use the P1 graphite tokens.

- [ ] **Step 4 (green): edit `packages/extension/src/webview/main.ts`.** Add composer wiring without disturbing the existing card delegation:
  - Open the composer when the `+ New agent` board affordance is clicked (a `data-action="open-composer"` element P1's board exposes, or a small button this task adds to the board shell): render `renderComposerHTML(options)` into an overlay container. The `options` arrive from the host: the host posts the composer options alongside (or just before) opening; see Task 7 for the host message. Keep a module-local `composerForm: DispatchForm` updated as the user picks a preset (prefill engine + leave model selectable), types the new-role field, picks engine/model pills, and edits Goal/Task. Enable the Dispatch button via `canDispatch(form)`.
  - On Dispatch click: `const msg = buildDispatchMessage(form); if (msg) vscode.postMessage(msg);` then close the overlay and reset the form. On a preset chip click, set `form.roleName` and prefill `form.engineId` from the chip; on the new-role field, set `form.newRoleName` (and clear `roleName`). On Escape / backdrop click, close without posting.
  - The Launch-team affordance posts a host-driven command rather than a webview message (the team picker is a native QuickPick in Task 7); the board's `Launch team` button triggers `vscode.postMessage` only if you choose a webview-driven team path. Default: route Launch team through the existing `maestro.launchTeam` command (Task 7), so the webview's team button executes that command via a `{ type: ... }` is not needed; instead expose it as a board toolbar action that calls the command. (Keep the team path host-native to reuse `team-picker.ts` unchanged.)

- [ ] **Step 5 (green): graphite composer styles.** Add the panel/overlay/chip/pill/field/button styles to the P1 board stylesheet using the graphite tokens (R2). The overlay dims the board (semi-opaque graphite scrim); the panel is the `#242424`-family surface with `#3a3a3a` border per design doc 02; the selected preset chip gets a thin blue ring; the Dispatch button carries the blue `#4a9eff` equalizer mark as its only accent.

- [ ] **Step 6: build + verify** · `pnpm -F @maestro/cockpit -F @maestro/core build` then `pnpm -F @maestro/extension test && pnpm -F @maestro/extension typecheck && pnpm -F @maestro/extension build` → green; both bundles emit; `render-composer.test.ts` passes.

- [ ] **Step 7: commit** · `feat(extension): dispatch composer panel (pure render + graphite webview wiring)`.

---

### Task 7: Extension · entry points + Launch Team + InputBox fallback

**Files:**
- Modify: `packages/extension/src/extension.ts`
- Modify: `packages/extension/package.json` (a `maestro.newAgent` command + menu, if a board toolbar action is contributed)

**Context:** Final assembly. `activate()` already loads `.conductor/` (config) for `maxParallelAgents` and lazily reloads roles/teams in `maestro.spawnAgent` and `maestro.launchTeam`. P2 adds: (1) a `+ New agent` path that loads the composer data, posts it to the board webview, and reveals the composer (the host owns the data load; the webview owns the panel); (2) keeps `maestro.spawnAgent` (the InputBox) as a labelled fallback command; (3) wires `Launch team` to the existing `maestro.launchTeam` command, which already uses the pure `teamQuickPickItems` + `orch.launchTeam(team, description)`. The composer's preset/ad-hoc dispatch flows back as the `dispatch` message handled in Task 5; `launchTeam` stays host-native (QuickPick) so `team-picker.ts` is reused verbatim.

- [ ] **Step 1: a host command to open the composer with data.** Register `maestro.newAgent`:
```ts
vscode.commands.registerCommand("maestro.newAgent", async () => {
  if (!conducting) { void vscode.window.showWarningMessage(NO_FOLDER_MESSAGE); return; }
  const { repoRoot, stage } = conducting;
  const fsReader = await makeNodeFsReader();
  const { loadComposerData } = await import("./composer-data.js");
  const data = await loadComposerData(repoRoot, fsReader).catch(() => ({ roles: [], teams: [], errors: [] }));
  if (data.errors.length > 0) {
    const msgs = data.errors.map((e) => `${e.source}: ${e.errors.join("; ")}`).join("\n");
    void vscode.window.showWarningMessage(`Maestro: config errors in .conductor/:\n${msgs}`);
  }
  const { composerOptions } = await import("@maestro/cockpit");
  stage.reveal();
  stage.postComposer(composerOptions(data.roles, data.teams)); // new HostToWebview "composer-options" message
});
```
This requires a small `HostToWebview` addition (`{ type: "composer-options"; options: ComposerOptions }`) and a `StageWebviewPanel.postComposer(options)` method. Add the `composer-options` variant to `HostToWebview` in `protocol.ts` (host->webview is trusted, so it needs no `isWebviewMessage` guard, which only covers the webview->host direction). The webview's `message` listener (Task 6) handles it by stashing `options` for the next composer open. Update the webview `render`/message switch to remain exhaustive over `HostToWebview`.

- [ ] **Step 2: engine-allowlist enforcement at the boundary.** The `dispatch` message can name any `engineId`. Before forwarding to the cockpit, validate it host-side with `isKnownEngineId` (Task 4): wrap `stage`'s `onMessage` so a `dispatch` whose `engineId` is present and NOT known is refused with a warning toast and dropped (R6). Implement this in the existing `onMessage` closure passed to `StageWebviewPanel` (the same place `cockpit.handle` is called), since that is where untrusted webview messages enter the host. Keep the pure controller a thin forwarder; the guard lives here.

- [ ] **Step 3: keep the InputBox spawn as a fallback.** Leave `maestro.spawnAgent` as-is (it still loads roles, picks via QuickPick, prompts via InputBox, and calls `cockpit.handle({ type: "spawn", ... })`). Re-title its contribution to "Maestro: Spawn Agent (quick)" so the composer is the primary path and this is the fallback. The board's `+ New agent` affordance maps to `maestro.newAgent`; the Roster title `+` can keep pointing at `maestro.spawnAgent` (fallback) or be repointed at `maestro.newAgent` (choose the composer as primary; document the choice in the README).

- [ ] **Step 4: Launch Team wiring.** `maestro.launchTeam` already exists and is correct (QuickPick over `teamQuickPickItems`, InputBox for the shared description, `orch.launchTeam(selectedTeam, description)` which drops every member into Working at once). P2 only ensures the board exposes a `Launch team` affordance that runs this command (a contributed `view/title` or board toolbar action). No new team-launch logic; reuse verbatim. If a shared team goal is desired, pass it through the same InputBox prompt or a second optional prompt; `launchTeam` threads the description onto each member (the shared goal can ride the description, since `launchTeam` has no per-member goal slot yet, which is acceptable for this slice and noted in Self-Review).

- [ ] **Step 5: manifest.** Add `maestro.newAgent` to `contributes.commands` (title "Maestro: New Agent") and, if contributing a board toolbar, the `view/title` menu entries. Ensure `maestro.launchTeam` is already contributed (it is, from M8/Phase 2).

- [ ] **Step 6: typecheck + build + the full gate** · `pnpm -r build` then `pnpm -F @maestro/extension typecheck && pnpm -F @maestro/extension build` → both bundles emit; the webview's `HostToWebview` switch is exhaustive.

- [ ] **Step 7: commit** · `feat(extension): + New agent composer entry + Launch Team wiring; keep InputBox fallback`.

---

### Task 8: Full gate + docs

**Files:**
- Modify: this plan's status (and the roadmap README phase row if it tracks status)

- [ ] **Step 1: run the repo-root gate:**
  - `pnpm -r typecheck` → clean across all packages.
  - `pnpm -r test` → core (+ dispatch tests), cockpit (+ composer + protocol tests), extension (+ composer-data + render-composer + controller dispatch tests) all green.
  - `pnpm -r build` → all packages build; the extension emits both bundles + CSS.
- [ ] **Step 2: update the roadmap** · mark P2 done in `README.md` (the phase table), noting packages touched and what is deferred to P3/P4/P5.
- [ ] **Step 3: commit** · `docs: mark P2 (dispatch and teams) DONE; next P3 (reusable skills)`.

---

## Self-Review (author checklist)

- **Design-doc coverage (02, Dispatch Composer + Launch a Team):**
  - Role preset chips from `.conductor/roles` (name, default engine, instructions snippet): `composerOptions` (Task 2) + `renderComposerHTML` (Task 6) + `loadComposerData` (Task 4). ✓
  - New-role free-text field: `DispatchForm.newRoleName` (Task 2), `data-action="new-role"` (Task 6), `dispatch` ad-hoc path (Task 3). ✓
  - Engine pills (families + model variants `claude-sonnet-4.5`/`gpt-5`/`o3`/`gemini`): `ENGINE_FAMILIES` (Task 2), rendered pills (Task 6). The family id rides `engine.id` (a `KNOWN_ENGINE_IDS` member); the variant rides `engine.model`, matching core's `Role.engine = { id, model? }`. ✓
  - Goal field (the "why", R7): `Task.goal` threaded by `spawn`/`dispatch` (Task 3), set by the composer (Task 6). P2 consumes the field P1 introduces; if P1 lands after this phase, Task 3 still adds `Task.goal` additively. ✓
  - Task field + Dispatch button (disabled until role + task): `canDispatch` (Task 2), enabled-state in the client (Task 6). On Dispatch a card lands in Working via the existing `agent-added` -> reducer path (no card-placement code needed here). ✓
  - Launch Team: reuses `Orchestrator.launchTeam` + `teamQuickPickItems` + the `maestro.launchTeam` command verbatim (Task 7); the board only adds an affordance that runs it. ✓
- **Seams honored:**
  - R2 (graphite palette, not `var(--vscode-*)`): the composer panel/overlay uses P1's graphite tokens (Task 6 styles). ✓
  - R7 (goal field added in P1, consumed here): P2 sets and threads `goal`; it does not redefine the board or the field's first home. ✓
  - R6 (engine allowlist, no `.conductor`-sourced commands): the host validates `dispatch.engineId` against `KNOWN_ENGINE_IDS` before forwarding (Task 4 helper, Task 7 boundary), so a tampered webview cannot inject an unknown engine. Core trusts its caller but still fails safe (no adapter -> error state). ✓
- **Invariants kept:**
  - `isWebviewMessage` updated for the new `dispatch` variant (and `spawn` goal), with per-field type checks; `dispatch` is intentionally NOT in `AGENT_ID_TYPES` because it targets no agent (Task 1). ✓
  - Exhaustive switches: the controller's `never` default still compiles because `dispatch` is handled (Task 5); the webview's `HostToWebview` switch stays exhaustive after adding `composer-options` (Task 7). ✓
  - Webview output escaped: every role-sourced string (name, instructions snippet) runs through `escapeHtml` (Task 6), matching the M4 hard rule. ✓
  - Back-compat: two-arg `spawn(roleName, description)` is unchanged, so `launchTeam` and the InputBox fallback keep working (Task 3 + the back-compat test). ✓
- **Deferred, on purpose (tracked):** reusable skills in the composer (P3); anatomy editing beyond name/engine/goal/instructions, the soul, and tool grants (P4); discover-sourced presets (P5); autonomy-per-dispatch (open question, inherited from preset, ad-hoc defaults to `auto-approve-safe`); per-member team goal slot (rides the shared description for this slice).
- **Type consistency:** `DispatchSpec`/`SpawnOptions` defined once in `@maestro/core/types.ts` and imported by the controller's `OrchestratorLike`; `DispatchForm` defined once in `@maestro/cockpit/composer.ts` and used by the webview client; the `dispatch` message shape is the single union member in `protocol.ts` that all three layers reference.
