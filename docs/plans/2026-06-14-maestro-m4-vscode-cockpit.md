# Maestro M4: VS Code Cockpit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a real, installable VS Code extension that is the Maestro cockpit: a Roster TreeView + a Stage webview, wired to the real `Orchestrator` + `GitWorkspaceManager` + `CopilotAdapter`, delivering the full loop — spawn an agent, watch it stream in an isolated worktree, review its diff, and Merge or Discard.

**Architecture:** Keep the project's signature "pure brain, thin shell" split. A new pure package `@maestro/cockpit` holds the presenter: a reducer `(model, OrchestratorEvent) => model`, a derivation `selectState(model) => CockpitState`, and the typed host↔webview message protocol — all unit-tested, zero VS Code. A new `@maestro/extension` package is the thin, real VS Code shell: a `createCockpit` controller (unit-tested with a fake orchestrator), a `RosterTreeDataProvider`, a `StageWebviewPanel`, a vanilla-TS webview client (rendered from typed state snapshots), and an `activate()` that assembles everything. esbuild bundles both the extension host (CJS) and the webview client (browser IIFE); tsc is typecheck-only for the extension.

**Tech Stack:** TypeScript ESM (cockpit, mirrors core), VS Code extension API + `@types/vscode`, esbuild for the extension bundles, Vitest. Vanilla TS/DOM for the webview (no UI framework). The UI is a pure function of agent state.

**The one design bet (inherited):** the UI is a pure function of `OrchestratorEvent`s. Everything stateful and branchy lives in `@maestro/cockpit` (reducer + selectors) and the `createCockpit` controller, both fully unit-tested. The VS Code-specific classes are dumb adapters over those pure pieces.

**Scope (thin vertical slice — confirmed):**
- IN: Roster TreeView, Stage webview, real Copilot adapter on real git worktrees, spawn → live output → done → review diff → Merge / Discard, the `conflict` and `error` terminal cards, parallel cards + attention float-up, a Stop action while working.
- OUT (tracked, deferred): approval buttons and steering box (Copilot is `approvals:false`/`steerable:false` — both would be dead UI; the protocol carries the messages for a future engine), send-back-with-feedback, `.conductor/` YAML role/team loading (seed one default role), persistence/rehydration across reload, conflict-resolve-in-editor, `@vscode/test-electron` integration harness (verify the shell by build + manual F5).

---

## File Structure

```
packages/cockpit/                      NEW pure presenter package (@maestro/cockpit)
  package.json                         ESM, dep @maestro/core
  tsconfig.json                        mirrors core (strict + noUncheckedIndexedAccess, NodeNext)
  tsconfig.build.json                  rootDir src
  vitest.config.ts
  src/
    index.ts                           public API
    protocol.ts                        CardVM, CockpitState, HostToWebview, WebviewToHost
    reducer.ts                         CockpitModel, initialModel, reduce, setFocus
    select.ts                          selectState (ordering: attention-first, then id)
  test/
    reducer.test.ts
    select.test.ts
    index.test.ts                      export smoke

packages/extension/                    NEW VS Code extension (@maestro/extension)
  package.json                         the VS Code manifest + esbuild build scripts
  tsconfig.json                        moduleResolution bundler, noEmit (esbuild emits)
  build.mjs                            esbuild: host (CJS) + webview (browser IIFE)
  .vscodeignore
  vitest.config.ts
  src/
    controller.ts                      createCockpit(orch, onState, onError) — pure, fake-orch testable
    roster.ts                          RosterTreeDataProvider + cardToTreeItem + cardIcon
    stage.ts                           StageWebviewPanel + getStageHtml (pure)
    html.ts                            getStageHtml(scriptUri, styleUri, nonce, cspSource) + escapeHtml + nonce
    render.ts                          renderCardHTML(card) — pure HTML string builder (shared shape, no DOM dep)
    extension.ts                       activate(): wires workspace+adapter+orchestrator+controller+roster+stage+commands
    webview/
      main.ts                          vanilla-TS client: acquireVsCodeApi, on message -> render, delegate clicks
      style.css                        cockpit styles (VS Code theme vars)
  test/
    controller.test.ts                 fake orchestrator -> asserts message dispatch + state push
    roster.test.ts                     cardToTreeItem / cardIcon mapping (no live VS Code)
    html.test.ts                       getStageHtml CSP/nonce/script tag; renderCardHTML branches
  README.md                            how to F5 / package the extension
```

**Build order across packages:** `@maestro/cockpit` (Phase A) is pure and depends only on core. `@maestro/extension` (Phase B) depends on cockpit + core + workspace + adapter-copilot. esbuild bundles the extension from the workspace packages' built `dist`, so the four library packages must `build` before the extension's esbuild step.

**Parallelism note (honest):** Phase A (cockpit) and the Phase B scaffold (B0) touch disjoint files in disjoint packages, so their *implementers* can run concurrently after the shared protocol types exist. Everything else is sequential because it shares files within a package and each task relinks workspace deps. Per task we still dispatch the two reviewers (spec, then quality) — that is the parallel-agent leverage.

---

## Phase A — `@maestro/cockpit` (pure presenter)

### Task A0: Scaffold the cockpit package

**Files:**
- Create: `packages/cockpit/package.json`
- Create: `packages/cockpit/tsconfig.json`
- Create: `packages/cockpit/tsconfig.build.json`
- Create: `packages/cockpit/vitest.config.ts`
- Create: `packages/cockpit/src/index.ts`
- Test: `packages/cockpit/test/index.test.ts`

- [ ] **Step 1: Write the package files** (mirror `packages/workspace` exactly, swap the name).

`packages/cockpit/package.json`:
```json
{
  "name": "@maestro/cockpit",
  "version": "0.0.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "build": "tsc -p tsconfig.build.json"
  },
  "dependencies": {
    "@maestro/core": "workspace:*"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

`packages/cockpit/tsconfig.json` — identical to `packages/workspace/tsconfig.json`.
`packages/cockpit/tsconfig.build.json` — identical to `packages/workspace/tsconfig.build.json`.
`packages/cockpit/vitest.config.ts` — identical to `packages/workspace/vitest.config.ts`.

`packages/cockpit/src/index.ts` (stub, expanded in A4):
```ts
export const MAESTRO_COCKPIT_VERSION = "0.0.0";
```

`packages/cockpit/test/index.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { MAESTRO_COCKPIT_VERSION } from "../src/index.js";

describe("@maestro/cockpit", () => {
  it("exposes a version", () => {
    expect(MAESTRO_COCKPIT_VERSION).toBe("0.0.0");
  });
});
```

- [ ] **Step 2: Install + verify.** Run `pnpm install` at the repo root (links the new workspace package). Then:
  - Run: `pnpm -F @maestro/cockpit test` → Expected: 1 passing.
  - Run: `pnpm -F @maestro/cockpit typecheck` → Expected: clean.
  - Run: `pnpm -F @maestro/cockpit build` → Expected: emits `dist/index.js`.

- [ ] **Step 3: Commit** — `feat(cockpit): scaffold @maestro/cockpit pure presenter package`.

---

### Task A1: Protocol types (CardVM, CockpitState, messages)

**Files:**
- Create: `packages/cockpit/src/protocol.ts`
- Test: covered by reducer/select tests (types only; no standalone test needed).

- [ ] **Step 1: Write `packages/cockpit/src/protocol.ts`:**
```ts
import type { AgentState } from "@maestro/core";

