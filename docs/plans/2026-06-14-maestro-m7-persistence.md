# M7: Persistence + Rehydration

> ⚠ **RECONCILE FIRST.** Authored in parallel with M5/M6/M8/M9. Before executing, apply the cross-plan deltas in `2026-06-14-maestro-m5-m9-roadmap.md` → "Reconciliation Addendum", especially **R2** (adding `"detached"` to `AgentState` breaks the exhaustive `cardIcon()` and `actions()` switches and the `needsAttention()` set — extend all three), **R5** (`"detached"` is terminal; `"conflict"` stays NON-terminal by design), and **R6** (on hydrate, detach only genuinely mid-run agents; preserve `conflict`).

**Date:** 2026-06-14
**Milestone:** M7 · slug: `m7-persistence`
**Branch:** `m7-persistence` (branch off current `main` after M4 merge)
**Gate (before merging):** all existing 112 tests still green + new M7 tests green; `tsc` clean across all packages; esbuild extension build succeeds.

---

## Goal

Survive a VS Code reload without losing agent cards or event scrollback. On `activate`, rehydrate agent records from a gitignored `.conductor/.runtime/` event log so the cockpit rebuilds from replay. Agents whose subprocess is gone are marked `"detached"` (worktree preserved on disk). No on-disk work is ever lost.

---

## Architecture

### PID reattach: honest assessment

Reattaching to a live child PID across a VS Code extension reload is not feasible in general. When the extension host process exits (reload, crash, or VS Code shutdown), any child processes it spawned via `child_process.spawn` are orphaned or killed depending on the OS. Even if a PID is still running, Node.js provides no API to "adopt" an existing child and receive its stdout as a new `AsyncIterable`. Attempting to re-open the child's pipe FDs requires platform-specific tricks, is unreliable, and is out of scope for v1.

The robust v1 is therefore: **rehydrate the agent record and event-log scrollback, then mark the agent `"detached"` (worktree preserved)**. The user sees the full transcript, the diff, and can Merge or Discard manually. This is the honest behavior documented in the design doc ("marks them detached, worktree preserved"). Truly re-adopting a PID is deferred to a future milestone.

Worktrees live on disk under `.conductor/wt/<agentId>`. Because cleanup runs only on merge/discard (not on terminal-stream-end), a detached agent's worktree is always intact. The user never loses in-progress work.

### Event replay reconstructs cockpit state

The cockpit's `reduce()` in `packages/cockpit/src/reducer.ts` is already a pure fold: `(model, OrchestratorEvent) => CockpitModel`. Replaying the persisted JSONL through `reduce` reconstructs the card set exactly. No bespoke snapshot format is needed.

### Package-vs-module decision

**Decision: `packages/extension/src/persistence.ts` (a module in the extension package, NOT a new `packages/persistence` package).**

Justification:

1. The persistence logic has two seams: (a) a pure codec + replay layer that needs unit testing offline, and (b) a thin fs/workspaceState adapter that wires to VS Code APIs. The pure layer is small enough (three pure functions: `serialize`, `deserialize`, `replay`) to live in a single file with no package overhead.
2. A new package adds `package.json`, `tsconfig.json`, `tsconfig.build.json`, `vitest.config.ts`, and a pnpm workspace entry. The pure functions do not need to be consumed by any package other than `packages/extension`. There is no cross-package reuse case; adding a package for a single consumer is over-engineering.
3. The injectable-backend pattern (mirror of `SpawnFn`/`GitRunner`) keeps the pure layer fully offline-testable inside the extension package's existing Vitest suite. The thin adapter (`FsBackend`, `WorkspaceStateBackend`) is the only code that touches `vscode.ExtensionContext.workspaceState` and `node:fs/promises`, and that thin code is covered by typecheck + manual F5, same discipline as `roster.ts`/`stage.ts`.
4. This follows the precedent already set by `packages/extension/src/roster-map.ts`, `render.ts`, and `html.ts`: pure/vscode-free helpers in the same package, unit-tested directly.

Files added or modified:

```
packages/extension/src/persistence.ts          NEW — pure codec, replay, store abstraction
packages/extension/src/persistence.test.ts     NEW — offline unit tests (no fs, no vscode)
packages/extension/src/extension.ts            DELTA — load on activate, subscribe-to-save
packages/core/src/types.ts                     DELTA — add "detached" to AgentState union
packages/core/src/events.ts                    DELTA — add "detached" to TERMINAL set
packages/core/src/orchestrator.ts              DELTA — add hydrate()
packages/core/src/index.ts                     DELTA — re-export PersistedAgentRecord
```

---

## Tech Stack

- TypeScript ESM, NodeNext, `"strict": true`, `"noUncheckedIndexedAccess": true`
- Vitest (offline unit tests; no real fs in unit tests)
- `node:fs/promises` (production fs adapter, no new npm deps)
- VS Code `ExtensionContext.workspaceState` (lightweight kv store for the agent-id index)
- JSONL (one `OrchestratorEvent` JSON per line, newline-terminated)

---

## File Structure

```
packages/
  core/
    src/
      types.ts                   DELTA: add "detached" to AgentState
      events.ts                  DELTA: add "detached" to TERMINAL set
      orchestrator.ts            DELTA: add hydrate(records)
      index.ts                   DELTA: re-export PersistedAgentRecord
  extension/
    src/
      persistence.ts             NEW
      persistence.test.ts        NEW
      extension.ts               DELTA (activate() additions only)
```

Runtime directory (already gitignored via `.conductor/.runtime/` in `.gitignore`):

```
.conductor/
  .runtime/
    <agentId>.jsonl              one file per agent, append-only OrchestratorEvent lines
```

---

## Upstream Assumptions / Contract

M7 is independent of M5 and M6. It touches three shared files. Additive deltas are stated below and must be reconciled when M5/M6/M8/M9 plans are integrated:

- **`core/src/types.ts`:** M7 adds `"detached"` to `AgentState`. M8 may add `Team`. These are independent additions to the same union/file; they do not conflict.
- **`core/src/orchestrator.ts`:** M7 adds `hydrate(records)`. M6 adds `sendBack`. M9 adds merge-mutex + hardens merge. All are distinct additive methods; no delta touches the same lines.
- **`extension/src/extension.ts` `activate()`:** M7 adds load-on-start + subscribe-to-save. M5 registers the ACP adapter. M6 wires approve/steer/sendBack. M8 loads roles. M9 wires conflict-resolve. All are appended inside the existing `activate()` body; none rewrites the function.

