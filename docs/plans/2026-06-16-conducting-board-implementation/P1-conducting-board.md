# Maestro P1: Conducting Board Implementation Plan

> For agentic workers: REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use - [ ] checkboxes.

> Part of the [Conducting Board implementation roadmap](./README.md). UX spec: [01](../2026-06-16-conducting-board-design/01-overview-and-visual-language.md), [02](../2026-06-16-conducting-board-design/02-conducting-board-and-lifecycle.md).

## Goal

Make the Conducting Board visible and real over today's data model. This is the hero phase: pressing the existing spawn flow drops a card into a laned, dark-graphite board (Working / Needs you / Conflict / Done), each card carries the role, engine chip, faint italic "why" goal, the live task line, derived diff stats, an elapsed timer, and a (deliberately empty in P1) anatomy row. Clicking a card opens a right-hand drawer with Instructions / Output / Diff tabs and a capability-gated action bar (Approve / Deny, Steer, Send-back). No facade: the board is wired to the real `Orchestrator`, the drawer's controls drive the real protocol, and the goal threads through the real spawn path.

The visual contract is owned by the design docs; this plan links to them and does not restate pixels. The seams ([R1](./README.md) lanes, [R2](./README.md) dark canvas, [R7](./README.md) goal field) are defined here and referenced, not re-invented, by later phases.

## Architecture

The project's "pure brain, thin shell" split is preserved exactly:

- `@maestro/core` gains one additive, back-compatible field: `Task.goal?: string`, threaded through `Orchestrator.spawn` so it lands on the agent's task. No state, no lifecycle change.
- `@maestro/cockpit` (pure, zero VS Code) does the new work: it enriches `CardVM` (goal, taskDescription, diffStat, startedAt, lane, plus the P1-placeholder anatomy fields soul / toolsCount / skills), defines the canonical `laneFor(state)` ([R1](./README.md)), and `selectState` keeps attention-first ordering but the webview groups by `lane`. All unit-tested, no DOM.
- `@maestro/extension` (thin shell) rewrites the pure render layer (`render.ts`) into a laned board plus a drawer, and rewrites the webview client (`webview/main.ts`, `webview/style.css`) over the design's fixed graphite tokens ([R2](./README.md): NOT `var(--vscode-*)`). `html.ts` (CSP/nonce/escape) is unchanged. `activate()` threads the goal through the spawn command.

The one bet is unchanged: the UI is a pure function of `OrchestratorEvent`s. Everything branchy lives in the cockpit and the pure `render.ts`; the VS Code classes stay dumb. Invariants held throughout: pure cockpit (no `vscode` import in pure files), webview message runtime-guard `isWebviewMessage`, exhaustive `AgentState` switches (lean on `Record<AgentState, T>` so a new state is a compile error), and every engine-supplied string escaped via `escapeHtml`.

**Tech stack:** TypeScript ESM (core, cockpit), VS Code extension API + esbuild bundles (extension), Vitest. Vanilla TS/DOM for the webview, no framework.

## Scope

### IN (this phase)

- `Task.goal?: string` on the spawn path ([R7](./README.md)); threaded through `Orchestrator.spawn(roleName, description, goal?)` onto the agent's task. Additive, back-compatible.
- `CardVM` enrichment: `goal?`, `taskDescription`, `diffStat? {adds, dels}` (derived by counting `+`/`-` lines in the diff patch), `startedAt?` (epoch ms set when the card first enters `working`), the placeholder anatomy fields `soul?: boolean`, `toolsCount?: number`, `skills?: string[]` (all undefined in P1), and the computed `lane: Lane`.
- `laneFor(state): Lane` ([R1](./README.md)) plus its exhaustive test, and `lane` placed on every `CardVM`.
- `selectState` keeps attention-first, id-stable ordering; the webview buckets by `lane`.
- The laned board render (Working / Needs you / Conflict / Done sections), in the design's dark-graphite palette ([R2](./README.md)), with rich cards (role + engine chip + faint italic goal + task + diffStat + elapsed timer + empty anatomy row + lane-color accent).
- The right-hand drawer: Instructions / Output / Diff tabs (Instructions READ-ONLY: role.instructions + task + goal), plus a capability-gated action bar (Approve / Deny when `engineCapabilities.approvals` and `awaiting-approval`; Steer when `steerable`; Send-back when done/conflict). The BLOCKED "answer-to-unblock" box reuses the existing `steer` path; NO new protocol message is added (see note below).
- `activate()` threads the goal through the spawn command (an optional second InputBox).

### OUT (deferred, with the owning phase)

- The Dispatch composer (role preset chips, engine pills, goal+task in one modal) replacing the bare InputBox flow: **P2**.
- Reusable skills (`Role.skills`), the `.conductor/skills` store, and the Library shell: **P3**. P1 declares `CardVM.skills?` but always leaves it undefined.
- The full anatomy editor, Instructions EDITING (P1 Instructions tab is read-only), `Role.soul`, the tools-grant model, and a populated anatomy row: **P4**. P1 declares `soul?`/`toolsCount?`/`skills?` so the card anatomy row can light up later without another reducer change.
- The Discover tab and adopt flow: **P5**.
- The full-width Diff/Merge review screen (changed files, unified diff, what-changed, decision bar, conflict variant, PR mode, cleanup recovery): **P6**. The P1 drawer Diff tab is the lightweight inline view only.
- Ambient chrome (status-bar tally, Tweaks panel density / live-output / reduce-motion): later UI polish, not P1.

### Protocol note (no new message in P1)

The design's BLOCKED "answer-to-unblock" box is free text the agent consumes as input. There is **no** `blocked` state in the real `AgentState` union, and `steer` already carries free text into a running agent. So P1 reuses `steer` (when `steerable`) for answer-to-unblock and adds **no** new `WebviewToHost` variant. The existing variants (focus / steer / approve / stop / merge / discard / sendBack / resolve-conflict / finish-merge / create-pr / retry-cleanup) suffice. `isWebviewMessage` and the controller's exhaustive switch are therefore unchanged in P1.

## File Structure

```
packages/core/
  src/types.ts                 MODIFY  add Task.goal?: string
  src/orchestrator.ts          MODIFY  spawn(roleName, description, goal?) -> task.goal
  test/orchestrator.test.ts    MODIFY  goal threads onto the agent's task

packages/cockpit/
  src/protocol.ts              MODIFY  CardVM += goal, taskDescription, diffStat, startedAt,
                                       soul?, toolsCount?, skills?, lane; + Lane type
  src/lane.ts                  ADD     laneFor(state): Lane (R1 canonical table)
  src/reducer.ts               MODIFY  enrich cardFromAgent; diffStat from patch; startedAt on
                                       first "working"; lane via laneFor
  src/select.ts                MODIFY  (unchanged ordering; lane already on CardVM)
  src/index.ts                 MODIFY  export Lane + laneFor
  test/lane.test.ts            ADD     exhaustive Lane table
  test/reducer.test.ts         MODIFY  goal/taskDescription/diffStat/startedAt/lane/anatomy

packages/extension/
  src/render.ts                REWRITE laned board + drawer pure renderers
  src/webview/main.ts          REWRITE render board sections + drawer + tab/click delegation
  src/webview/style.css        REWRITE design's fixed graphite tokens (R2), no vscode vars
  src/extension.ts             MODIFY  spawn command: optional goal InputBox -> spawn message
  test/render.test.ts          MODIFY  board grouping, card fields, drawer tabs, gated controls
```