/** A single agent's renderable state in the cockpit. Pure data; the UI renders it verbatim. */
export interface CardVM {
  id: string;
  roleName: string;
  engineId: string;
  state: AgentState;
  /** Capped, accumulated `output` text the engine streamed. */
  output: string;
  summary?: string;
  diff?: { files: string[]; patch: string };
  diffError?: string;
  conflictFiles?: string[];
  error?: string;
  pendingApprovalId?: string;
  /** True when this card needs a human decision (awaiting-approval, done, error, conflict). */
  attention: boolean;
}

/** The whole cockpit, a pure function of orchestrator events. `cards` are pre-ordered. */
export interface CockpitState {
  cards: CardVM[];
  focusedId?: string;
}

/** Messages the extension host sends INTO the webview. */
export type HostToWebview = { type: "state"; state: CockpitState };

/** Messages the webview sends OUT to the extension host. */
export type WebviewToHost =
  | { type: "ready" }
  | { type: "focus"; agentId: string }
  | { type: "spawn"; roleName: string; description: string }
  | { type: "steer"; agentId: string; input: string }
  | { type: "approve"; agentId: string; approvalId: string; decision: "allow" | "deny" }
  | { type: "stop"; agentId: string }
  | { type: "merge"; agentId: string }
  | { type: "discard"; agentId: string };
```

- [ ] **Step 2: Typecheck** — `pnpm -F @maestro/cockpit typecheck` → clean.
- [ ] **Step 3: Commit** — `feat(cockpit): host<->webview protocol + CardVM/CockpitState types`.

---

### Task A2: The reducer (events → model)

**Files:**
- Create: `packages/cockpit/src/reducer.ts`
- Test: `packages/cockpit/test/reducer.test.ts`

**Context:** `OrchestratorEvent` is one of `agent-added` / `agent-updated` (both carry the full `Agent`) / `agent-event` (carries `agentId` + an `AgentEvent`). `output` text only arrives via `agent-event` with `event.kind === "output"`; state/summary/diff/error/conflict are reflected on the `Agent` the orchestrator passes in `agent-updated`. So the reducer accumulates `output` incrementally and re-derives the rest from the `Agent` on each update, preserving the accumulated output string. Cap output to the last 16000 chars.

- [ ] **Step 1: Write the failing test** `packages/cockpit/test/reducer.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import type { Agent, OrchestratorEvent } from "@maestro/core";
import { initialModel, reduce, setFocus } from "../src/reducer.js";

function agent(over: Partial<Agent> = {}): Agent {
  return {
    id: "a1",
    task: { id: "t1", description: "do it", roleName: "Implementer" },
    role: { name: "Implementer", instructions: "", engine: { id: "copilot" }, autonomy: "auto-approve-safe" },
    state: "preparing",
    log: [],
    ...over,
  };
}
const added = (a: Agent): OrchestratorEvent => ({ kind: "agent-added", agent: a });
const updated = (a: Agent): OrchestratorEvent => ({ kind: "agent-updated", agent: a });
const out = (id: string, text: string): OrchestratorEvent => ({ kind: "agent-event", agentId: id, event: { kind: "output", text } });