M7 makes NO assumptions about M5 or M6. The `hydrate()` method works with the existing `AgentState` machine and the existing `OrchestratorEvent` types. M6's `sendBack` method, when added later, does not interact with persistence (it spawns a new session; a new `agent-added` + `agent-updated` stream will be appended by the same subscription that already persists every orchestrator event).

---

## Tasks

### Task 1 · DELTA `core/src/types.ts`: add `"detached"` state

**Why `"detached"` and not something else.** An agent that was `working` or `awaiting-approval` when the extension host exited has a live worktree but no live process. It is not `stopped` (the user did not request a stop), not `error` (no engine error occurred), and not `done` (work may be incomplete). A distinct state surfaces this to the UI and lets the conductor decide what to do: Merge (if the agent left useful work), Discard, or retry. `"conflict"` is already used for a different case (a git merge conflict). `"detached"` is the term used in the design doc and in the roadmap contract.

**Is `"detached"` terminal?** Yes. The process is gone; there is no live session to resume. The user must explicitly Merge or Discard. Therefore `"detached"` belongs in the `TERMINAL` set in `events.ts`. The `discard()` path in the orchestrator already handles `done|error|stopped|conflict`; M7 adds `detached` to `canDiscard`. `merge()` requires `done`; for a detached agent that left work, the user can merge directly from the `detached` state (or we allow merging from `detached` in the same condition as `done`). Both are addressed in the orchestrator delta below.

- [ ] Write a failing type-level test in `packages/core/src/types.test.ts` (or add to an existing types test if one exists) asserting that `"detached"` is a valid `AgentState` assignment:

  ```ts
  // packages/core/src/types.test.ts  (new file or append)
  import { describe, it, expectTypeOf } from "vitest";
  import type { AgentState } from "./types.js";

  describe("AgentState", () => {
    it("includes detached", () => {
      const s: AgentState = "detached"; // must compile
      expectTypeOf(s).toEqualTypeOf<AgentState>();
    });
  });
  ```

  Run: `pnpm --filter @maestro/core test` — fails (TS error: `"detached"` not assignable).

- [ ] Add `"detached"` to the `AgentState` union in `packages/core/src/types.ts`:

  ```ts
  // ADDITIVE DELTA — append "detached" to the union
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
    | "detached";   // process gone, worktree preserved; user decides merge/discard/retry
  ```

  Run: `pnpm --filter @maestro/core test` — green.

- [ ] Commit: `feat(core): add "detached" AgentState for orphaned-process agents`

---

### Task 2 · DELTA `core/src/events.ts`: `"detached"` is terminal

- [ ] Write a failing test asserting `isTerminalState("detached") === true`:

  ```ts
  // packages/core/src/events.test.ts  (append to existing file)
  it("treats detached as terminal", () => {
    expect(isTerminalState("detached")).toBe(true);
  });
  ```

  Run: red (returns false because the set does not include it yet).

- [ ] Add `"detached"` to the `TERMINAL` set in `packages/core/src/events.ts`:

  ```ts
  // ADDITIVE DELTA — extend the existing set literal
  const TERMINAL: ReadonlySet<AgentState> = new Set<AgentState>([
    "done",
    "error",
    "stopped",
    "merged",
    "discarded",
    "conflict",   // already added by M3
    "detached",   // added by M7
  ]);
  ```

  Run: green.

- [ ] Commit: `feat(core): mark "detached" as terminal in isTerminalState`

---

### Task 3 · DELTA `core/src/orchestrator.ts`: add `hydrate(records)`

**Design of `hydrate`.** The method restores agent records into the orchestrator's in-memory `agents` Map WITHOUT re-spawning, without creating worktrees, and without starting engine sessions. It is the inverse of the spawn/launch path. It also must NOT call `emitter.emit` for the `agent-added` events — the caller (extension `activate`) will subscribe to the orchestrator BEFORE calling hydrate, so replay of events for the UI is handled separately by the persistence layer; the orchestrator just needs the agent records internally so that `getAgents()` / `getAgent()` / `merge()` / `discard()` all work correctly after a reload.

Wait, there is a subtlety: the `createCockpit` controller subscribes to `orch.on(...)` and rebuilds its internal model from events. If `hydrate` does NOT emit events, the cockpit starts with an empty model. The solution: `hydrate` DOES emit `agent-added` + `agent-updated` for each restored record (just like spawn does), so the existing `createCockpit` subscription picks them up and rebuilds the card set without special-casing hydration. This keeps the cockpit a pure function of events, as the design requires.

**Signature:**

```ts
hydrate(records: readonly PersistedAgentRecord[]): void
```

where `PersistedAgentRecord` is defined in `persistence.ts` and re-exported from `core/index.ts`. But wait: the core should not import from the extension. The cleanest approach is to define `PersistedAgentRecord` in `core/src/types.ts` (or a new `core/src/persistence-types.ts` imported by `index.ts`), since it only uses types already in core.

**`PersistedAgentRecord` shape:**

```ts
// packages/core/src/types.ts  (additive delta)
export interface PersistedAgentRecord {
  agent: Agent;             // snapshot at last known state
  workspacePath?: string;   // .conductor/wt/<agentId> path (if worktree existed)
  workspaceBranch?: string; // agent/<slug>
}
```

`hydrate` restores each agent at the state it was in when last persisted, then:
- If the agent was in a non-terminal state (`working`, `awaiting-approval`, `preparing`) at reload, it transitions to `"detached"` (process is gone).
- If the agent was already in a terminal state (`done`, `error`, `stopped`, `merged`, `discarded`, `conflict`, `detached`), it is restored as-is (no state change).
- `running` counter is NOT incremented (there are no live sessions).
- The queue is NOT populated.
- The `sessions` Map is NOT populated.

After restoring, `hydrate` emits `agent-added` then (if state was changed to detached) `agent-updated` so the cockpit rebuilds the card.

`discard()` and `merge()` must handle `"detached"` state:
- `discard()` already allows `done|error|stopped|conflict`; add `"detached"` to `canDiscard`.
- `merge()` currently requires `state === "done"`. For a detached agent, the worktree may have useful partial work. Allow merging from `"detached"` as well (same condition). This is an additive delta to the `merge()` guard.