`html.ts` (CSP, nonce, `escapeHtml`), `controller.ts`, `roster.ts`, `stage.ts` are unchanged in P1. The native Roster TreeView keeps working as-is.

**Build order:** core (Task A) is the root; cockpit (Tasks B-E) depends on core; extension (Tasks F-I) depends on cockpit. Run `pnpm -r build` to relink between packages before the extension's esbuild step. Definition of done is the repo-root gate: `pnpm -r typecheck`, `pnpm -r test`, `pnpm -r build` all green.

---

## Task A: Core · `Task.goal` on the spawn path (R7)

**Files:**
- Modify: `packages/core/src/types.ts`
- Modify: `packages/core/src/orchestrator.ts`
- Test: `packages/core/test/orchestrator.test.ts`

**Context:** Today `spawn(roleName, description)` builds `Task = { id, description, roleName }`. The goal is the faint italic "why" the board shows. It belongs on the per-dispatch `Task` (so a future composer can set it per spawn, [R7](./README.md)), additive and optional so every existing caller compiles unchanged.

- [ ] **Step 1: Write the failing test** · append to `packages/core/test/orchestrator.test.ts`:
```ts
it("threads an optional goal onto the spawned task", () => {
  const orch = new Orchestrator({ maxParallelAgents: 1 }, fakeWorkspaces());
  orch.registerAdapter(new FakeEngineAdapter());
  orch.registerRole({ name: "Impl", instructions: "", engine: { id: "fake" }, autonomy: "manual" });
  const a = orch.spawn("Impl", "do the thing", "so that checkout cannot silently break");
  expect(a.task.goal).toBe("so that checkout cannot silently break");
});

it("omits goal when not provided (back-compatible)", () => {
  const orch = new Orchestrator({ maxParallelAgents: 1 }, fakeWorkspaces());
  orch.registerAdapter(new FakeEngineAdapter());
  orch.registerRole({ name: "Impl", instructions: "", engine: { id: "fake" }, autonomy: "manual" });
  const a = orch.spawn("Impl", "do the thing");
  expect(a.task.goal).toBeUndefined();
});
```
(Reuse the file's existing `fakeWorkspaces()` / `FakeEngineAdapter` helpers; match their real names if they differ.)

- [ ] **Step 2: Run it red** · `pnpm -F @maestro/core test` → FAIL (`spawn` rejects the 3rd arg / `task.goal` missing).

- [ ] **Step 3: Implement.** In `types.ts`, add to `Task`:
```ts
export interface Task {
  id: string;
  description: string;
  roleName: string;
  /** The "why" for this dispatch, shown as the faint italic goal line on the card. */
  goal?: string;
}
```
In `orchestrator.ts`, widen `spawn` and build the task with the goal only when present (so the optional field stays truly absent, not `undefined`-valued, keeping snapshots clean):
```ts
spawn(roleName: string, description: string, goal?: string): Agent {
  const role = this.roles.get(roleName);
  if (!role) throw new Error(`Unknown role: ${roleName}`);
  const id = this.idGen();
  const task: Task = { id: `task-${id}`, description, roleName, ...(goal ? { goal } : {}) };
  const agent: Agent = { id, task, role, state: "preparing", log: [] };
  this.agents.set(id, agent);
  this.emitter.emit({ kind: "agent-added", agent });
  this.tryStart(agent);
  return agent;
}
```
`launchTeam` keeps calling `spawn(role.name, description)` (no goal); a team-wide goal is a later concern.

- [ ] **Step 4: Run it green** · `pnpm -F @maestro/core test && pnpm -F @maestro/core typecheck` → all pass.
- [ ] **Step 5: Commit** · `feat(core): optional Task.goal threaded through Orchestrator.spawn (R7)`.

---

## Task B: Cockpit · `laneFor` and the `Lane` type (R1)

**Files:**
- Add: `packages/cockpit/src/lane.ts`
- Modify: `packages/cockpit/src/protocol.ts` (export `Lane`)
- Test: `packages/cockpit/test/lane.test.ts`

**Context:** [R1](./README.md) makes this the single home of lane mapping for the whole roadmap. The real `AgentState` union is exactly twelve states (`packages/core/src/types.ts`): preparing, working, awaiting-approval, done, error, stopped, merged, discarded, conflict, detached, merge-cleanup-failed, pr-created. There is **no** `queued` and **no** `blocked` state, so the canonical table in [02](../2026-06-16-conducting-board-design/02-conducting-board-and-lifecycle.md) is mapped only over the states that exist. The table, reconciled with the design's lifecycle table:

| Lane | States |
| --- | --- |
| `working` | preparing, working |
| `needsYou` | awaiting-approval, error, detached, merge-cleanup-failed |
| `conflict` | conflict |
| `done` | done, stopped, merged, discarded, pr-created |

Notes honoring [02](../2026-06-16-conducting-board-design/02-conducting-board-and-lifecycle.md): `conflict` is non-terminal and stays in the attention set, but it gets its own `conflict` lane (red) rather than living in `needsYou`, so the board can render the Conflict section distinctly. `done` is a finished, reviewable state and sits in the `done` lane even though it is in the attention set (attention floats it to the top *within* the lane via `selectState`); `stopped`/`merged`/`discarded`/`pr-created` are the muted/terminal Done tiles. This is a presentation grouping; attention ordering is still core policy.

- [ ] **Step 1: Write the failing test** `packages/cockpit/test/lane.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import type { AgentState } from "@maestro/core";
import { laneFor, type Lane } from "../src/lane.js";

const EXPECTED: Record<AgentState, Lane> = {
  preparing: "working",
  working: "working",
  "awaiting-approval": "needsYou",
  error: "needsYou",
  detached: "needsYou",
  "merge-cleanup-failed": "needsYou",
  conflict: "conflict",
  done: "done",
  stopped: "done",
  merged: "done",
  discarded: "done",
  "pr-created": "done",
};

describe("laneFor", () => {
  it("maps every AgentState to its canonical lane", () => {
    for (const state of Object.keys(EXPECTED) as AgentState[]) {
      expect(laneFor(state)).toBe(EXPECTED[state]);
    }
  });
});
```
(The local `EXPECTED` is itself a `Record<AgentState, Lane>`, so if core adds a state, this test file stops compiling, forcing the table to be updated here, in the one canonical place.)

- [ ] **Step 2: Run it red** · `pnpm -F @maestro/cockpit test` → FAIL (module not found).

- [ ] **Step 3: Implement.** In `protocol.ts`, add (near the top, before `CardVM`):
```ts
/** The board's four visual lanes. The canonical state->lane table lives in lane.ts (R1). */
export type Lane = "working" | "needsYou" | "conflict" | "done";
```
`packages/cockpit/src/lane.ts`:
```ts
import type { AgentState } from "@maestro/core";
import type { Lane } from "./protocol.js";

/** A total, exhaustive state -> lane table. Adding an AgentState is a compile error
 *  here, which is the point: the board's grouping is decided in exactly one place (R1). */
const LANE_BY_STATE: Record<AgentState, Lane> = {
  preparing: "working",
  working: "working",
  "awaiting-approval": "needsYou",
  error: "needsYou",
  detached: "needsYou",
  "merge-cleanup-failed": "needsYou",
  conflict: "conflict",
  done: "done",
  stopped: "done",
  merged: "done",
  discarded: "done",
  "pr-created": "done",
};

/** The canonical lane for an agent state. Referenced by selectState and the webview;
 *  later phases consume it, they never re-derive lanes. */
export function laneFor(state: AgentState): Lane {
  return LANE_BY_STATE[state];
}
```

- [ ] **Step 4: Run it green** · `pnpm -F @maestro/cockpit test && pnpm -F @maestro/cockpit typecheck` → pass.
- [ ] **Step 5: Commit** · `feat(cockpit): canonical laneFor(state) -> Lane table (R1)`.

---

## Task C: Cockpit · enrich `CardVM` (goal, taskDescription, diffStat, startedAt, lane, anatomy placeholders)

**Files:**
- Modify: `packages/cockpit/src/protocol.ts`
- Modify: `packages/cockpit/src/reducer.ts`
- Test: `packages/cockpit/test/reducer.test.ts`

**Context:** The card view model gains everything the rich card and drawer need. `taskDescription` is the active `task.description` (the "Current task line"). `goal` is `task.goal` from Task A. `diffStat` counts added/removed lines from the diff patch: lines starting with `+` (not `+++`) are adds, lines starting with `-` (not `---`) are dels, so the `+++ b/file` / `--- a/file` headers do not pollute the count. `startedAt` is set once, the first time a card observes `working`, so the webview can show `now - startedAt` as an elapsed timer; it is preserved across later updates and never reset. The anatomy placeholders (`soul?`, `toolsCount?`, `skills?`) are declared now and left undefined so the card's anatomy row can render in P3/P4 without touching the reducer again. `lane` is computed from `laneFor`.

- [ ] **Step 1: Write the failing tests** · extend `packages/cockpit/test/reducer.test.ts`. First teach the `agent()` test helper to accept a `task` override carrying `goal`, then add:
```ts
it("carries goal, taskDescription, and lane onto the card", () => {
  const m = reduce(
    initialModel(),
    added(agent({ task: { id: "t1", description: "wire the board", roleName: "Implementer", goal: "so that the board is real" } })),
  );
  const c = m.cards.get("a1")!;
  expect(c.goal).toBe("so that the board is real");
  expect(c.taskDescription).toBe("wire the board");
  expect(c.lane).toBe("working"); // preparing -> working lane
});

it("derives diffStat by counting + and - patch lines (ignoring +++/--- headers)", () => {
  const patch = ["--- a/x.ts", "+++ b/x.ts", "@@", "-old line", "+new line", "+second add", " ctx"].join("\n");
  const m = reduce(initialModel(), updated(agent({ state: "done", diff: { files: ["x.ts"], patch } })));
  expect(m.cards.get("a1")!.diffStat).toEqual({ adds: 2, dels: 1 });
});

it("has no diffStat until a diff exists", () => {
  const m = reduce(initialModel(), added(agent()));
  expect(m.cards.get("a1")!.diffStat).toBeUndefined();
});

it("stamps startedAt when the card first enters working and preserves it after", () => {
  let m = reduce(initialModel(), added(agent()));               // preparing
  expect(m.cards.get("a1")!.startedAt).toBeUndefined();
  m = reduce(m, updated(agent({ state: "working" })));
  const started = m.cards.get("a1")!.startedAt;
  expect(typeof started).toBe("number");
  m = reduce(m, updated(agent({ state: "done", summary: "ok" })));
  expect(m.cards.get("a1")!.startedAt).toBe(started);            // unchanged
});

it("lane tracks state transitions (working -> needsYou on error, conflict on conflict)", () => {
  let m = reduce(initialModel(), added(agent({ state: "working" })));
  expect(m.cards.get("a1")!.lane).toBe("working");
  m = reduce(m, updated(agent({ state: "error", error: "boom" })));
  expect(m.cards.get("a1")!.lane).toBe("needsYou");
  m = reduce(m, updated(agent({ state: "conflict", conflict: { files: ["x.ts"] } })));
  expect(m.cards.get("a1")!.lane).toBe("conflict");
});

it("leaves the anatomy placeholders undefined in P1", () => {
  const c = reduce(initialModel(), added(agent())).cards.get("a1")!;
  expect(c.soul).toBeUndefined();
  expect(c.toolsCount).toBeUndefined();
  expect(c.skills).toBeUndefined();
});
```
The existing reducer tests (output accumulation, cap, attention, conflict/error capture, ignore-unknown, setFocus) must keep passing unchanged.

- [ ] **Step 2: Run it red** · `pnpm -F @maestro/cockpit test` → the new cases FAIL.

- [ ] **Step 3: Implement.** In `protocol.ts`, extend `CardVM` (keep every existing field):
```ts
import type { AgentState } from "@maestro/core";
// Lane is declared in Task B.

export interface CardVM {
  id: string;
  roleName: string;
  engineId: string;
  state: AgentState;
  /** The lane this card renders in (R1). Computed from state via laneFor. */
  lane: Lane;
  output: string;
  /** The active task.description. */
  taskDescription: string;
  /** The faint italic "why" line, from task.goal (R7). Undefined when not set. */
  goal?: string;
  summary?: string;
  diff?: { files: string[]; patch: string };
  /** Added/removed line counts derived from the diff patch. Undefined until a diff exists. */
  diffStat?: { adds: number; dels: number };
  diffError?: string;
  conflictFiles?: string[];
  error?: string;
  pendingApprovalId?: string;
  approvalDetail?: { tool: string; description: string };
  engineCapabilities?: { approvals: boolean; steerable: boolean };
  /** Epoch ms when the card first entered "working"; drives the elapsed timer. */
  startedAt?: number;
  /** Anatomy placeholders, declared now (P1) and filled by P3/P4. Undefined in P1. */
  soul?: boolean;
  toolsCount?: number;
  skills?: string[];
  attention: boolean;
}
```
In `reducer.ts`, add the pure helpers and thread `prevStartedAt`. The reducer already passes `prev?.output` into `cardFromAgent`; pass the previous `startedAt` the same way, and stamp a fresh one when the new state is `working` and there was no prior stamp:
```ts
import { laneFor } from "./lane.js";

/** Count adds/dels from a unified diff patch, ignoring the +++/--- file headers. */
function diffStatFromPatch(patch: string): { adds: number; dels: number } {
  let adds = 0;
  let dels = 0;
  for (const line of patch.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) adds++;
    else if (line.startsWith("-") && !line.startsWith("---")) dels++;
  }
  return { adds, dels };
}

function cardFromAgent(agent: Agent, prevOutput: string, prevStartedAt: number | undefined): CardVM {
  const startedAt = prevStartedAt ?? (agent.state === "working" ? Date.now() : undefined);
  const card: CardVM = {
    id: agent.id,
    roleName: agent.role.name,
    engineId: agent.role.engine.id,
    state: agent.state,
    lane: laneFor(agent.state),
    output: prevOutput,
    taskDescription: agent.task.description,
    goal: agent.task.goal,
    summary: agent.summary,
    diff: agent.diff,
    diffStat: agent.diff ? diffStatFromPatch(agent.diff.patch) : undefined,
    diffError: agent.diffError,
    conflictFiles: agent.conflict?.files,
    error: agent.error,
    pendingApprovalId: agent.pendingApprovalId,
    approvalDetail: agent.approvalDetail,
    engineCapabilities: agent.engineCapabilities,
    startedAt,
    attention: stateNeedsAttention(agent.state),
  };
  return card;
}
```
Update the two call sites in `reduce`: `agent-added` passes `("", undefined)`; `agent-updated` passes `(prev?.output ?? "", prev?.startedAt)`. (The `Date.now()` call makes `cardFromAgent` non-deterministic only at the working transition; that is acceptable and the test asserts type + preservation, not a fixed value. If a reviewer prefers purity, inject a `now()` later; P1 keeps it inline.)

- [ ] **Step 4: Run it green** · `pnpm -F @maestro/cockpit test && pnpm -F @maestro/cockpit typecheck` → all pass.
- [ ] **Step 5: Commit** · `feat(cockpit): enrich CardVM (goal, taskDescription, diffStat, startedAt, lane, anatomy placeholders)`.

---

## Task D: Cockpit · `selectState` keeps attention-first within lanes; export surface

**Files:**
- Modify: `packages/cockpit/src/select.ts` (verify, likely no change)
- Modify: `packages/cockpit/src/index.ts`
- Test: `packages/cockpit/test/select.test.ts`

**Context:** The board groups by `lane` in the webview, but the *ordering within* a lane must stay attention-first then id-stable, which `compareCards` already does. Because `lane` is on each `CardVM`, the webview filters `cards` by lane and the relative order is preserved (`Array.prototype.filter` is stable). This task adds a test proving attention-first holds inside a lane, and exports `Lane` + `laneFor` from the package.

- [ ] **Step 1: Write the failing test** · extend `packages/cockpit/test/select.test.ts`. Teach its local `agent()` helper to take a state, then add:
```ts
it("keeps attention-first, id-stable order inside a lane", () => {
  let m = initialModel();
  m = reduce(m, add(agent("a3", "done")));   // done lane, attention
  m = reduce(m, add(agent("a1", "merged"))); // done lane, no attention
  m = reduce(m, add(agent("a2", "done")));   // done lane, attention
  const doneLane = selectState(m).cards.filter((c) => c.lane === "done").map((c) => c.id);
  expect(doneLane).toEqual(["a2", "a3", "a1"]); // a2,a3 attention by id, then a1
});

it("puts every card in a lane derived from its state", () => {
  let m = initialModel();
  m = reduce(m, add(agent("w", "working")));
  m = reduce(m, add(agent("n", "awaiting-approval")));
  m = reduce(m, add(agent("c", "conflict")));
  const byId = new Map(selectState(m).cards.map((c) => [c.id, c.lane]));
  expect(byId.get("w")).toBe("working");
  expect(byId.get("n")).toBe("needsYou");
  expect(byId.get("c")).toBe("conflict");
});
```

- [ ] **Step 2: Run it red** · FAIL only if a code change is needed; if `select.ts` is already correct the lane assertions still need `lane` on the card (delivered in Task C) and pass once C lands. Run `pnpm -F @maestro/cockpit test` and confirm the new cases drive any needed change. `select.ts` itself should need **no** change (ordering is unchanged); if so, note that explicitly and skip to Step 4.

- [ ] **Step 3: Implement (export only).** In `index.ts` add:
```ts
export type { CardVM, CockpitState, HostToWebview, WebviewToHost, Lane } from "./protocol.js";
export { laneFor } from "./lane.js";
```
(Keep the existing `isWebviewMessage`, reducer, and `selectState` exports.)

- [ ] **Step 4: Run it green** · `pnpm -F @maestro/cockpit test && pnpm -F @maestro/cockpit typecheck && pnpm -F @maestro/cockpit build` → green; `dist` emits.
- [ ] **Step 5: Commit** · `feat(cockpit): attention-first-within-lane test + export Lane/laneFor`.

---

## Task E: Extension · laned board render (pure)

**Files:**
- Rewrite: `packages/extension/src/render.ts`
- Test: `packages/extension/test/render.test.ts`

**Context:** `render.ts` is pure (no `vscode` import) and is imported by the webview bundle, so all its branches are unit-testable without a DOM. It is restructured into two responsibilities: `renderBoard(state)` lays out the four lane sections (Working / Needs you / Conflict / Done) with a Manrope lane header carrying a live count, and `renderCardHTML(card)` builds one rich tile. The card shows: role name + lane status dot, engine chip, the faint italic goal (omitted when absent), the task line, diffStat (`+adds -dels`, omitted until a diff exists), an elapsed-time slot the webview fills from `startedAt`, and the anatomy row (omitted entirely in P1 since `soul`/`toolsCount`/`skills` are all undefined, per [02](../2026-06-16-conducting-board-design/02-conducting-board-and-lifecycle.md): never render empty glyph slots). Every engine-supplied string (role, engine, goal, task, output, summary, files, error) is escaped. The lane accent and dot color come from a CSS class `lane-<lane>`; tokens are owned by Task G.

This task moves the action controls (approve / steer / send-back / merge / discard, etc.) **out of the card** and into the drawer renderer, since the design opens those in the drawer, not on the tile. The card itself is read-mostly; clicking it focuses and opens the drawer.

- [ ] **Step 1: Write the failing tests** · rewrite `packages/extension/test/render.test.ts`. Keep a `card()` factory (now including `lane`, `taskDescription`). Add:
```ts
import { renderBoard, renderCardHTML, renderDrawer } from "../src/render.js";

function card(over: Partial<CardVM> = {}): CardVM {
  return { id: "a1", roleName: "Implementer", engineId: "copilot", state: "working",
    lane: "working", output: "", taskDescription: "do it", attention: false, ...over };
}

describe("renderCardHTML", () => {
  it("shows role, engine chip, task line, and a lane accent class", () => {
    const html = renderCardHTML(card({ engineId: "claude-sonnet-4.5", taskDescription: "ship the board" }));
    expect(html).toContain("Implementer");
    expect(html).toContain("claude-sonnet-4.5");
    expect(html).toContain("ship the board");
    expect(html).toContain("lane-working");
  });
  it("renders the faint italic goal when present and omits it when absent", () => {
    expect(renderCardHTML(card({ goal: "so that checkout cannot break" }))).toContain("so that checkout cannot break");
    expect(renderCardHTML(card())).not.toContain('class="goal"');
  });
  it("renders diffStat when a diff exists and omits it otherwise", () => {
    expect(renderCardHTML(card({ state: "done", diffStat: { adds: 5, dels: 2 } }))).toContain("+5");
    expect(renderCardHTML(card({ state: "done", diffStat: { adds: 5, dels: 2 } }))).toContain("-2");
    expect(renderCardHTML(card())).not.toContain('class="diffstat"');
  });
  it("emits an elapsed slot carrying startedAt for working cards", () => {
    expect(renderCardHTML(card({ startedAt: 1718000000000 }))).toContain('data-started="1718000000000"');
  });
  it("omits the anatomy row in P1 (no soul/tools/skills)", () => {
    expect(renderCardHTML(card())).not.toContain('class="anatomy"');
  });
  it("escapes engine output and goal so text cannot inject markup", () => {
    const html = renderCardHTML(card({ goal: "<img src=x onerror=alert(1)>", output: "<script>bad" }));
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<script>bad");
    expect(html).toContain("&lt;img");
  });
});

describe("renderBoard", () => {
  it("groups cards into Working / Needs you / Conflict / Done with live counts", () => {
    const cards = [
      card({ id: "w1", lane: "working" }),
      card({ id: "n1", lane: "needsYou", state: "awaiting-approval", attention: true }),
      card({ id: "n2", lane: "needsYou", state: "error", attention: true }),
      card({ id: "c1", lane: "conflict", state: "conflict", attention: true }),
      card({ id: "d1", lane: "done", state: "merged" }),
    ];
    const html = renderBoard({ cards });
    expect(html).toContain("Working");
    expect(html).toContain("Needs you");
    expect(html).toContain("Conflict");
    expect(html).toContain("Done");
    expect(html).toMatch(/Needs you[\s\S]*?2/); // count badge of 2
    expect(html).toContain('data-id="w1"');
    expect(html).toContain('data-id="c1"');
  });
  it("renders empty lanes as a quiet placeholder, never a hard border", () => {
    const html = renderBoard({ cards: [card({ lane: "working" })] });
    expect(html).toContain('class="lane-empty"'); // needsYou/conflict/done are empty
  });
});
```

- [ ] **Step 2: Run it red** · `pnpm -F @maestro/extension test` → FAIL (`renderBoard`/`renderDrawer` not exported; card shape changed).

- [ ] **Step 3: Implement `render.ts`.** Sketch (escape everything; exhaustive over the four lanes):
```ts
import type { CardVM, CockpitState, Lane } from "@maestro/cockpit";
import { escapeHtml } from "./html.js";

const LANE_TITLES: Record<Lane, string> = {
  working: "Working",
  needsYou: "Needs you",
  conflict: "Conflict",
  done: "Done",
};
const LANE_ORDER: readonly Lane[] = ["working", "needsYou", "conflict", "done"];

function goalLine(card: CardVM): string {
  return card.goal ? `<div class="goal">${escapeHtml(card.goal)}</div>` : "";
}
function diffStat(card: CardVM): string {
  if (!card.diffStat) return "";
  return `<div class="diffstat"><span class="adds">+${card.diffStat.adds}</span> <span class="dels">-${card.diffStat.dels}</span></div>`;
}
function elapsed(card: CardVM): string {
  // The webview fills the text from data-started (now - startedAt); empty when absent.
  return card.startedAt ? `<span class="elapsed" data-started="${card.startedAt}"></span>` : "";
}
function anatomy(card: CardVM): string {
  // Omitted entirely in P1 (no soul/tools/skills). Populated in P3/P4.
  const hasAny = card.soul || card.toolsCount !== undefined || (card.skills?.length ?? 0) > 0;
  if (!hasAny) return "";
  const parts: string[] = [];
  if (card.soul) parts.push(`<span class="an-soul">☽ soul</span>`);
  if (card.toolsCount !== undefined) parts.push(`<span class="an-tools">🔧 ${card.toolsCount}</span>`);
  if (card.skills?.length) parts.push(`<span class="an-skills">◆ ${escapeHtml(card.skills[0]!)} ${card.skills.length}</span>`);
  return `<div class="anatomy">${parts.join(" · ")}</div>`;
}

/** Pure HTML for one rich card tile. Engine-supplied strings are escaped. */
export function renderCardHTML(card: CardVM): string {
  return `<section class="card lane-${card.lane}${card.attention ? " attention" : ""}" data-id="${escapeHtml(card.id)}" tabindex="0">
  <header><span class="dot"></span><span class="role">${escapeHtml(card.roleName)}</span><span class="engine">${escapeHtml(card.engineId)}</span>${elapsed(card)}</header>
  ${goalLine(card)}
  <div class="task">${escapeHtml(card.taskDescription)}</div>
  ${diffStat(card)}
  ${anatomy(card)}
</section>`;
}

function laneSection(lane: Lane, cards: CardVM[]): string {
  const inLane = cards.filter((c) => c.lane === lane);
  const body = inLane.length
    ? inLane.map(renderCardHTML).join("")
    : `<div class="lane-empty"></div>`;
  return `<section class="lane lane-col-${lane}"><h2 class="lane-header">${LANE_TITLES[lane]} <span class="count">${inLane.length}</span></h2>${body}</section>`;
}

/** Pure HTML for the whole laned board. */
export function renderBoard(state: CockpitState): string {
  return `<div class="board">${LANE_ORDER.map((lane) => laneSection(lane, state.cards)).join("")}</div>`;
}
```
`renderDrawer` is added in Task F (this task may export a stub `renderDrawer = () => ""` so the test import resolves, then F fleshes it; or fold the drawer test into F. Pick one: prefer adding the stub here so the file's public surface is stable).

- [ ] **Step 4: Run it green** · `pnpm -F @maestro/extension test && pnpm -F @maestro/extension typecheck` → pass.
- [ ] **Step 5: Commit** · `feat(extension): laned board render (rich cards, lane sections, escaped, anatomy-ready)`.

---

## Task F: Extension · the drawer render (tabs + capability-gated controls, pure)

**Files:**
- Modify: `packages/extension/src/render.ts` (add `renderDrawer`)
- Test: `packages/extension/test/render.test.ts`

**Context:** The drawer is the workbench for the focused card. It renders a header (role, engine chip, state pill, close affordance), a tab strip (Instructions / Output / Diff), the active tab body, and a capability-gated action bar. Per [02](../2026-06-16-conducting-board-design/02-conducting-board-and-lifecycle.md):

- **Instructions** tab (READ-ONLY in P1): role instructions + the task description + the goal. Editing is deferred to P4, so render plain escaped text, no textarea, no Save.
- **Output** tab: the streamed `output`, escaped, on `bg-code`.
- **Diff** tab: the changed `files` list + the `patch` (escaped), plus the Merge / Discard entry point. This is the lightweight inline view; the full review screen is P6.
- **Action bar** (capability-gated, controls ABSENT not greyed when unavailable, per [02](../2026-06-16-conducting-board-design/02-conducting-board-and-lifecycle.md)):
  - Approve / Deny only when `engineCapabilities.approvals` and `state === "awaiting-approval"` (carries `pendingApprovalId`).
  - Steer box only when `engineCapabilities.steerable`. This same `steer` path is the answer-to-unblock box (no new message).
  - Send-back box only when `state === "done"` or `"conflict"`.
  - State-driven merge controls (merge / discard / resolve-conflict / finish-merge / create-pr / retry-cleanup) reusing the existing `actions(card)` logic from the pre-P1 `render.ts`, now living in the drawer footer. Keep its exhaustive `AgentState` switch.

The drawer needs the focused card; `renderDrawer(state)` looks up `state.focusedId` in `state.cards` and renders nothing (empty string, board full-width) when there is no focus.

- [ ] **Step 1: Write the failing tests** · add to `packages/extension/test/render.test.ts`. Use a `cap()` helper for `engineCapabilities`:
```ts
const steerable = { approvals: false, steerable: true };
const approver = { approvals: true, steerable: true };

describe("renderDrawer", () => {
  it("is empty when nothing is focused (board stays full-width)", () => {
    expect(renderDrawer({ cards: [card()] })).toBe("");
  });
  it("renders Instructions / Output / Diff tabs for the focused card", () => {
    const html = renderDrawer({ cards: [card({ id: "a1" })], focusedId: "a1" });
    expect(html).toContain("Instructions");
    expect(html).toContain("Output");
    expect(html).toContain("Diff");
  });
  it("Instructions tab is read-only: shows task + goal, no textarea, no Save", () => {
    const html = renderDrawer({ cards: [card({ id: "a1", taskDescription: "wire it", goal: "so that it is real" })], focusedId: "a1" });
    expect(html).toContain("wire it");
    expect(html).toContain("so that it is real");
    expect(html).not.toContain("<textarea");      // editing deferred to P4
    expect(html).not.toContain('data-action="save-instructions"');
  });
  it("shows Approve/Deny only when approvals-capable and awaiting-approval", () => {
    const yes = renderDrawer({ cards: [card({ id: "a1", state: "awaiting-approval", attention: true, pendingApprovalId: "ap1", engineCapabilities: approver })], focusedId: "a1" });
    expect(yes).toContain('data-action="approve"');
    expect(yes).toContain('data-action="deny"');
    const no = renderDrawer({ cards: [card({ id: "a1", state: "awaiting-approval", attention: true, pendingApprovalId: "ap1", engineCapabilities: { approvals: false, steerable: false } })], focusedId: "a1" });
    expect(no).not.toContain('data-action="approve"');
  });
  it("shows the Steer box only when steerable", () => {
    expect(renderDrawer({ cards: [card({ id: "a1", state: "working", engineCapabilities: steerable })], focusedId: "a1" })).toContain('data-action="steer"');
    expect(renderDrawer({ cards: [card({ id: "a1", state: "working", engineCapabilities: { approvals: false, steerable: false } })], focusedId: "a1" })).not.toContain('data-action="steer"');
  });
  it("shows Send-back on done/conflict and merge/discard on done", () => {
    const html = renderDrawer({ cards: [card({ id: "a1", state: "done", attention: true, diff: { files: ["x.ts"], patch: "P" }, summary: "ok" })], focusedId: "a1" });
    expect(html).toContain('data-action="sendBack"');
    expect(html).toContain('data-action="merge"');
    expect(html).toContain('data-action="discard"');
  });
  it("shows conflict files + resolve-conflict on conflict, never merge", () => {
    const html = renderDrawer({ cards: [card({ id: "a1", state: "conflict", attention: true, conflictFiles: ["x.ts"] })], focusedId: "a1" });
    expect(html).toContain("x.ts");
    expect(html).toContain('data-action="resolve-conflict"');
    expect(html).not.toContain('data-action="merge"');
  });
  it("Diff tab shows files + escaped patch", () => {
    const html = renderDrawer({ cards: [card({ id: "a1", state: "done", diff: { files: ["a.ts"], patch: "<x>+1" } })], focusedId: "a1" });
    expect(html).toContain("a.ts");
    expect(html).toContain("&lt;x&gt;");
  });
  it("escapes the streamed output in the Output tab", () => {
    const html = renderDrawer({ cards: [card({ id: "a1", output: "<img src=x onerror=alert(1)>" })], focusedId: "a1" });
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img");
  });
});
```

- [ ] **Step 2: Run it red** · FAIL (`renderDrawer` is a stub / returns `""` always).

- [ ] **Step 3: Implement `renderDrawer`.** Reuse the pre-P1 `approvalPanel`, `steerBox`, `sendBackBox`, `actions`, `detail` helpers verbatim where possible (they already escape and already have the exhaustive `actions` switch). Sketch:
```ts
function instructionsTab(card: CardVM, roleInstructions: string): string {
  // READ-ONLY in P1. role.instructions is not on CardVM; the drawer renders the
  // task + goal here and the host can pass instructions via a future field. For
  // P1, show task + goal (and instructions if/when threaded). No textarea (P4 edits).
  const goal = card.goal ? `<p class="why">${escapeHtml(card.goal)}</p>` : "";
  return `<div class="tab-body" data-tab="instructions"><h3>Task</h3><p>${escapeHtml(card.taskDescription)}</p>${goal}</div>`;
}
function outputTab(card: CardVM): string {
  return `<div class="tab-body" data-tab="output" hidden><pre class="output">${escapeHtml(card.output)}</pre></div>`;
}
function diffTab(card: CardVM): string {
  const files = (card.diff?.files ?? []).map((f) => `<li>${escapeHtml(f)}</li>`).join("");
  const patch = card.diff ? `<pre class="patch">${escapeHtml(card.diff.patch)}</pre>` : `<p class="ghost">No diff yet.</p>`;
  return `<div class="tab-body" data-tab="diff" hidden><ul class="files">${files}</ul>${patch}</div>`;
}

/** Pure HTML for the right drawer, or "" when nothing is focused. */
export function renderDrawer(state: CockpitState): string {
  if (!state.focusedId) return "";
  const card = state.cards.find((c) => c.id === state.focusedId);
  if (!card) return "";
  const id = escapeHtml(card.id);
  const tabs = `<nav class="tabs"><button class="tab active" data-tab="instructions">Instructions</button><button class="tab" data-tab="output">Output</button><button class="tab" data-tab="diff">Diff</button></nav>`;
  const bar = `${approvalPanel(card)}${steerBox(card)}${sendBackBox(card)}<footer class="drawer-actions">${actions(card)}</footer>`;
  return `<aside class="drawer" data-id="${id}">
  <header class="drawer-head"><span class="role">${escapeHtml(card.roleName)}</span><span class="engine">${escapeHtml(card.engineId)}</span><span class="state-pill lane-${card.lane}">${escapeHtml(card.state)}</span><button class="drawer-close" data-action="close-drawer" data-id="${id}">×</button></header>
  ${tabs}
  ${instructionsTab(card, "")}
  ${outputTab(card)}
  ${diffTab(card)}
  ${detail(card)}
  ${bar}
</aside>`;
}
```
Keep `approvalPanel`/`steerBox`/`sendBackBox`/`actions`/`detail` as-is (they already gate on `engineCapabilities` and state, and already escape). `close-drawer` is a webview-local action (it does NOT post to the host); the click handler clears focus client-side, so no protocol change.

- [ ] **Step 4: Run it green** · `pnpm -F @maestro/extension test && pnpm -F @maestro/extension typecheck` → pass.
- [ ] **Step 5: Commit** · `feat(extension): drawer render (Instructions/Output/Diff tabs + capability-gated action bar)`.

---

## Task G: Extension · webview client + dark-graphite styles (R2)

**Files:**
- Rewrite: `packages/extension/src/webview/main.ts`
- Rewrite: `packages/extension/src/webview/style.css`
- Test: covered by `render.test.ts` (pure HTML); the client is DOM glue, verified by build + manual F5.

**Context:** The client renders `renderBoard(state)` into the board region and `renderDrawer(state)` into the drawer region, ticks the elapsed timers from `data-started`, switches drawer tabs locally, and delegates the action clicks/forms to `postMessage`. The styles use the design's **fixed graphite palette and tokens** from [01](../2026-06-16-conducting-board-design/01-overview-and-visual-language.md) ([R2](./README.md): NOT `var(--vscode-*)`; the board is its own dark canvas). The four lane accent colors (`status-working #4a9eff`, `status-attention #f0a030`, `status-done #4caf50`, `status-conflict #e05050`) are signal-only: 2px left card border + status dot, never large fills. Keep the existing steer/send-back form delegation and the click delegation for stop/merge/discard/approve/deny/resolve-conflict/finish-merge/create-pr/retry-cleanup; add focus-on-card-click, the local close-drawer and tab-switch handlers, and the elapsed-timer interval.

- [ ] **Step 1: Rewrite `webview/main.ts`.** Sketch (keep the working form + click delegation; add board/drawer split, tabs, timers, focus, close):
```ts
import type { CockpitState, HostToWebview, WebviewToHost } from "@maestro/cockpit";
import { renderBoard, renderDrawer } from "../render.js";

interface VsCodeApi { postMessage(msg: WebviewToHost): void; }
declare function acquireVsCodeApi(): VsCodeApi;
const vscode = acquireVsCodeApi();
const root = document.getElementById("root");

function render(state: CockpitState): void {
  if (!root) return;
  const board = state.cards.length
    ? renderBoard(state)
    : `<p class="empty">No agents yet. Use the Roster's + (Spawn Agent) to start one.</p>`;
  root.innerHTML = `${board}${renderDrawer(state)}`;
  tickElapsed();
}

function tickElapsed(): void {
  const now = Date.now();
  document.querySelectorAll<HTMLElement>(".elapsed[data-started]").forEach((el) => {
    const started = Number(el.dataset["started"]);
    if (!Number.isFinite(started)) return;
    const s = Math.max(0, Math.floor((now - started) / 1000));
    el.textContent = `${Math.floor(s / 60)}m ${s % 60}s`;
  });
}
setInterval(tickElapsed, 1000); // a future Tweaks "reduce motion" can clear this

window.addEventListener("message", (e: MessageEvent<HostToWebview>) => {
  if (e.data.type === "state") render(e.data.state);
});

// Local-only interactions (no host round-trip): tab switch + close drawer.
document.addEventListener("click", (e) => {
  const t = e.target;
  if (!(t instanceof HTMLElement)) return;
  const tab = t.closest<HTMLElement>(".tab[data-tab]");
  if (tab) {
    const name = tab.dataset["tab"];
    document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b === tab));
    document.querySelectorAll<HTMLElement>(".tab-body").forEach((b) => { b.hidden = b.dataset["tab"] !== name; });
    return;
  }
  const close = t.closest<HTMLElement>('[data-action="close-drawer"]');
  if (close) { document.querySelector(".drawer")?.remove(); return; }
  // ... existing host-bound action delegation (stop/merge/discard/approve/deny/
  // resolve-conflict/finish-merge/create-pr/retry-cleanup) unchanged ...
  // then: focus the card (opens the drawer on next state push).
  const card = t.closest<HTMLElement>(".card");
  const cardId = card?.dataset["id"];
  if (cardId) vscode.postMessage({ type: "focus", agentId: cardId });
});