describe("reduce", () => {
  it("agent-added creates a card", () => {
    const m = reduce(initialModel(), added(agent()));
    const c = m.cards.get("a1")!;
    expect(c.roleName).toBe("Implementer");
    expect(c.engineId).toBe("copilot");
    expect(c.state).toBe("preparing");
    expect(c.attention).toBe(false);
    expect(c.output).toBe("");
  });

  it("accumulates output across agent-event(output)", () => {
    let m = reduce(initialModel(), added(agent()));
    m = reduce(m, out("a1", "hello "));
    m = reduce(m, out("a1", "world"));
    expect(m.cards.get("a1")!.output).toBe("hello world");
  });

  it("agent-updated re-derives state but preserves accumulated output", () => {
    let m = reduce(initialModel(), added(agent()));
    m = reduce(m, out("a1", "log line\n"));
    m = reduce(m, updated(agent({ state: "working" })));
    const c = m.cards.get("a1")!;
    expect(c.state).toBe("working");
    expect(c.output).toBe("log line\n");
  });

  it("marks attention on done/error/conflict/awaiting-approval and captures their fields", () => {
    let m = reduce(initialModel(), added(agent()));
    m = reduce(m, updated(agent({ state: "done", summary: "all done", diff: { files: ["a.ts"], patch: "P" } })));
    const c = m.cards.get("a1")!;
    expect(c.attention).toBe(true);
    expect(c.summary).toBe("all done");
    expect(c.diff).toEqual({ files: ["a.ts"], patch: "P" });
  });

  it("captures conflict files and error tail", () => {
    let m = reduce(initialModel(), added(agent()));
    m = reduce(m, updated(agent({ state: "conflict", conflict: { files: ["x.ts"] } })));
    expect(m.cards.get("a1")!.conflictFiles).toEqual(["x.ts"]);
    m = reduce(m, updated(agent({ state: "error", error: "boom" })));
    expect(m.cards.get("a1")!.error).toBe("boom");
  });

  it("caps output to the last 16000 chars", () => {
    let m = reduce(initialModel(), added(agent()));
    m = reduce(m, out("a1", "x".repeat(20000)));
    expect(m.cards.get("a1")!.output.length).toBe(16000);
  });

  it("ignores output for an unknown agent", () => {
    const m = reduce(initialModel(), out("ghost", "nope"));
    expect(m.cards.size).toBe(0);
  });

  it("setFocus records the focused id immutably", () => {
    const m0 = reduce(initialModel(), added(agent()));
    const m1 = setFocus(m0, "a1");
    expect(m1.focusedId).toBe("a1");
    expect(m0.focusedId).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails** — `pnpm -F @maestro/cockpit test` → FAIL (module not found).

- [ ] **Step 3: Write `packages/cockpit/src/reducer.ts`:**
```ts
import type { Agent, AgentState, OrchestratorEvent } from "@maestro/core";
import type { CardVM } from "./protocol.js";

/** Max accumulated output chars kept per agent (keeps state snapshots bounded). */
export const OUTPUT_CAP = 16_000;

/** Authoritative internal state. `selectState` derives the ordered CockpitState from it. */
export interface CockpitModel {
  cards: Map<string, CardVM>;
  focusedId?: string;
}

export function initialModel(): CockpitModel {
  return { cards: new Map() };
}

function needsAttention(state: AgentState): boolean {
  return (
    state === "awaiting-approval" || state === "done" || state === "error" || state === "conflict"
  );
}

function cardFromAgent(agent: Agent, prevOutput: string): CardVM {
  return {
    id: agent.id,
    roleName: agent.role.name,
    engineId: agent.role.engine.id,
    state: agent.state,
    output: prevOutput,
    summary: agent.summary,
    diff: agent.diff,
    diffError: agent.diffError,
    conflictFiles: agent.conflict?.files,
    error: agent.error,
    pendingApprovalId: agent.pendingApprovalId,
    attention: needsAttention(agent.state),
  };
}

function appendOutput(prev: string, text: string): string {
  const next = prev + text;
  return next.length > OUTPUT_CAP ? next.slice(next.length - OUTPUT_CAP) : next;
}

/** Pure: fold one orchestrator event into a new model (never mutates the input). */
export function reduce(model: CockpitModel, event: OrchestratorEvent): CockpitModel {
  const cards = new Map(model.cards);
  switch (event.kind) {
    case "agent-added":
      cards.set(event.agent.id, cardFromAgent(event.agent, ""));
      break;
    case "agent-updated": {
      const prev = cards.get(event.agent.id);
      cards.set(event.agent.id, cardFromAgent(event.agent, prev?.output ?? ""));
      break;
    }
    case "agent-event": {
      const prev = cards.get(event.agentId);
      if (prev && event.event.kind === "output") {
        cards.set(event.agentId, { ...prev, output: appendOutput(prev.output, event.event.text) });
      }
      break;
    }
  }
  return { ...model, cards };
}

/** Pure: set the focused agent. */
export function setFocus(model: CockpitModel, agentId: string): CockpitModel {
  return { ...model, focusedId: agentId };
}
```

- [ ] **Step 4: Run tests** — `pnpm -F @maestro/cockpit test` → all pass.
- [ ] **Step 5: Commit** — `feat(cockpit): pure reducer (events -> model) with output cap + attention`.

---

### Task A3: Selector (model → ordered CockpitState)

**Files:**
- Create: `packages/cockpit/src/select.ts`
- Test: `packages/cockpit/test/select.test.ts`

**Context:** The roster's hard rule is "never go hunting": cards needing a decision float to the top. `selectState` sorts `attention: true` first, then by `id` for stable ordering, and returns the immutable `CockpitState` the webview/roster render.

- [ ] **Step 1: Write the failing test** `packages/cockpit/test/select.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import type { Agent, OrchestratorEvent } from "@maestro/core";
import { initialModel, reduce } from "../src/reducer.js";
import { selectState } from "../src/select.js";

function agent(id: string, state: Agent["state"]): Agent {
  return {
    id, task: { id: `t-${id}`, description: "x", roleName: "Implementer" },
    role: { name: "Implementer", instructions: "", engine: { id: "copilot" }, autonomy: "auto-approve-safe" },
    state, log: [],
  };
}
const add = (a: Agent): OrchestratorEvent => ({ kind: "agent-added", agent: a });

describe("selectState", () => {
  it("floats attention cards to the top, stable by id otherwise", () => {
    let m = initialModel();
    m = reduce(m, add(agent("a3", "working")));
    m = reduce(m, add(agent("a1", "done")));     // attention
    m = reduce(m, add(agent("a2", "working")));
    const ids = selectState(m).cards.map((c) => c.id);
    expect(ids).toEqual(["a1", "a2", "a3"]); // a1 (attention) first; then a2,a3 by id
  });

  it("passes focusedId through", () => {
    const m = reduce(initialModel(), add(agent("a1", "working")));
    expect(selectState({ ...m, focusedId: "a1" }).focusedId).toBe("a1");
  });
});
```

- [ ] **Step 2: Run it to confirm it fails** — FAIL (module not found).

- [ ] **Step 3: Write `packages/cockpit/src/select.ts`:**
```ts
import type { CardVM, CockpitState } from "./protocol.js";
import type { CockpitModel } from "./reducer.js";

function compareCards(a: CardVM, b: CardVM): number {
  if (a.attention !== b.attention) return a.attention ? -1 : 1;
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

/** Pure: derive the ordered, renderable CockpitState from the model. */
export function selectState(model: CockpitModel): CockpitState {
  const cards = [...model.cards.values()].sort(compareCards);
  return model.focusedId === undefined ? { cards } : { cards, focusedId: model.focusedId };
}
```

- [ ] **Step 4: Run tests** — `pnpm -F @maestro/cockpit test` → all pass.
- [ ] **Step 5: Commit** — `feat(cockpit): selectState ordering (attention-first, stable by id)`.

---

### Task A4: Public API + export smoke

**Files:**
- Modify: `packages/cockpit/src/index.ts`
- Modify: `packages/cockpit/test/index.test.ts`

- [ ] **Step 1: Replace `packages/cockpit/src/index.ts`:**
```ts
export const MAESTRO_COCKPIT_VERSION = "0.0.0";

export type { CardVM, CockpitState, HostToWebview, WebviewToHost } from "./protocol.js";
export { initialModel, reduce, setFocus, OUTPUT_CAP } from "./reducer.js";
export type { CockpitModel } from "./reducer.js";
export { selectState } from "./select.js";
```

- [ ] **Step 2: Extend `packages/cockpit/test/index.test.ts`** to assert the surface:
```ts
import { describe, expect, it } from "vitest";
import * as cockpit from "../src/index.js";

describe("@maestro/cockpit", () => {
  it("exposes a version", () => {
    expect(cockpit.MAESTRO_COCKPIT_VERSION).toBe("0.0.0");
  });
  it("exports the reducer + selector surface", () => {
    expect(typeof cockpit.initialModel).toBe("function");
    expect(typeof cockpit.reduce).toBe("function");
    expect(typeof cockpit.setFocus).toBe("function");
    expect(typeof cockpit.selectState).toBe("function");
    expect(cockpit.OUTPUT_CAP).toBe(16000);
  });
});
```

- [ ] **Step 3: Verify** — `pnpm -F @maestro/cockpit test && pnpm -F @maestro/cockpit typecheck && pnpm -F @maestro/cockpit build` → all green, `dist/index.js` emitted.
- [ ] **Step 4: Commit** — `feat(cockpit): public API surface + export smoke`.

---

## Phase B — `@maestro/extension` (the real VS Code extension)

### Task B0: Scaffold the extension package + esbuild build + activate stub

**Files:**
- Create: `packages/extension/package.json` (the VS Code manifest)
- Create: `packages/extension/tsconfig.json`
- Create: `packages/extension/build.mjs`
- Create: `packages/extension/.vscodeignore`
- Create: `packages/extension/vitest.config.ts`
- Create: `packages/extension/src/extension.ts` (minimal activate stub)
- Create: `packages/extension/src/webview/main.ts` (minimal stub)
- Create: `packages/extension/src/webview/style.css` (minimal)

- [ ] **Step 1: `packages/extension/package.json`** (manifest + scripts). Note: NOT `"type": "module"` — the host bundle is CJS. `vscode` is a host-provided external.
```json
{
  "name": "@maestro/extension",
  "displayName": "Maestro",
  "description": "Conduct a team of AI coding agents in isolated git worktrees.",
  "version": "0.0.0",
  "publisher": "prixio",
  "engines": { "vscode": "^1.90.0" },
  "categories": ["Other"],
  "main": "./dist/extension.js",
  "contributes": {
    "viewsContainers": {
      "activitybar": [
        { "id": "maestro", "title": "Maestro", "icon": "$(rocket)" }
      ]
    },
    "views": {
      "maestro": [
        { "id": "maestro.roster", "name": "Roster" }
      ]
    },
    "commands": [
      { "command": "maestro.spawnAgent", "title": "Maestro: Spawn Agent", "icon": "$(add)" },
      { "command": "maestro.openStage", "title": "Maestro: Open Stage" }
    ],
    "menus": {
      "view/title": [
        { "command": "maestro.spawnAgent", "when": "view == maestro.roster", "group": "navigation" }
      ]
    }
  },
  "scripts": {
    "build": "node build.mjs",
    "watch": "node build.mjs --watch",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@maestro/core": "workspace:*",
    "@maestro/cockpit": "workspace:*",
    "@maestro/workspace": "workspace:*",
    "@maestro/adapter-copilot": "workspace:*"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/vscode": "^1.90.0",
    "esbuild": "^0.24.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: `packages/extension/tsconfig.json`** — typecheck only; esbuild emits. `moduleResolution: bundler` lets us import workspace packages by name and `vscode` as a type.
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM"],
    "types": ["node", "vscode"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["src", "test"]
}
```
(`DOM` lib is needed for the webview client's `acquireVsCodeApi`/`document`.)

- [ ] **Step 3: `packages/extension/build.mjs`** — two esbuild bundles:
```js
import { build, context } from "esbuild";

const watch = process.argv.includes("--watch");

/** Extension host: CJS, node platform, vscode external. */
const host = {
  entryPoints: ["src/extension.ts"],
  outfile: "dist/extension.js",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node18",
  external: ["vscode"],
  sourcemap: true,
};

/** Webview client: browser IIFE, no externals. */
const webview = {
  entryPoints: ["src/webview/main.ts"],
  outfile: "dist/webview/main.js",
  bundle: true,
  platform: "browser",
  format: "iife",
  target: "es2020",
  sourcemap: true,
};

if (watch) {
  const a = await context(host);
  const b = await context(webview);
  await Promise.all([a.watch(), b.watch()]);
  console.log("esbuild watching...");
} else {
  await Promise.all([build(host), build(webview)]);
  console.log("esbuild done");
}
```

- [ ] **Step 4: `packages/extension/.vscodeignore`:**
```
src/**
test/**
build.mjs
tsconfig.json
vitest.config.ts
**/*.map
node_modules/**
```

- [ ] **Step 5: `packages/extension/vitest.config.ts`** — identical to `packages/workspace/vitest.config.ts`.

- [ ] **Step 6: Minimal `packages/extension/src/extension.ts` stub** (real wiring lands in B5):
```ts
import * as vscode from "vscode";

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("maestro.openStage", () => {
      vscode.window.showInformationMessage("Maestro: stage coming online.");
    }),
  );
}

export function deactivate(): void {
  // no-op
}
```

- [ ] **Step 7: Minimal `packages/extension/src/webview/main.ts` stub** + `style.css` (one line each is fine; replaced in B4):
```ts
// Replaced in B4. Stub so the webview bundle builds.
export {};
```
`style.css`: `body { font-family: var(--vscode-font-family); }`

- [ ] **Step 8: Install + verify.** Run `pnpm install` at repo root. Build prerequisites then the extension:
  - Run: `pnpm -F @maestro/core -F @maestro/cockpit -F @maestro/workspace -F @maestro/adapter-copilot build` → all emit dist.
  - Run: `pnpm -F @maestro/extension typecheck` → clean.
  - Run: `pnpm -F @maestro/extension build` → emits `dist/extension.js` and `dist/webview/main.js`.

- [ ] **Step 9: Commit** — `feat(extension): scaffold @maestro/extension (manifest + esbuild + activate stub)`.

---

### Task B1: The cockpit controller (pure, fake-orchestrator testable)

**Files:**
- Create: `packages/extension/src/controller.ts`
- Test: `packages/extension/test/controller.test.ts`

**Context:** This is the testable heart of the shell. `createCockpit` subscribes to an `OrchestratorLike` (the subset of `Orchestrator` it uses), folds events through the cockpit reducer, and pushes `selectState` snapshots via `onState`. It also dispatches inbound `WebviewToHost` messages to orchestrator calls, routing async merge/discard rejections to `onError`. No VS Code import here.

- [ ] **Step 1: Write the failing test** `packages/extension/test/controller.test.ts`:
```ts
import { describe, expect, it, vi } from "vitest";
import type { Agent, OrchestratorEvent } from "@maestro/core";
import type { CockpitState } from "@maestro/cockpit";
import { createCockpit, type OrchestratorLike } from "../src/controller.js";

function fakeOrch() {
  let listener: ((e: OrchestratorEvent) => void) | undefined;
  const calls: string[] = [];
  const orch: OrchestratorLike = {
    on(l) { listener = l; return () => { listener = undefined; }; },
    spawn: (r, d) => { calls.push(`spawn:${r}:${d}`); return {} as Agent; },
    steer: (id, i) => { calls.push(`steer:${id}:${i}`); },
    approve: (id, ap, dec) => { calls.push(`approve:${id}:${ap}:${dec}`); },
    stop: (id) => { calls.push(`stop:${id}`); },
    merge: vi.fn(async (id: string) => { calls.push(`merge:${id}`); return { status: "clean" as const }; }),
    discard: vi.fn(async (id: string) => { calls.push(`discard:${id}`); }),
  };
  return { orch, calls, emit: (e: OrchestratorEvent) => listener?.(e) };
}
const agent = (id: string): Agent => ({
  id, task: { id: `t-${id}`, description: "x", roleName: "Implementer" },
  role: { name: "Implementer", instructions: "", engine: { id: "copilot" }, autonomy: "auto-approve-safe" },
  state: "working", log: [],
});

describe("createCockpit", () => {
  it("pushes a state snapshot when an orchestrator event arrives", () => {
    const { orch, emit } = fakeOrch();
    const states: CockpitState[] = [];
    createCockpit(orch, (s) => states.push(s));
    emit({ kind: "agent-added", agent: agent("a1") });
    expect(states.at(-1)!.cards.map((c) => c.id)).toEqual(["a1"]);
  });

  it("ready re-pushes current state without an orchestrator event", () => {
    const { orch, emit } = fakeOrch();
    const states: CockpitState[] = [];
    const cockpit = createCockpit(orch, (s) => states.push(s));
    emit({ kind: "agent-added", agent: agent("a1") });
    const before = states.length;
    cockpit.handle({ type: "ready" });
    expect(states.length).toBe(before + 1);
  });

  it("dispatches webview messages to orchestrator calls", () => {
    const { orch, calls } = fakeOrch();
    const cockpit = createCockpit(orch, () => {});
    cockpit.handle({ type: "spawn", roleName: "Implementer", description: "fix bug" });
    cockpit.handle({ type: "stop", agentId: "a1" });
    cockpit.handle({ type: "merge", agentId: "a1" });
    cockpit.handle({ type: "discard", agentId: "a2" });
    expect(calls).toContain("spawn:Implementer:fix bug");
    expect(calls).toContain("stop:a1");
    expect(calls).toContain("merge:a1");
    expect(calls).toContain("discard:a2");
  });

  it("routes a rejected merge to onError", async () => {
    const { orch } = fakeOrch();
    (orch.merge as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("conflict abort failed"));
    const onError = vi.fn();
    const cockpit = createCockpit(orch, () => {}, onError);
    cockpit.handle({ type: "merge", agentId: "a1" });
    await new Promise((r) => setTimeout(r, 0));
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("conflict abort failed"));
  });

  it("focus updates state and dispose unsubscribes", () => {
    const { orch, emit } = fakeOrch();
    const states: CockpitState[] = [];
    const cockpit = createCockpit(orch, (s) => states.push(s));
    emit({ kind: "agent-added", agent: agent("a1") });
    cockpit.handle({ type: "focus", agentId: "a1" });
    expect(states.at(-1)!.focusedId).toBe("a1");
    cockpit.dispose();
    const after = states.length;
    emit({ kind: "agent-added", agent: agent("a2") });
    expect(states.length).toBe(after); // no more pushes after dispose
  });
});
```

- [ ] **Step 2: Run it to confirm it fails** — FAIL (module not found).

- [ ] **Step 3: Write `packages/extension/src/controller.ts`:**
```ts
import type { Agent, ApprovalDecision, MergeResult, OrchestratorEvent } from "@maestro/core";
import type { CockpitState, WebviewToHost } from "@maestro/cockpit";
import { initialModel, reduce, selectState, setFocus } from "@maestro/cockpit";

/** The slice of Orchestrator the cockpit drives. Keeps the controller unit-testable. */
export interface OrchestratorLike {
  on(listener: (event: OrchestratorEvent) => void): () => void;
  spawn(roleName: string, description: string): Agent;
  steer(agentId: string, input: string): void;
  approve(agentId: string, approvalId: string, decision: ApprovalDecision): void;
  stop(agentId: string): void;
  merge(agentId: string): Promise<MergeResult>;
  discard(agentId: string): Promise<void>;
}

export interface Cockpit {
  /** Apply one inbound webview message. */
  handle(message: WebviewToHost): void;
  /** Current derived state (for a freshly-created webview). */
  state(): CockpitState;
  /** Unsubscribe from the orchestrator. */
  dispose(): void;
}

/**
 * Wire an orchestrator to a state sink. `onState` fires on every change with a
 * full snapshot (the UI is a pure function of state). `onError` receives the
 * message from a rejected async action (merge/discard).
 */
export function createCockpit(
  orch: OrchestratorLike,
  onState: (state: CockpitState) => void,
  onError?: (message: string) => void,
): Cockpit {
  let model = initialModel();
  const push = (): void => onState(selectState(model));
  const unsub = orch.on((event) => {
    model = reduce(model, event);
    push();
  });

  const fail = (error: unknown): void =>
    onError?.(error instanceof Error ? error.message : String(error));

  function handle(message: WebviewToHost): void {
    switch (message.type) {
      case "ready":
        push();
        break;
      case "focus":
        model = setFocus(model, message.agentId);
        push();
        break;
      case "spawn":
        orch.spawn(message.roleName, message.description);
        break;
      case "steer":
        orch.steer(message.agentId, message.input);
        break;
      case "approve":
        orch.approve(message.agentId, message.approvalId, message.decision);
        break;
      case "stop":
        orch.stop(message.agentId);
        break;
      case "merge":
        orch.merge(message.agentId).catch(fail);
        break;
      case "discard":
        orch.discard(message.agentId).catch(fail);
        break;
    }
  }

  return { handle, state: () => selectState(model), dispose: unsub };
}
```

- [ ] **Step 4: Run tests** — `pnpm -F @maestro/extension test` → all pass.
- [ ] **Step 5: Commit** — `feat(extension): createCockpit controller wiring orchestrator<->webview`.

---

### Task B2: Roster tree provider + mapping

**Files:**
- Create: `packages/extension/src/roster.ts`
- Test: `packages/extension/test/roster.test.ts`

**Context:** The Roster is a native `TreeView`. Keep the mapping pure (`cardToTreeItem`, `cardIcon`) so it's testable without VS Code, and keep the `TreeDataProvider` class a thin wrapper that holds the latest `CockpitState` and fires `onDidChangeTreeData` when updated. The test imports only the pure functions (it must not need the `vscode` module). To keep `vscode` out of the test, put the pure helpers in this file but have them return plain descriptors that the class turns into `vscode.TreeItem`s — OR import `vscode` lazily. Cleanest: the pure function returns a `RosterItem` descriptor `{ id, label, description, icon, tooltip }`; the class maps `RosterItem -> vscode.TreeItem`. Test asserts on the descriptor.

- [ ] **Step 1: Write the failing test** `packages/extension/test/roster.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import type { AgentState } from "@maestro/core";
import type { CardVM } from "@maestro/cockpit";
import { cardIcon, cardToRosterItem } from "../src/roster.js";

function card(over: Partial<CardVM> = {}): CardVM {
  return { id: "a1", roleName: "Implementer", engineId: "copilot", state: "working", output: "", attention: false, ...over };
}

describe("roster mapping", () => {
  it("labels with the role and describes with the engine", () => {
    const item = cardToRosterItem(card());
    expect(item.id).toBe("a1");
    expect(item.label).toContain("Implementer");
    expect(item.description).toContain("copilot");
  });

  it("picks a distinct icon per state", () => {
    const states: AgentState[] = ["preparing", "working", "awaiting-approval", "done", "error", "conflict", "merged", "discarded", "stopped"];
    const icons = states.map(cardIcon);
    expect(new Set(icons).size).toBe(icons.length); // all distinct
  });

  it("flags attention cards in the tooltip/contextValue", () => {
    expect(cardToRosterItem(card({ state: "done", attention: true })).attention).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails** — FAIL.

- [ ] **Step 3: Write `packages/extension/src/roster.ts`:**
```ts
import * as vscode from "vscode";
import type { AgentState } from "@maestro/core";
import type { CardVM, CockpitState } from "@maestro/cockpit";

/** A VS Code-free descriptor of one roster row (pure, testable). */
export interface RosterItem {
  id: string;
  label: string;
  description: string;
  icon: string;
  tooltip: string;
  attention: boolean;
}

/** Codicon id per agent state (must be distinct so the roster reads at a glance). */
export function cardIcon(state: AgentState): string {
  switch (state) {
    case "preparing": return "clock";
    case "working": return "loading~spin";
    case "awaiting-approval": return "question";
    case "done": return "pass-filled";
    case "error": return "error";
    case "conflict": return "warning";
    case "merged": return "git-merge";
    case "discarded": return "trash";
    case "stopped": return "circle-slash";
  }
}

export function cardToRosterItem(card: CardVM): RosterItem {
  return {
    id: card.id,
    label: `${card.roleName}`,
    description: `${card.engineId} · ${card.state}`,
    icon: cardIcon(card.state),
    tooltip: `${card.roleName} (${card.engineId}) — ${card.state}`,
    attention: card.attention,
  };
}

/** Thin TreeDataProvider over the latest CockpitState. */
export class RosterTreeDataProvider implements vscode.TreeDataProvider<RosterItem> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;
  private items: RosterItem[] = [];

  update(state: CockpitState): void {
    this.items = state.cards.map(cardToRosterItem);
    this.changed.fire();
  }

  getChildren(): RosterItem[] {
    return this.items;
  }

  getTreeItem(item: RosterItem): vscode.TreeItem {
    const ti = new vscode.TreeItem(item.label, vscode.TreeItemCollapsibleState.None);
    ti.id = item.id;
    ti.description = item.description;
    ti.tooltip = item.tooltip;
    ti.iconPath = new vscode.ThemeIcon(item.icon);
    ti.contextValue = item.attention ? "maestro-agent-attention" : "maestro-agent";
    ti.command = { command: "maestro.focusAgent", title: "Focus", arguments: [item.id] };
    return ti;
  }
}
```

- [ ] **Step 4: Run tests + typecheck** — `pnpm -F @maestro/extension test && pnpm -F @maestro/extension typecheck` → green. (The test only imports `cardIcon`/`cardToRosterItem`; importing `vscode` at module top is fine since the bundler/test resolves the type-only `vscode` import — but to be safe the pure functions must not call any `vscode` runtime API. They don't.)

  **Gotcha to confirm:** importing `vscode` in a file under vitest fails at runtime because there is no `vscode` module outside the extension host. If `import * as vscode from "vscode"` at the top of `roster.ts` breaks the test, split the pure helpers (`cardIcon`, `cardToRosterItem`, `RosterItem`) into `src/roster-map.ts` (no vscode import) and keep the provider class in `src/roster.ts`. Have the test import from `../src/roster-map.js`. Prefer this split if the import errors.

- [ ] **Step 5: Commit** — `feat(extension): roster tree provider + pure card->item mapping`.

---

### Task B3: Stage HTML (pure) + webview panel

**Files:**
- Create: `packages/extension/src/html.ts`
- Create: `packages/extension/src/render.ts`
- Create: `packages/extension/src/stage.ts`
- Test: `packages/extension/test/html.test.ts`

**Context:** `getStageHtml` is a pure function returning the webview shell HTML with a strict CSP (nonce-gated script, styles from the extension only). `renderCardHTML` is a pure HTML-string builder for one card — the same shape the webview client uses, so we unit-test the branchy rendering (working vs done-with-diff vs conflict vs error) without a DOM. `stage.ts` holds the `StageWebviewPanel` class (creates the panel, sets HTML, wires `onDidReceiveMessage`, posts state). Both `html.ts` and `render.ts` are vscode-free.

- [ ] **Step 1: Write the failing test** `packages/extension/test/html.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import type { CardVM } from "@maestro/cockpit";
import { getStageHtml, escapeHtml, makeNonce } from "../src/html.js";
import { renderCardHTML } from "../src/render.js";

function card(over: Partial<CardVM> = {}): CardVM {
  return { id: "a1", roleName: "Implementer", engineId: "copilot", state: "working", output: "", attention: false, ...over };
}

describe("getStageHtml", () => {
  it("embeds the script with the nonce and a CSP", () => {
    const html = getStageHtml("script.js", "style.css", "ABC123", "vscode-resource:");
    expect(html).toContain('nonce="ABC123"');
    expect(html).toContain("Content-Security-Policy");
    expect(html).toContain("script.js");
    expect(html).toContain("style.css");
  });
  it("makeNonce yields a 32-char token", () => {
    expect(makeNonce()).toMatch(/^[A-Za-z0-9]{32}$/);
  });
  it("escapeHtml neutralizes markup", () => {
    expect(escapeHtml('<script>"&')).toBe("&lt;script&gt;&quot;&amp;");
  });
});

describe("renderCardHTML", () => {
  it("shows live output while working and a Stop control", () => {
    const html = renderCardHTML(card({ output: "compiling..." }));
    expect(html).toContain("compiling...");
    expect(html).toContain('data-action="stop"');
  });
  it("shows summary + diff files + Merge/Discard when done", () => {
    const html = renderCardHTML(card({ state: "done", attention: true, summary: "did it", diff: { files: ["a.ts", "b.ts"], patch: "P" } }));
    expect(html).toContain("did it");
    expect(html).toContain("a.ts");
    expect(html).toContain('data-action="merge"');
    expect(html).toContain('data-action="discard"');
  });
  it("shows conflict files and Discard on conflict", () => {
    const html = renderCardHTML(card({ state: "conflict", attention: true, conflictFiles: ["x.ts"] }));
    expect(html).toContain("x.ts");
    expect(html).toContain('data-action="discard"');
    expect(html).not.toContain('data-action="merge"');
  });
  it("shows the error tail on error", () => {
    const html = renderCardHTML(card({ state: "error", attention: true, error: "boom" }));
    expect(html).toContain("boom");
  });
  it("escapes output so engine text cannot inject markup", () => {
    const html = renderCardHTML(card({ output: "<img src=x onerror=alert(1)>" }));
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img");
  });
});
```

- [ ] **Step 2: Run it to confirm it fails** — FAIL.

- [ ] **Step 3: Write `packages/extension/src/html.ts`:**
```ts
const NONCE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** Deterministic-length random nonce (no Date/Math.random restrictions here — extension host). */
export function makeNonce(): string {
  let s = "";
  for (let i = 0; i < 32; i++) s += NONCE_ALPHABET[Math.floor(Math.random() * NONCE_ALPHABET.length)];
  return s;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** The webview shell. `scriptUri`/`styleUri` are webview-safe URIs; `cspSource` is webview.cspSource. */
export function getStageHtml(scriptUri: string, styleUri: string, nonce: string, cspSource: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} https: data:; style-src ${cspSource}; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link href="${styleUri}" rel="stylesheet" />
  <title>Maestro Stage</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}
```
Note: `escapeHtml` order matters — `&` first. The test `'<script>"&'` → `&lt;script&gt;&quot;&amp;` confirms it.

- [ ] **Step 4: Write `packages/extension/src/render.ts`** (shared pure renderer; the webview client imports it):
```ts
import type { CardVM } from "@maestro/cockpit";
import { escapeHtml } from "./html.js";

function actions(card: CardVM): string {
  const stop = `<button data-action="stop" data-id="${card.id}">Stop</button>`;
  const merge = `<button data-action="merge" data-id="${card.id}">Merge</button>`;
  const discard = `<button data-action="discard" data-id="${card.id}">Discard</button>`;
  switch (card.state) {
    case "working":
    case "awaiting-approval":
    case "preparing":
      return stop;
    case "done":
      return `${merge} ${discard}`;
    case "conflict":
    case "error":
    case "stopped":
      return discard;
    case "merged":
    case "discarded":
      return "";
  }
}

function detail(card: CardVM): string {
  if (card.state === "done" && card.diff) {
    const files = card.diff.files.map((f) => `<li>${escapeHtml(f)}</li>`).join("");
    return `<div class="summary">${escapeHtml(card.summary ?? "")}</div><ul class="files">${files}</ul>`;
  }
  if (card.state === "conflict" && card.conflictFiles) {
    const files = card.conflictFiles.map((f) => `<li>${escapeHtml(f)}</li>`).join("");
    return `<div class="conflict">Merge conflict in:</div><ul class="files">${files}</ul>`;
  }
  if (card.state === "error" && card.error) {
    return `<pre class="error">${escapeHtml(card.error)}</pre>`;
  }
  return "";
}

/** Pure HTML for one agent card. Engine output is always escaped. */
export function renderCardHTML(card: CardVM): string {
  const auto = !card.attention && card.engineId === "copilot" ? `<span class="badge">auto</span>` : "";
  return `<section class="card state-${card.state}${card.attention ? " attention" : ""}" data-id="${card.id}">
  <header><span class="role">${escapeHtml(card.roleName)}</span><span class="engine">${escapeHtml(card.engineId)}</span>${auto}<span class="status">${card.state}</span></header>
  <pre class="output">${escapeHtml(card.output)}</pre>
  ${detail(card)}
  <footer>${actions(card)}</footer>
</section>`;
}
```

- [ ] **Step 5: Write `packages/extension/src/stage.ts`** (the panel; vscode runtime):
```ts
import * as vscode from "vscode";
import type { CockpitState, WebviewToHost } from "@maestro/cockpit";
import { getStageHtml, makeNonce } from "./html.js";

/** Singleton Stage webview panel. */
export class StageWebviewPanel {
  private panel: vscode.WebviewPanel | undefined;
  private lastState: CockpitState = { cards: [] };

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly onMessage: (msg: WebviewToHost) => void,
  ) {}

  reveal(): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Active);
      return;
    }
    const panel = vscode.window.createWebviewPanel("maestro.stage", "Maestro Stage", vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "dist")],
    });
    this.panel = panel;
    const webview = panel.webview;
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "webview", "main.js")).toString();
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "webview", "style.css")).toString();
    webview.html = getStageHtml(scriptUri, styleUri, makeNonce(), webview.cspSource);
    panel.webview.onDidReceiveMessage((msg: WebviewToHost) => this.onMessage(msg));
    panel.onDidDispose(() => { this.panel = undefined; });
    this.post(this.lastState);
  }

  post(state: CockpitState): void {
    this.lastState = state;
    void this.panel?.webview.postMessage({ type: "state", state });
  }

  get isOpen(): boolean {
    return this.panel !== undefined;
  }
}
```
Note: `style.css` must be copied to `dist/webview/style.css`. Add a copy step to `build.mjs` (esbuild can emit it via a `loader`/`copy` — simplest: add `import "./style.css"` is not valid for a plain stylesheet link. Instead, in `build.mjs` add a tiny copy after build: read `src/webview/style.css`, write `dist/webview/style.css`.) Update `build.mjs` in this task to copy the CSS:
```js
import { copyFileSync, mkdirSync } from "node:fs";
// after build(...) / contexts:
mkdirSync("dist/webview", { recursive: true });
copyFileSync("src/webview/style.css", "dist/webview/style.css");
```

- [ ] **Step 6: Run tests + typecheck + build** — `pnpm -F @maestro/extension test && pnpm -F @maestro/extension typecheck && pnpm -F @maestro/extension build` → green; `dist/webview/style.css` present.
- [ ] **Step 7: Commit** — `feat(extension): stage webview panel + pure html/render (CSP, escaped output)`.

---

### Task B4: The vanilla-TS webview client

**Files:**
- Modify: `packages/extension/src/webview/main.ts`
- Modify: `packages/extension/src/webview/style.css`
- Test: rendering is covered by `render.test.ts` (B3); the client is glue (DOM + postMessage), verified by build + manual F5.

**Context:** The client calls `acquireVsCodeApi()`, listens for `{type:"state"}` messages, renders the card grid via the shared `renderCardHTML`, and delegates button clicks (`data-action`) to `postMessage`. It posts `{type:"ready"}` on load so the host pushes the current snapshot. Plus a "+ Spawn" affordance that prompts via the host (send `{type:"spawn"}` is driven from the roster command; the webview's spawn button can post a `spawn` with a fixed default role and an empty description that the host turns into an InputBox — but to keep the webview dumb, the spawn button simply triggers the host command by posting `{type:"ready"}`? No.) For the thin slice, spawning is driven by the roster's "+ Spawn Agent" title button (a VS Code command with QuickPick+InputBox, B5). The webview has no spawn form. Keep the client purely: render + per-card action buttons (stop/merge/discard) + focus on card click.

- [ ] **Step 1: Write `packages/extension/src/webview/main.ts`:**
```ts
import type { CockpitState, HostToWebview, WebviewToHost } from "@maestro/cockpit";
import { renderCardHTML } from "../render.js";