- [ ] Define `PersistedAgentRecord` and write a failing test for `hydrate`:

  ```ts
  // packages/core/src/orchestrator.test.ts  (append to existing test file)
  describe("Orchestrator.hydrate", () => {
    it("restores agent records and emits agent-added per record", () => {
      const orch = new Orchestrator({ maxParallelAgents: 3 }, new FakeWorkspaceProvider());
      const agent: Agent = {
        id: "agent-1",
        task: { id: "task-agent-1", description: "fix tests", roleName: "Implementer" },
        role: {
          name: "Implementer",
          instructions: "fix it",
          engine: { id: "copilot" },
          autonomy: "auto-approve-safe",
        },
        state: "done",
        log: [],
        summary: "fixed 3 tests",
        workspace: { agentId: "agent-1", path: "/repo/.conductor/wt/agent-1", branch: "agent/fix-tests" },
      };

      const events: OrchestratorEvent[] = [];
      orch.on((e) => events.push(e));

      orch.hydrate([{ agent }]);

      expect(events).toHaveLength(1);
      expect(events[0]!.kind).toBe("agent-added");
      expect(orch.getAgent("agent-1")).toMatchObject({ state: "done" });
    });

    it("transitions non-terminal agents to detached", () => {
      const orch = new Orchestrator({ maxParallelAgents: 3 }, new FakeWorkspaceProvider());
      const agent: Agent = {
        id: "agent-2",
        task: { id: "task-agent-2", description: "add feature", roleName: "Implementer" },
        role: {
          name: "Implementer",
          instructions: "add it",
          engine: { id: "copilot" },
          autonomy: "auto-approve-safe",
        },
        state: "working",
        log: [],
      };

      const events: OrchestratorEvent[] = [];
      orch.on((e) => events.push(e));

      orch.hydrate([{ agent }]);

      // expect agent-added (working) + agent-updated (detached)
      expect(events).toHaveLength(2);
      expect(events[0]!.kind).toBe("agent-added");
      expect(events[1]!.kind).toBe("agent-updated");
      expect(orch.getAgent("agent-2")?.state).toBe("detached");
    });

    it("does not increment running counter (no sessions)", () => {
      const orch = new Orchestrator({ maxParallelAgents: 1 }, new FakeWorkspaceProvider());
      orch.registerAdapter(new FakeEngineAdapter());
      orch.registerRole({
        name: "Implementer",
        instructions: "",
        engine: { id: "fake" },
        autonomy: "auto-approve-safe",
      });
      const agent: Agent = {
        id: "agent-3",
        task: { id: "task-agent-3", description: "x", roleName: "Implementer" },
        role: {
          name: "Implementer",
          instructions: "",
          engine: { id: "fake" },
          autonomy: "auto-approve-safe",
        },
        state: "done",
        log: [],
      };
      orch.hydrate([{ agent }]);
      // maxParallelAgents = 1; if running were incremented, this spawn would queue
      const spawned = orch.spawn("Implementer", "new task");
      expect(spawned.state).toBe("preparing"); // will be immediately promoted since running === 0
      // give the microtask queue a tick — state should be working (launch ran)
      // (exact async assertion left to implementer; the point is no queue block)
    });
  });
  ```

  Run: red (method does not exist).

- [ ] Add `PersistedAgentRecord` to `packages/core/src/types.ts` (additive):

  ```ts
  // packages/core/src/types.ts  (append after Agent interface)

  /** Minimal record persisted per agent so the orchestrator can rehydrate after reload. */
  export interface PersistedAgentRecord {
    /** Full agent snapshot at the last persisted state. */
    agent: Agent;
    /** Absolute path to the agent's worktree, if one was created. */
    workspacePath?: string;
    /** Branch name, e.g. "agent/fix-tests". */
    workspaceBranch?: string;
  }
  ```

- [ ] Add `hydrate(records)` to `Orchestrator` in `packages/core/src/orchestrator.ts` (additive method, no existing lines changed):

  ```ts
  // packages/core/src/orchestrator.ts  (append method inside class body)

  /**
   * Restore agent records from a previous session WITHOUT re-spawning.
   * Agents that were in a non-terminal state (working, awaiting-approval, preparing)
   * are transitioned to "detached": the process is gone but the worktree survives on disk.
   * Emits agent-added (and agent-updated on detach transition) for each record so
   * subscribers (e.g. createCockpit) rebuild their state from the event stream.
   */
  hydrate(records: readonly PersistedAgentRecord[]): void {
    for (const record of records) {
      const agent: Agent = { ...record.agent };
      if (record.agent.workspace === undefined && record.workspacePath !== undefined) {
        agent.workspace = {
          agentId: agent.id,
          path: record.workspacePath,
          branch: record.workspaceBranch ?? "",
        };
      }
      this.agents.set(agent.id, agent);
      this.emitter.emit({ kind: "agent-added", agent });
      if (!isTerminalState(agent.state)) {
        // The process is gone. Mark detached so the UI shows a recoverable state.
        agent.state = "detached";
        this.emitter.emit({ kind: "agent-updated", agent });
      }
    }
  }
  ```

- [ ] Extend `canDiscard` to include `"detached"`:

  ```ts
  // packages/core/src/orchestrator.ts  (edit canDiscard, additive — add "detached")
  private canDiscard(state: AgentState): boolean {
    return (
      state === "done" ||
      state === "error" ||
      state === "stopped" ||
      state === "conflict" ||
      state === "detached"
    );
  }
  ```

- [ ] Extend `merge()` guard to allow `"detached"` in addition to `"done"`:

  ```ts
  // packages/core/src/orchestrator.ts  (additive: widen the guard in merge())
  async merge(agentId: string): Promise<MergeResult> {
    const agent = this.requireAgent(agentId);
    if (agent.state !== "done" && agent.state !== "detached") {
      throw new Error(
        `Agent ${agentId} is not ready to merge (state: ${agent.state})`,
      );
    }
    // ... rest unchanged
  ```

- [ ] Re-export `PersistedAgentRecord` from `packages/core/src/index.ts` (additive):

  ```ts
  // packages/core/src/index.ts  (append; no existing lines changed)
  // PersistedAgentRecord is already exported via "export * from "./types.js"" — confirm
  // and if not, add: export type { PersistedAgentRecord } from "./types.js";
  ```

  (Since `index.ts` already does `export * from "./types.js"`, adding `PersistedAgentRecord` to `types.ts` exports it automatically. No change to `index.ts` is needed.)

  Run tests: `pnpm --filter @maestro/core test` — all green including new hydrate tests.