// ... existing submit delegation for steer + sendBack forms unchanged ...

vscode.postMessage({ type: "ready" });
```
Carry over the exact existing click/submit blocks for the host-bound actions and the steer/sendBack forms (they already post the right messages). The new pieces are: render `renderBoard + renderDrawer`, the elapsed timer interval, tab switching, close-drawer, and focus-on-card-click.

- [ ] **Step 2: Rewrite `webview/style.css`** over the design tokens ([01](../2026-06-16-conducting-board-design/01-overview-and-visual-language.md)). Define the tokens as CSS variables and use them (R2):
```css
:root {
  --bg-stage: #1a1a1a; --bg-card: #242424; --bg-raised: #2d2d2d; --bg-code: #1e1e1e;
  --border-default: #3a3a3a; --border-hover: #4a4a4a;
  --text-primary: #e8e8e8; --text-secondary: #a0a0a0; --text-tertiary: #6a6a6a; --text-ghost: #5a5a5a;
  --status-working: #4a9eff; --status-attention: #f0a030; --status-done: #4caf50; --status-conflict: #e05050;
}
body { background: var(--bg-stage); color: var(--text-primary); font-family: "Manrope", "Inter", sans-serif; margin: 0; padding: 12px; }
.board { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
.lane { display: flex; flex-direction: column; gap: 10px; }
.lane-header { font: 500 11px/1 "Manrope", sans-serif; text-transform: uppercase; letter-spacing: .06em; color: var(--text-tertiary); }
.lane-header .count { color: var(--text-tertiary); }
.lane-empty { min-height: 24px; border-top: 1px dashed var(--text-ghost); opacity: .4; }
.card { background: var(--bg-card); border: 1px solid var(--border-default); border-left-width: 2px; border-radius: 6px; padding: 10px; }
.card:hover { border-color: var(--border-hover); box-shadow: 0 2px 8px rgba(0,0,0,.4); }
.card .role { color: var(--text-primary); font-weight: 600; }
.card .engine { background: var(--bg-raised); color: var(--text-secondary); border-radius: 4px; padding: 0 6px; font-size: 11px; }
.card .goal { color: var(--text-tertiary); font-style: italic; font-size: 12px; }
.card .task { color: var(--text-primary); }
.card .dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
.card .diffstat .adds { color: var(--status-done); } .card .diffstat .dels { color: var(--status-conflict); }
.card .elapsed { color: var(--text-tertiary); margin-left: auto; }
.card .anatomy { color: var(--text-tertiary); font-size: 11px; }
/* lane accents: signal-only (2px left border + dot) */
.lane-working { border-left-color: var(--status-working); } .lane-working .dot { background: var(--status-working); }
.lane-needsYou { border-left-color: var(--status-attention); } .lane-needsYou .dot { background: var(--status-attention); }
.lane-conflict { border-left-color: var(--status-conflict); } .lane-conflict .dot { background: var(--status-conflict); }
.lane-done { border-left-color: var(--status-done); } .lane-done .dot { background: var(--status-done); }
/* drawer */
.drawer { position: fixed; top: 0; right: 0; width: 40%; height: 100%; background: var(--bg-code); border-left: 1px solid var(--border-default); box-shadow: -8px 0 24px rgba(0,0,0,.5); padding: 16px; overflow: auto; }
.drawer .tabs .tab { background: none; border: none; color: var(--text-tertiary); cursor: pointer; }
.drawer .tabs .tab.active { color: var(--text-primary); }
.output, .patch { background: var(--bg-code); color: var(--text-primary); white-space: pre-wrap; word-break: break-word; border-radius: 4px; padding: 8px; }
/* action-bar buttons inherit lane semantics: approve/merge green, deny/discard red, steer/sendBack neutral */
button[data-action="approve"], button[data-action="merge"], button[data-action="finish-merge"] { background: var(--status-done); color: #102010; }
button[data-action="deny"], button[data-action="discard"] { background: var(--status-conflict); color: #fff; }
button[data-action="steer"], button[data-action="sendBack"], .drawer button { background: var(--bg-raised); color: var(--text-primary); border: 1px solid var(--border-default); border-radius: 6px; padding: 4px 10px; cursor: pointer; }
```
(Manrope/Inter are loaded from bundled assets or fall back; font bundling is cosmetic polish, not a P1 blocker. Keep the CSS copy step in `build.mjs` as-is.)

- [ ] **Step 3: Build the webview** · `pnpm -F @maestro/extension build` → `dist/webview/main.js` + `dist/webview/style.css` emit, no esbuild errors.
- [ ] **Step 4: Typecheck** · `pnpm -F @maestro/extension typecheck` → clean (DOM lib resolves `document`/`MessageEvent`/`HTMLElement`/`setInterval`).
- [ ] **Step 5: Commit** · `feat(extension): laned board + drawer webview client; dark-graphite tokens (R2)`.

---

## Task H: Extension · thread the goal through the spawn command

**Files:**
- Modify: `packages/extension/src/extension.ts`
- Test: none new (the spawn message field is exercised by core/controller; verified by build + typecheck + manual F5).

**Context:** [R7](./README.md): the goal is set in P1 so the board shows the faint italic why line. P2 replaces this InputBox flow with the composer; P1 just adds an optional second InputBox after the task so the spawn message carries a `goal`. The `spawn` WebviewToHost variant currently is `{ roleName, description }`. P1 widens it minimally to carry an optional goal and threads it to `orch.spawn`.

- [ ] **Step 1: Widen the spawn message + guard.** In `packages/cockpit/src/protocol.ts`, change the `spawn` variant to `{ type: "spawn"; roleName: string; description: string; goal?: string }`. `isWebviewMessage`'s `spawn` case stays `isString(roleName) && isString(description)` (goal is optional; if present-but-not-string it is simply ignored, so add `&& (m["goal"] === undefined || isString(m["goal"]))` to reject a malformed goal). In `controller.ts`, the `spawn` case becomes `orch.spawn(message.roleName, message.description, message.goal)`, and `OrchestratorLike.spawn` widens to `(roleName, description, goal?) => Agent`. Add one controller test asserting the goal forwards (`calls` includes `spawn:Implementer:fix:why`).

- [ ] **Step 2: Wire the command.** In `extension.ts`'s `maestro.spawnAgent` handler, after the task InputBox, add an optional goal InputBox and pass it:
```ts
const goal = await vscode.window.showInputBox({
  prompt: `Goal for ${selectedRole.name} (the why; optional)`,
  placeHolder: "so that the refactor cannot silently break checkout",
});
// goal === undefined means the user escaped; "" means they confirmed empty. Treat
// empty as no goal so the card omits the faint line.
cockpit.handle({ type: "spawn", roleName: selectedRole.name, description, ...(goal ? { goal } : {}) });
```

- [ ] **Step 3: Verify** · `pnpm -F @maestro/cockpit test && pnpm -F @maestro/extension test && pnpm -F @maestro/extension typecheck && pnpm -F @maestro/extension build` → green, both bundles emit.
- [ ] **Step 4: Commit** · `feat(extension): spawn command captures optional goal -> board why line (R7)`.

---

## Task I: Full gate + roadmap status

**Files:**
- Modify: `docs/plans/2026-06-16-conducting-board-implementation/README.md` (P1 status)

- [ ] **Step 1: Run the repo-root gate:**
  - `pnpm -r typecheck` → clean across all packages.
  - `pnpm -r test` → core (existing + 2 goal tests), cockpit (lane + enriched reducer + lane-ordering), extension (board + drawer render), all green.
  - `pnpm -r build` → all packages build; extension emits `dist/extension.js`, `dist/webview/main.js`, `dist/webview/style.css`.
- [ ] **Step 2: Manual smoke (F5).** Open `packages/extension` in VS Code, F5, open a git repo, spawn an agent with a task and a goal. Confirm: a card lands in the Working lane showing role + engine chip + faint italic goal + task + elapsed timer; on done it moves to Done with `+adds -dels`; clicking it opens the drawer with Instructions / Output / Diff tabs and the right (capability-gated) controls.
- [ ] **Step 3: Update the roadmap README** · mark P1 done in the phases table / add a short "P1 shipped" note (laned board + rich cards + drawer over today's data model; lanes/goal seams established for later phases).
- [ ] **Step 4: Commit** · `docs: mark P1 (Conducting Board) shipped; lanes (R1) + goal (R7) seams established`.

---

## Self-Review (design requirement -> task)

Mapping each P1 design requirement (from [01](../2026-06-16-conducting-board-design/01-overview-and-visual-language.md) and [02](../2026-06-16-conducting-board-design/02-conducting-board-and-lifecycle.md)) to the task that delivers it:

- The hero laned board (Working / Needs you / Conflict / Done), calm-until-attention, lane headers with live counts, empty lanes as quiet placeholders -> **Task E** (`renderBoard`), **Task G** (dark tokens, accents).
- Canonical lane mapping over the real 12-state union, exhaustive, single home ([R1](./README.md)) -> **Task B** (`laneFor`).
- Attention-first ordering preserved *within* each lane -> **Task D** (`selectState` test; ordering unchanged).
- Rich card: role + status dot, engine chip, faint italic goal, task line, diffStat (+adds/-dels), elapsed timer, anatomy row (empty in P1) -> **Task C** (CardVM fields), **Task E** (render), **Task G** (timer tick + styles).
- The "why" goal line on the spawn path, carried onto agent/card ([R7](./README.md)) -> **Task A** (core `Task.goal`), **Task C** (CardVM.goal), **Task H** (spawn command).
- The right drawer with Instructions / Output / Diff tabs; Instructions read-only in P1 -> **Task F** (`renderDrawer`), **Task G** (tab switching).
- Capability-gated action bar: Approve/Deny only when approvals + awaiting-approval; Steer only when steerable; Send-back on done/conflict; controls absent not greyed -> **Task F** (reuses gated `approvalPanel`/`steerBox`/`sendBackBox`/`actions`).
- Answer-to-unblock reuses `steer`, no new protocol message -> **Task F** + protocol note (no `blocked` state exists; `steer` carries free text).
- Lightweight inline Diff tab (full review deferred to P6) -> **Task F** (`diffTab`).
- Dark-graphite canvas, not VS Code theme vars ([R2](./README.md)) -> **Task G** (`style.css` token block).
- Native Roster keeps working -> unchanged (`roster.ts`, `stage.ts`, `controller.ts`, `html.ts` untouched except the controller's one-line spawn-goal pass in Task H).

Invariants upheld: pure cockpit (`lane.ts`, `protocol.ts`, `reducer.ts`, `select.ts` import only `@maestro/core`, no `vscode`); `render.ts` imports only `@maestro/cockpit` + `./html.js`, no `vscode`; `isWebviewMessage` updated only for the optional `goal` (Task H); exhaustive `AgentState` coverage via `Record<AgentState, T>` in `lane.ts` and the carried-over `actions()` switch; every engine-supplied string escaped via `escapeHtml`.

### Deferred (owning phase)

- Dispatch composer (role preset chips, engine pills, goal+task modal) replacing the InputBox flow -> **P2**.
- `Role.skills`, `.conductor/skills` store, used-by index, Library shell + Skills tab -> **P3**. P1 ships `CardVM.skills?` undefined.
- Instructions editing, `Role.soul`, tools-grant model, full anatomy editor, populated anatomy row, composition-at-spawn preamble -> **P4**. P1 ships `soul?`/`toolsCount?`/`skills?` undefined and an omitted anatomy row.
- Discover tab + adopt flow -> **P5**.
- Full-width Diff/Merge review screen (conflict variant, PR mode, cleanup recovery) -> **P6**. P1 drawer Diff tab is the lightweight inline view.
- Ambient chrome (status-bar tally, Tweaks: density / live-output / reduce-motion) -> later UI polish.