interface VsCodeApi {
  postMessage(msg: WebviewToHost): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();
const root = document.getElementById("root")!;

function render(state: CockpitState): void {
  root.innerHTML = state.cards.length
    ? state.cards.map(renderCardHTML).join("")
    : `<p class="empty">No agents yet. Use “Maestro: Spawn Agent” from the Roster.</p>`;
}

window.addEventListener("message", (e: MessageEvent<HostToWebview>) => {
  if (e.data.type === "state") render(e.data.state);
});

root.addEventListener("click", (e) => {
  const target = e.target as HTMLElement;
  const btn = target.closest<HTMLElement>("[data-action]");
  if (btn) {
    const id = btn.dataset.id!;
    const action = btn.dataset.action!;
    if (action === "stop") vscode.postMessage({ type: "stop", agentId: id });
    else if (action === "merge") vscode.postMessage({ type: "merge", agentId: id });
    else if (action === "discard") vscode.postMessage({ type: "discard", agentId: id });
    return;
  }
  const card = target.closest<HTMLElement>(".card");
  if (card?.dataset.id) vscode.postMessage({ type: "focus", agentId: card.dataset.id });
});

vscode.postMessage({ type: "ready" });
```

- [ ] **Step 2: Write `packages/extension/src/webview/style.css`** — themed cockpit styles:
```css
:root { color-scheme: light dark; }
body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); margin: 0; padding: 12px; }
#root { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 12px; }
.empty { color: var(--vscode-descriptionForeground); }
.card { border: 1px solid var(--vscode-panel-border); border-radius: 6px; padding: 10px; display: flex; flex-direction: column; gap: 8px; }
.card.attention { border-color: var(--vscode-focusBorder); box-shadow: 0 0 0 1px var(--vscode-focusBorder); }
.card header { display: flex; align-items: center; gap: 8px; font-size: 12px; }
.card .role { font-weight: 600; }
.card .engine, .card .badge { color: var(--vscode-descriptionForeground); }
.card .status { margin-left: auto; text-transform: uppercase; font-size: 10px; letter-spacing: .04em; }
.card .badge { border: 1px solid var(--vscode-panel-border); border-radius: 3px; padding: 0 4px; }
.output { margin: 0; max-height: 220px; overflow: auto; white-space: pre-wrap; word-break: break-word; background: var(--vscode-textCodeBlock-background); padding: 8px; border-radius: 4px; font-family: var(--vscode-editor-font-family); font-size: 12px; }
.files { margin: 0; padding-left: 18px; font-family: var(--vscode-editor-font-family); font-size: 12px; }
.summary { font-weight: 600; }
.conflict { color: var(--vscode-editorWarning-foreground); }
.error { color: var(--vscode-editorError-foreground); white-space: pre-wrap; }
.card footer { display: flex; gap: 8px; }
button { font-family: inherit; color: var(--vscode-button-foreground); background: var(--vscode-button-background); border: none; padding: 4px 10px; border-radius: 3px; cursor: pointer; }
button:hover { background: var(--vscode-button-hoverBackground); }
button[data-action="discard"] { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
```

- [ ] **Step 3: Build the webview** — `pnpm -F @maestro/extension build` → `dist/webview/main.js` + `dist/webview/style.css` emitted, no esbuild errors.
- [ ] **Step 4: Typecheck** — `pnpm -F @maestro/extension typecheck` → clean (DOM lib resolves `document`/`MessageEvent`/`HTMLElement`).
- [ ] **Step 5: Commit** — `feat(extension): vanilla-TS webview client + themed cockpit styles`.

---

### Task B5: `activate()` — assemble the real extension

**Files:**
- Modify: `packages/extension/src/extension.ts`
- Test: none new (pure pieces covered by B1-B3); verified by build + typecheck + documented manual F5.

**Context:** Final assembly. On activate: resolve the workspace folder as the git repo root, build `GitWorkspaceManager` + `CopilotAdapter` + `Orchestrator`, register the adapter and seed one default `Implementer` role bound to engine `copilot`. Create the roster provider + stage panel, then `createCockpit` whose `onState` updates BOTH the roster and the stage and whose `onError` shows a VS Code error toast. Register commands: `maestro.spawnAgent` (InputBox for the task → `cockpit.handle({type:"spawn",...})`), `maestro.openStage` (reveal the stage), `maestro.focusAgent` (reveal stage + `handle({type:"focus"})`). Guard: if there is no workspace folder, show a message and do not wire the orchestrator.

- [ ] **Step 1: Replace `packages/extension/src/extension.ts`:**
```ts
import * as vscode from "vscode";
import { Orchestrator, type Role } from "@maestro/core";
import { GitWorkspaceManager } from "@maestro/workspace";
import { CopilotAdapter } from "@maestro/adapter-copilot";
import { createCockpit } from "./controller.js";
import { RosterTreeDataProvider } from "./roster.js";
import { StageWebviewPanel } from "./stage.js";

const DEFAULT_ROLE: Role = {
  name: "Implementer",
  instructions: "You are an implementer. Make the requested change in this worktree.",
  engine: { id: "copilot" },
  autonomy: "auto-approve-safe",
};

export function activate(context: vscode.ExtensionContext): void {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    vscode.window.showWarningMessage("Maestro needs an open folder (a git repo) to conduct agents.");
    return;
  }
  const repoRoot = folder.uri.fsPath;

  const workspaces = new GitWorkspaceManager({ repoRoot });
  const orch = new Orchestrator({ maxParallelAgents: 3 }, workspaces);
  orch.registerAdapter(new CopilotAdapter());
  orch.registerRole(DEFAULT_ROLE);

  const roster = new RosterTreeDataProvider();
  const stage = new StageWebviewPanel(context.extensionUri, (msg) => cockpit.handle(msg));

  const cockpit = createCockpit(
    orch,
    (state) => {
      roster.update(state);
      stage.post(state);
    },
    (message) => void vscode.window.showErrorMessage(`Maestro: ${message}`),
  );

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("maestro.roster", roster),
    vscode.commands.registerCommand("maestro.openStage", () => stage.reveal()),
    vscode.commands.registerCommand("maestro.focusAgent", (agentId?: string) => {
      stage.reveal();
      if (agentId) cockpit.handle({ type: "focus", agentId });
    }),
    vscode.commands.registerCommand("maestro.spawnAgent", async () => {
      const description = await vscode.window.showInputBox({
        prompt: "Task for the agent",
        placeHolder: "e.g. Add a --version flag to the CLI",
      });
      if (!description) return;
      stage.reveal();
      cockpit.handle({ type: "spawn", roleName: DEFAULT_ROLE.name, description });
    }),
    { dispose: () => cockpit.dispose() },
  );
}