- [ ] Commit: `feat(core): add Orchestrator.hydrate() and PersistedAgentRecord; detached discard/merge`

---

### Task 4 · NEW `packages/extension/src/persistence.ts`: pure codec + injectable store

This is the heart of M7. The file has three sections:

**Section A: Codec** — pure functions to serialize an `OrchestratorEvent` to a JSONL line and parse it back. Serialization is `JSON.stringify(event) + "\n"`. Parsing is `JSON.parse(line)` with a discriminant check. No schema library needed; the types are self-describing.

**Section B: Replay** — a pure function that folds a list of events through the cockpit `reduce` function to reconstruct a `CockpitModel` (and separately folds `agent-added`/`agent-updated` events to extract `PersistedAgentRecord` snapshots for `hydrate`). This reuses the cockpit reducer directly and adds zero new logic.

**Section C: Store abstraction** — a `PersistenceBackend` interface with `read(agentId): Promise<string>` and `append(agentId, line: string): Promise<void>` and `listAgentIds(): Promise<string[]>` and `remove(agentId): Promise<void>`. Two implementations:
- `FsPersistenceBackend` (production): wraps `node:fs/promises`, writes to `.conductor/.runtime/<agentId>.jsonl`.
- `MemoryPersistenceBackend` (test double): in-memory Map, no real fs, used in all unit tests.

The `EventLogger` class wires the two sides: it subscribes to `orch.on(...)` and calls `backend.append` for every event. It also exposes `loadAll()` which reads all agent logs, replays them, and returns the `PersistedAgentRecord[]` for `orch.hydrate`.

- [ ] Write failing unit tests for the codec (round-trip):

  ```ts
  // packages/extension/src/persistence.test.ts  (new file)
  import { describe, it, expect, beforeEach } from "vitest";
  import {
    serializeEvent,
    deserializeEvent,
    replayToRecords,
    MemoryPersistenceBackend,
    EventLogger,
  } from "./persistence.js";
  import type { OrchestratorEvent } from "@maestro/core";

  describe("serializeEvent / deserializeEvent round-trip", () => {
    it("round-trips agent-added", () => {
      const event: OrchestratorEvent = {
        kind: "agent-added",
        agent: {
          id: "a1",
          task: { id: "t1", description: "fix it", roleName: "Implementer" },
          role: {
            name: "Implementer",
            instructions: "do the thing",
            engine: { id: "copilot" },
            autonomy: "auto-approve-safe",
          },
          state: "working",
          log: [],
        },
      };
      const line = serializeEvent(event);
      expect(line.endsWith("\n")).toBe(true);
      expect(JSON.parse(line)).toEqual(event);
      const parsed = deserializeEvent(line.trim());
      expect(parsed).toEqual(event);
    });

    it("round-trips agent-event with output", () => {
      const event: OrchestratorEvent = {
        kind: "agent-event",
        agentId: "a1",
        event: { kind: "output", text: "hello world" },
      };
      const parsed = deserializeEvent(serializeEvent(event).trim());
      expect(parsed).toEqual(event);
    });

    it("round-trips agent-updated with summary and diff", () => {
      const event: OrchestratorEvent = {
        kind: "agent-updated",
        agent: {
          id: "a1",
          task: { id: "t1", description: "fix it", roleName: "Implementer" },
          role: {
            name: "Implementer",
            instructions: "do the thing",
            engine: { id: "copilot" },
            autonomy: "auto-approve-safe",
          },
          state: "done",
          log: [],
          summary: "patched 3 tests",
          diff: { files: ["src/foo.ts"], patch: "- old\n+ new" },
        },
      };
      const parsed = deserializeEvent(serializeEvent(event).trim());
      expect(parsed).toEqual(event);
    });

    it("returns null for malformed JSON", () => {
      expect(deserializeEvent("not json")).toBeNull();
    });

    it("returns null for a JSON object with no kind field", () => {
      expect(deserializeEvent('{"foo":1}')).toBeNull();
    });
  });
  ```

  Run: red (module does not exist).

- [ ] Write failing tests for `replayToRecords`:

  ```ts
  // packages/extension/src/persistence.test.ts  (append)
  describe("replayToRecords", () => {
    it("extracts the last known Agent snapshot per agent-id", () => {
      const agentBase = {
        id: "a1",
        task: { id: "t1", description: "x", roleName: "R" },
        role: { name: "R", instructions: "", engine: { id: "copilot" }, autonomy: "auto-approve-safe" as const },
        log: [] as never[],
      };
      const events: OrchestratorEvent[] = [
        { kind: "agent-added", agent: { ...agentBase, state: "preparing" } },
        { kind: "agent-updated", agent: { ...agentBase, state: "working" } },
        { kind: "agent-event", agentId: "a1", event: { kind: "output", text: "hi" } },
        { kind: "agent-updated", agent: { ...agentBase, state: "done", summary: "done" } },
      ];
      const records = replayToRecords(events);
      expect(records).toHaveLength(1);
      expect(records[0]!.agent.state).toBe("done");
      expect(records[0]!.agent.summary).toBe("done");
    });

    it("handles multiple agents", () => {
      const mkAgent = (id: string): OrchestratorEvent => ({
        kind: "agent-added",
        agent: {
          id,
          task: { id: `t-${id}`, description: "x", roleName: "R" },
          role: { name: "R", instructions: "", engine: { id: "copilot" }, autonomy: "auto-approve-safe" },
          state: "working",
          log: [],
        },
      });
      const events: OrchestratorEvent[] = [mkAgent("a1"), mkAgent("a2")];
      const records = replayToRecords(events);
      expect(records).toHaveLength(2);
      const ids = records.map((r) => r.agent.id).sort();
      expect(ids).toEqual(["a1", "a2"]);
    });

    it("returns empty array for empty event list", () => {
      expect(replayToRecords([])).toEqual([]);
    });
  });
  ```

  Run: still red.

- [ ] Write failing tests for `MemoryPersistenceBackend` and `EventLogger`:

  ```ts
  // packages/extension/src/persistence.test.ts  (append)
  describe("MemoryPersistenceBackend", () => {
    it("appends and reads lines", async () => {
      const backend = new MemoryPersistenceBackend();
      await backend.append("a1", "line1\n");
      await backend.append("a1", "line2\n");
      const content = await backend.read("a1");
      expect(content).toBe("line1\nline2\n");
    });

    it("lists agent ids", async () => {
      const backend = new MemoryPersistenceBackend();
      await backend.append("a1", "x\n");
      await backend.append("a2", "y\n");
      const ids = await backend.listAgentIds();
      expect(ids.sort()).toEqual(["a1", "a2"]);
    });

    it("returns empty string for unknown agent", async () => {
      const backend = new MemoryPersistenceBackend();
      expect(await backend.read("missing")).toBe("");
    });

    it("remove deletes the agent log", async () => {
      const backend = new MemoryPersistenceBackend();
      await backend.append("a1", "x\n");
      await backend.remove("a1");
      expect(await backend.listAgentIds()).toEqual([]);
    });
  });

  describe("EventLogger", () => {
    it("appends serialized events to the backend", async () => {
      const backend = new MemoryPersistenceBackend();
      const event: OrchestratorEvent = {
        kind: "agent-added",
        agent: {
          id: "a1",
          task: { id: "t1", description: "x", roleName: "R" },
          role: { name: "R", instructions: "", engine: { id: "copilot" }, autonomy: "auto-approve-safe" },
          state: "preparing",
          log: [],
        },
      };
      const logger = new EventLogger(backend);
      logger.write(event);
      await new Promise((r) => setTimeout(r, 0)); // flush microtask
      const content = await backend.read("a1");
      const parsed = deserializeEvent(content.trim());
      expect(parsed).toEqual(event);
    });

    it("extracts agent id from agent-event", async () => {
      const backend = new MemoryPersistenceBackend();
      // seed agent-added first so a1 is a known agent
      const added: OrchestratorEvent = {
        kind: "agent-added",
        agent: {
          id: "a1",
          task: { id: "t1", description: "x", roleName: "R" },
          role: { name: "R", instructions: "", engine: { id: "copilot" }, autonomy: "auto-approve-safe" },
          state: "preparing",
          log: [],
        },
      };
      const outputEvent: OrchestratorEvent = {
        kind: "agent-event",
        agentId: "a1",
        event: { kind: "output", text: "hello" },
      };
      const logger = new EventLogger(backend);
      logger.write(added);
      logger.write(outputEvent);
      await new Promise((r) => setTimeout(r, 0));
      const lines = (await backend.read("a1")).trim().split("\n");
      expect(lines).toHaveLength(2);
    });

    it("loadAll replays all agents and returns PersistedAgentRecord[]", async () => {
      const backend = new MemoryPersistenceBackend();
      const addedEvent: OrchestratorEvent = {
        kind: "agent-added",
        agent: {
          id: "a1",
          task: { id: "t1", description: "x", roleName: "R" },
          role: { name: "R", instructions: "", engine: { id: "copilot" }, autonomy: "auto-approve-safe" },
          state: "working",
          log: [],
        },
      };
      const updatedEvent: OrchestratorEvent = {
        kind: "agent-updated",
        agent: { ...(addedEvent as { kind: "agent-added"; agent: { id: string; task: never; role: never; state: "done"; log: never[] } }).agent, state: "done", summary: "done" },
      };
      // write lines directly
      await backend.append("a1", serializeEvent(addedEvent));
      await backend.append("a1", serializeEvent(updatedEvent));

      const logger = new EventLogger(backend);
      const records = await logger.loadAll();
      expect(records).toHaveLength(1);
      expect(records[0]!.agent.state).toBe("done");
    });
  });
  ```

  Run: all red.

- [ ] Implement `packages/extension/src/persistence.ts`:

  ```ts
  import type { OrchestratorEvent, PersistedAgentRecord, Agent } from "@maestro/core";

  // ---------------------------------------------------------------------------
  // Section A: Codec
  // ---------------------------------------------------------------------------

  /**
   * Serialize one OrchestratorEvent to a JSONL line (JSON + newline).
   * Pure function, no I/O.
   */
  export function serializeEvent(event: OrchestratorEvent): string {
    return JSON.stringify(event) + "\n";
  }

  /**
   * Parse a JSONL line back to an OrchestratorEvent.
   * Returns null for malformed JSON or objects without a recognized `kind`.
   * Pure function, no I/O.
   */
  export function deserializeEvent(line: string): OrchestratorEvent | null {
    try {
      const obj: unknown = JSON.parse(line);
      if (
        obj === null ||
        typeof obj !== "object" ||
        !("kind" in obj) ||
        typeof (obj as { kind: unknown }).kind !== "string"
      ) {
        return null;
      }
      // Trust the shape: the only writer is serializeEvent which writes typed events.
      // A schema validator can be added here in a future hardening milestone.
      return obj as OrchestratorEvent;
    } catch {
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Section B: Replay
  // ---------------------------------------------------------------------------

  /**
   * Fold a list of OrchestratorEvents into an array of PersistedAgentRecord,
   * one per unique agent id. The record's `agent` field reflects the last
   * `agent-added` or `agent-updated` snapshot for that agent.
   *
   * Pure function: used both to reconstruct records for `orch.hydrate` and to
   * verify round-trip fidelity in tests.
   */
  export function replayToRecords(events: readonly OrchestratorEvent[]): PersistedAgentRecord[] {
    const latest = new Map<string, Agent>();
    for (const event of events) {
      if (event.kind === "agent-added") {
        latest.set(event.agent.id, event.agent);
      } else if (event.kind === "agent-updated") {
        latest.set(event.agent.id, event.agent);
      }
      // agent-event carries no agent snapshot; ignored here (cockpit reducer handles output)
    }
    return [...latest.values()].map((agent) => ({
      agent,
      workspacePath: agent.workspace?.path,
      workspaceBranch: agent.workspace?.branch,
    }));
  }

  // ---------------------------------------------------------------------------
  // Section C: Store abstraction with injectable backend
  // ---------------------------------------------------------------------------

  /**
   * Persistence backend interface. The pure logic above does not know about
   * files or VS Code; this interface is the seam.
   *
   * Implementations:
   *   - MemoryPersistenceBackend  (tests, offline)
   *   - FsPersistenceBackend      (production, node:fs/promises)
   */
  export interface PersistenceBackend {
    /** Read the full content of one agent's JSONL log. Returns "" if not found. */
    read(agentId: string): Promise<string>;
    /** Append one line (already serialized, includes trailing newline) to the agent log. */
    append(agentId: string, line: string): Promise<void>;
    /** List all agent IDs that have a persisted log. */
    listAgentIds(): Promise<string[]>;
    /** Delete an agent's log (called when the agent is discarded or merged). */
    remove(agentId: string): Promise<void>;
  }

  /** In-memory backend for unit tests. No real fs. */
  export class MemoryPersistenceBackend implements PersistenceBackend {
    private readonly store = new Map<string, string>();

    async read(agentId: string): Promise<string> {
      return this.store.get(agentId) ?? "";
    }

    async append(agentId: string, line: string): Promise<void> {
      this.store.set(agentId, (this.store.get(agentId) ?? "") + line);
    }

    async listAgentIds(): Promise<string[]> {
      return [...this.store.keys()];
    }

    async remove(agentId: string): Promise<void> {
      this.store.delete(agentId);
    }
  }

  /**
   * Routes OrchestratorEvents to the correct agent's log file.
   *
   * Usage:
   *   const logger = new EventLogger(backend);
   *   const unsub = orch.on((e) => logger.write(e));
   *   // on activate:
   *   const records = await logger.loadAll();
   *   orch.hydrate(records);
   */
  export class EventLogger {
    constructor(private readonly backend: PersistenceBackend) {}

    /** Write one event to the correct agent log. Fire-and-forget; errors logged to console. */
    write(event: OrchestratorEvent): void {
      const agentId = agentIdOf(event);
      if (agentId === null) return;
      const line = serializeEvent(event);
      this.backend.append(agentId, line).catch((err: unknown) => {
        console.error(`[Maestro persistence] Failed to persist event for ${agentId}:`, err);
      });
    }

    /**
     * Read all agent logs, parse events, and return hydration records.
     * Called once on activate before subscribing to new events.
     */
    async loadAll(): Promise<PersistedAgentRecord[]> {
      const ids = await this.backend.listAgentIds();
      const allEvents: OrchestratorEvent[] = [];
      for (const id of ids) {
        const content = await this.backend.read(id);
        const lines = content.split("\n").filter((l) => l.length > 0);
        for (const line of lines) {
          const event = deserializeEvent(line);
          if (event !== null) allEvents.push(event);
        }
      }
      return replayToRecords(allEvents);
    }

    /** Remove the log for a terminal agent (called after merge or discard). */
    async forget(agentId: string): Promise<void> {
      await this.backend.remove(agentId);
    }
  }

  // ---------------------------------------------------------------------------
  // Internal helper
  // ---------------------------------------------------------------------------

  function agentIdOf(event: OrchestratorEvent): string | null {
    switch (event.kind) {
      case "agent-added":
        return event.agent.id;
      case "agent-updated":
        return event.agent.id;
      case "agent-event":
        return event.agentId;
      default:
        // TypeScript exhaustive check would need never here; safe fallback:
        return null;
    }
  }
  ```

  Run: `pnpm --filter @maestro/extension test` — all persistence tests green.