export function deactivate(): void {
  // no-op; subscriptions dispose the cockpit
}
```
(`maestro.focusAgent` must be a registered command since the roster `TreeItem.command` references it. It is not in `contributes.commands` because it takes an argument and should not appear in the palette — registering it at runtime is enough. Keep it out of the manifest's `commands`.)

- [ ] **Step 2: Typecheck + build** — `pnpm -F @maestro/extension typecheck && pnpm -F @maestro/extension build` → clean; both bundles emit.

- [ ] **Step 3: Write `packages/extension/README.md`** with the F5 instructions:
```md
# Maestro (VS Code extension)

Conduct a team of AI coding agents in isolated git worktrees.

## Develop / run (F5)
1. `pnpm install` at the repo root.
2. Build the libraries + extension: `pnpm -r build` (or `pnpm -F @maestro/extension build` after the four `@maestro/*` libs are built).
3. Open `packages/extension` in VS Code and press **F5** (Run Extension). A second VS Code window opens with Maestro in the activity bar.
4. Open a **git repo** folder in that window. Click the Maestro rocket → **Roster** → the title-bar **+** (Spawn Agent), type a task. Watch the Stage stream; on done, **Merge** or **Discard**.

Requires the GitHub `copilot` CLI on PATH and a Copilot subscription (the engine reuses your `gh`/Copilot auth; no API key).

## Build outputs
- `dist/extension.js` — extension host (CJS bundle)
- `dist/webview/main.js` + `dist/webview/style.css` — the Stage webview client
```

- [ ] **Step 4: Commit** — `feat(extension): wire activate() — orchestrator + copilot + worktrees + cockpit; README`.

---

### Task B6: Full gate + docs/memory

**Files:**
- Modify: `docs/plans/2026-06-14-maestro-vscode-design.md` (status section)
- (Memory files updated outside the repo by the controller.)

- [ ] **Step 1: Run the full gate from the repo root:**
  - `pnpm -r typecheck` → clean across all five packages.
  - `pnpm -r test` → core 47 + adapter 20 + workspace 17 + cockpit (A tests) + extension (B tests) all green.
  - `pnpm -r build` → all five packages build; extension emits both bundles + CSS.
- [ ] **Step 2: Update the design doc** — add a "Milestone 4 (VS Code cockpit) — DONE" bullet (packages added, the thin-slice scope shipped, test counts, deferred items) and set "Next: Milestone 5 — parallelism + the generic ACP adapter".
- [ ] **Step 3: Commit** — `docs: mark Milestone 4 (VS Code cockpit) DONE; next is M5 (parallelism + ACP adapter)`.

---

## Self-Review (author checklist)

- **Spec coverage:** roster (B2) ✓, stage streaming cards (B3/B4) ✓, review/merge/discard (B3 render + B1 controller + B5 wiring) ✓, conflict + error cards (B3) ✓, attention float-up (A3) ✓, real Orchestrator+GitWorkspaceManager+CopilotAdapter (B5) ✓, real installable extension (B0 manifest + B5 + README) ✓, degraded approvals as "auto" badge / no approve buttons (A reducer keeps the field; B3 render shows badge) ✓.
- **Deferred, on purpose (tracked):** steering box + approval buttons (Copilot can't), send-back, YAML roles/teams, persistence/rehydration, conflict-resolve-in-editor, electron integration tests.
- **Type consistency:** `WebviewToHost`/`HostToWebview` used identically in cockpit, controller, stage, webview client. `ApprovalDecision` = `"allow"|"deny"` matches core. `AgentState` switch in `cardIcon` and `render.ts` `actions()` is exhaustive over all 9 states (tsc enforces).
- **Known risks called out in-task:** (B2) `import "vscode"` breaks vitest → split pure helpers into `roster-map.ts`; (B3) `style.css` must be copied to `dist/webview/`; (B5) `maestro.focusAgent` registered at runtime, not in manifest.