- [ ] Commit: `feat(extension): persistence codec, replay, injectable backend, EventLogger`

---

### Task 5 · NEW `packages/extension/src/persistence-fs.ts`: production fs backend

This file imports `node:fs/promises` and is deliberately separated from `persistence.ts` so the pure module stays importable in browser/test environments without a `node:` polyfill concern. It is NOT unit-tested (thin wiring to real fs); it is covered by typecheck + esbuild build + a manual integration smoke test noted in the self-review checklist.

- [ ] Write the `FsPersistenceBackend` in `packages/extension/src/persistence-fs.ts`:

  ```ts
  import { mkdir, readFile, appendFile, readdir, unlink } from "node:fs/promises";
  import { join } from "node:path";
  import type { PersistenceBackend } from "./persistence.js";

  /**
   * Production backend: writes one JSONL file per agent under
   * `.conductor/.runtime/<agentId>.jsonl` in the workspace root.
   *
   * The directory is gitignored (`.conductor/.runtime/`).
   * The directory is created lazily on first write.
   */
  export class FsPersistenceBackend implements PersistenceBackend {
    private readonly dir: string;

    constructor(repoRoot: string) {
      this.dir = join(repoRoot, ".conductor", ".runtime");
    }

    private filePath(agentId: string): string {
      // Sanitize: agent ids are generated by the orchestrator as `agent-<n>` or a uuid.
      // Replace any path-separating characters just in case.
      const safe = agentId.replace(/[/\\]/g, "_");
      return join(this.dir, `${safe}.jsonl`);
    }

    async read(agentId: string): Promise<string> {
      try {
        return await readFile(this.filePath(agentId), "utf8");
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return "";
        throw err;
      }
    }

    async append(agentId: string, line: string): Promise<void> {
      await mkdir(this.dir, { recursive: true });
      await appendFile(this.filePath(agentId), line, "utf8");
    }

    async listAgentIds(): Promise<string[]> {
      try {
        const entries = await readdir(this.dir);
        return entries
          .filter((e) => e.endsWith(".jsonl"))
          .map((e) => e.slice(0, -".jsonl".length));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw err;
      }
    }

    async remove(agentId: string): Promise<void> {
      try {
        await unlink(this.filePath(agentId));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
        throw err;
      }
    }
  }
  ```

  Run `tsc` (typecheck only): clean.

- [ ] Commit: `feat(extension): FsPersistenceBackend for production fs writes`

---

### Task 6 · DELTA `packages/extension/src/extension.ts`: wire persistence in `activate()`

This is the thin glue. The delta adds three things to `activate()`:
1. Construct `FsPersistenceBackend` and `EventLogger`.
2. Call `logger.loadAll()` to get persisted records, then `orch.hydrate(records)`, BEFORE creating the cockpit (so the cockpit's `orch.on` subscription picks up the hydration events).
3. Subscribe `logger.write` to `orch.on(...)` so every future event is appended to the log.
4. Call `logger.forget(agentId)` when an agent merges or discards (listen to `agent-updated` events where state is `merged` or `discarded`).

The `activate()` function must remain `async` (or use `void`). Since `activate` is currently synchronous, wrap the async init in a `void` IIFE or change `activate` to `async`. The VS Code extension host accepts `async activate()` and `Promise<void>` return; this is a safe change.

Alternatively, keep `activate` synchronous and use `orch.hydrate([])` as a no-op initially, then trigger the async load and call `hydrate` later. The problem: if hydration is async and happens after the cockpit subscribes, the cockpit will still see the emitted events (since `hydrate` emits them synchronously when called). So the correct pattern is:

```
activate():
  1. create orch (no hydrate yet)
  2. create cockpit (subscribes to orch.on)
  3. async: load records, call orch.hydrate(records), subscribe logger
```

Step 3 runs after step 2, which means when `hydrate` fires its events, the cockpit listener is already registered. This is safe.

- [ ] Write a failing extension unit test for the hydration wiring (using a fake orchestrator and fake backend):

  ```ts
  // packages/extension/src/persistence-activate.test.ts  (new file)
  // Tests the wiring function, not activate() itself (which imports vscode).
  import { describe, it, expect, vi } from "vitest";
  import { MemoryPersistenceBackend, EventLogger, serializeEvent } from "./persistence.js";
  import { replayToRecords } from "./persistence.js";
  import type { OrchestratorEvent, PersistedAgentRecord } from "@maestro/core";

  describe("EventLogger.loadAll + replayToRecords integration", () => {
    it("round-trips a done agent through the backend", async () => {
      const backend = new MemoryPersistenceBackend();
      // Simulate events that were written by a previous session
      const agent = {
        id: "a1",
        task: { id: "t1", description: "fix", roleName: "Implementer" },
        role: { name: "Implementer", instructions: "", engine: { id: "copilot" }, autonomy: "auto-approve-safe" as const },
        state: "done" as const,
        log: [],
        summary: "all fixed",
      };
      await backend.append("a1", serializeEvent({ kind: "agent-added", agent: { ...agent, state: "working" } }));
      await backend.append("a1", serializeEvent({ kind: "agent-updated", agent }));

      const logger = new EventLogger(backend);
      const records = await logger.loadAll();
      expect(records).toHaveLength(1);
      expect(records[0]!.agent.state).toBe("done");
      expect(records[0]!.agent.summary).toBe("all fixed");
    });

    it("EventLogger.write routes agent-event to the correct agent file", async () => {
      const backend = new MemoryPersistenceBackend();
      const logger = new EventLogger(backend);
      // Must have an agent-added first for the id to be routed
      const addedEvent: OrchestratorEvent = {
        kind: "agent-added",
        agent: {
          id: "a2",
          task: { id: "t2", description: "y", roleName: "R" },
          role: { name: "R", instructions: "", engine: { id: "copilot" }, autonomy: "auto-approve-safe" },
          state: "working",
          log: [],
        },
      };
      logger.write(addedEvent);
      logger.write({ kind: "agent-event", agentId: "a2", event: { kind: "output", text: "hi" } });
      await new Promise((r) => setTimeout(r, 10));
      const content = await backend.read("a2");
      expect(content.split("\n").filter(Boolean)).toHaveLength(2);
    });
  });
  ```

  Run: red (persistence-activate.test.ts does not yet exist, but the imports resolve; the test itself should pass once persistence.ts exists, so it may actually go green here after Task 4. Adjust as needed.)

- [ ] Add the following wiring to `packages/extension/src/extension.ts` as a pure ADDITIVE delta (the `activate` function body gains new lines; no existing lines change):

  ```ts
  // NEW imports at top (additive):
  import { EventLogger } from "./persistence.js";
  import { FsPersistenceBackend } from "./persistence-fs.js";

  // Inside activate(), after `orch.registerRole(DEFAULT_ROLE)` and before `const roster = ...`:
  // (additive block — insert between orch setup and roster/stage setup)

  const persistBackend = new FsPersistenceBackend(repoRoot);
  const eventLogger = new EventLogger(persistBackend);

  // Async hydration: load persisted records and restore agent state.
  // We create cockpit AFTER hydration so the on() listener is live when hydrate fires.
  // We use void + immediately-invoked async to stay within synchronous activate().
  // The cockpit creation is deferred into the async continuation below.

  // ... but to keep the cockpit creation in the synchronous flow,
  // we instead create the cockpit first (it registers orch.on),
  // then async-hydrate (hydrate emits events, cockpit listener is already registered).
  ```

  The final wiring in `activate()` after all existing setup:

  ```ts
  // Persistence: subscribe to save all future events.
  const unsubPersist = orch.on((event) => eventLogger.write(event));

  // Also forget logs when agents resolve (keeps .runtime/ tidy).
  const unsubForget = orch.on((event) => {
    if (
      event.kind === "agent-updated" &&
      (event.agent.state === "merged" || event.agent.state === "discarded")
    ) {
      void eventLogger.forget(event.agent.id);
    }
  });

  // Async: load persisted records and hydrate the orchestrator.
  // Cockpit is already subscribed to orch.on, so hydrate's emitted events
  // will rebuild the card set automatically.
  void (async () => {
    try {
      const records = await eventLogger.loadAll();
      if (records.length > 0) {
        orch.hydrate(records);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      void vscode.window.showWarningMessage(`Maestro: could not restore previous session: ${msg}`);
    }
  })();

  // Register cleanup disposables.
  context.subscriptions.push(
    { dispose: () => { unsubPersist(); unsubForget(); } },
    // ... existing disposables already in context.subscriptions.push below
  );
  ```

  Note: the existing `context.subscriptions.push(...)` block already exists at the end of `activate()`. The persistence disposables are added to it as an additional entry. The exact merged form of `context.subscriptions.push` is:

  ```ts
  context.subscriptions.push(
    { dispose: () => { unsubPersist(); unsubForget(); } },
    roster,
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
      try {
        cockpit.handle({ type: "spawn", roleName: DEFAULT_ROLE.name, description });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        void vscode.window.showErrorMessage(`Maestro: could not spawn agent: ${message}`);
      }
    }),
    { dispose: () => cockpit.dispose() },
  );
  ```

- [ ] Verify `tsc` is clean: `pnpm --filter @maestro/extension exec tsc --noEmit`.
- [ ] Verify esbuild builds: `pnpm --filter @maestro/extension run build`.
- [ ] Run full gate: `pnpm -r test` — all 112 existing + new M7 tests green.
- [ ] Commit: `feat(extension): wire EventLogger in activate(); load/hydrate on start, forget on resolve`

---

### Task 7 · Integration smoke test (manual, not automated)

No automated test covers the real fs path or the real VS Code `workspaceState` (those require the extension host). The smoke test verifies the end-to-end reload experience manually via F5.

Steps to perform and record in the self-review checklist:

1. F5 launch the extension in a git repo with one committed file.
2. Spawn an agent via `maestro.spawnAgent`. Wait until it reaches `done` state.
3. Confirm `.conductor/.runtime/<agentId>.jsonl` exists and contains valid JSONL lines.
4. Reload VS Code extension host (Developer: Restart Extension Host).
5. Confirm the agent card reappears in the roster with state `done` (terminal, restored as-is).
6. Spawn a second agent; let it reach `working`. Kill VS Code (not reload — full exit). Reopen.
7. Confirm the second agent card reappears with state `detached`.
8. Confirm the user can click Discard on the detached agent and the worktree is removed.
9. Confirm the detached agent's JSONL file is removed from `.conductor/.runtime/` after discard.

- [ ] Commit: `test(extension): manual smoke-test checklist for M7 persistence` (add checklist as comment in `persistence.ts` or as a note in this plan; no automated test file; this commit can be empty or contain a test-notes comment block).

---

### Task 8 · DELTA `packages/core/src/events.ts`: confirm `"conflict"` and `"detached"` align

`"conflict"` was added by M3 but the roadmap notes that `isTerminalState` uses a Set (not an exhaustive switch), so extending it is safe. Confirm the set in events.ts after all M7 changes is correct:

```ts
// Final state of packages/core/src/events.ts after M7:
const TERMINAL: ReadonlySet<AgentState> = new Set<AgentState>([
  "done",
  "error",
  "stopped",
  "merged",
  "discarded",
  "conflict",   // M3
  "detached",   // M7
]);
```

`"detached"` is terminal (the process is gone; user must explicitly act). `"conflict"` is also in the terminal set (it was already there from M3's design) even though the design doc calls it "non-terminal" in the sense that a conflicted worktree can be resolved. This is an existing M3 design decision; M7 does not change it.

- [ ] Run `pnpm --filter @maestro/core test` one more time after all core deltas are in. Confirm all 47 existing + new M7 core tests pass.
- [ ] Commit: `chore(core): verify terminal set contains conflict and detached after M7 deltas`

---

## Self-Review Checklist

- [ ] All 112 existing tests still green after M7 (`pnpm -r test`).
- [ ] New M7 tests green: persistence codec round-trip, replayToRecords, MemoryPersistenceBackend, EventLogger, hydrate, isTerminalState("detached").
- [ ] `tsc` clean across all five packages.
- [ ] esbuild extension build succeeds (`pnpm --filter @maestro/extension run build`).
- [ ] No em dashes in any file, comment, or commit message.
- [ ] `"detached"` is in the `TERMINAL` Set; `isTerminalState("detached") === true`.
- [ ] `hydrate([])` is a no-op (empty array, no events emitted, no crash).
- [ ] `hydrate` does NOT increment the `running` counter or touch the queue.
- [ ] Agent in `done` state survives reload with state `done` (no spurious detach).
- [ ] Agent in `working` state at reload becomes `detached` after hydrate.
- [ ] `canDiscard` accepts `"detached"`.
- [ ] `merge()` accepts `"detached"` (allows merge from detached if worktree is intact).
- [ ] `forget()` is called after `merged` or `discarded` events (log file removed from `.runtime/`).
- [ ] `.conductor/.runtime/` appears in `.gitignore` (already confirmed — line 4 of `.gitignore`).
- [ ] `FsPersistenceBackend.read` returns `""` (not throws) for a missing agent (ENOENT handled).
- [ ] `FsPersistenceBackend.listAgentIds` returns `[]` (not throws) when `.runtime/` does not exist yet.
- [ ] `FsPersistenceBackend.append` creates `.conductor/.runtime/` with `{ recursive: true }` on first write.
- [ ] Agent id sanitized before use as filename (replace `/` and `\` with `_`).
- [ ] PID-reattach honestly documented: v1 marks orphaned agents `detached`; no process re-adoption.
- [ ] Manual smoke test (Task 7) completed: reload restores done agent, kill+reopen produces detached agent, discard works, log file removed.
- [ ] `PersistedAgentRecord` exported from `@maestro/core` (via `export * from "./types.js"` chain).
- [ ] No new npm dependencies added; only `node:fs/promises` (Node built-in, no install needed).
- [ ] The `EventLogger` constructor is injectable: tests use `MemoryPersistenceBackend`, production uses `FsPersistenceBackend`. No real fs in any unit test.
- [ ] `persistence.ts` and `persistence-fs.ts` do NOT import from `"vscode"` (they are pure/node-only and safe to unit-test under Vitest without a host stub).

---

## Commit Summary (ordered)

1. `feat(core): add "detached" AgentState for orphaned-process agents`
2. `feat(core): mark "detached" as terminal in isTerminalState`
3. `feat(core): add Orchestrator.hydrate() and PersistedAgentRecord; detached discard/merge`
4. `feat(extension): persistence codec, replay, injectable backend, EventLogger`
5. `feat(extension): FsPersistenceBackend for production fs writes`
6. `feat(extension): wire EventLogger in activate(); load/hydrate on start, forget on resolve`
7. `test(extension): persistence-activate integration tests`
8. `chore(core): verify terminal set contains conflict and detached after M7 deltas`

Each commit message ends with:
```
Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
```

---

## Cross-Milestone Delta Map

When the parallel M5/M6/M8/M9 plans are integrated, the following files need reconciliation. M7's deltas are additive and do not conflict:

| File | M7 adds | Other milestones add | Conflict? |
| --- | --- | --- | --- |
| `core/src/types.ts` | `"detached"` to `AgentState`; `PersistedAgentRecord` interface | M8: `Team` type | No: distinct additions |
| `core/src/events.ts` | `"detached"` to `TERMINAL` set | None in M5/M6/M8/M9 | No |
| `core/src/orchestrator.ts` | `hydrate(records)` method; widen `canDiscard`; widen `merge` guard | M6: `sendBack`; M9: merge mutex, merge harden | No: distinct methods; M9 merge harden must include `"detached"` in its merge guard too (flag for M9 author) |
| `extension/src/extension.ts` | persistence imports, EventLogger wiring, async hydrate block, unsubPersist/unsubForget disposables | M5: ACP adapter registration; M6: approve/steer/sendBack wiring; M8: role loading + role picker | No: all are additive insertions in `activate()` |
| `extension/src/persistence.ts` | NEW file | No other milestone touches it | No |
| `extension/src/persistence-fs.ts` | NEW file | No other milestone touches it | No |

Flag for M9 author: `Orchestrator.merge()` currently guards on `state === "done"`. M7 widens it to `state === "done" || state === "detached"`. M9 may further harden the merge path (mutex, cleanup robustness). M9's harden must preserve the `"detached"` case in the guard.
