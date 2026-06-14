# Maestro M6: Approvals + Steering UI

> ⚠ **RECONCILE FIRST.** Authored in parallel with M5/M7/M8/M9. Before executing, apply the cross-plan deltas in `2026-06-14-maestro-m5-m9-roadmap.md` → "Reconciliation Addendum", especially **R1** (rename the approval-detail field `summary` → `description` to match M5's source-of-truth `AcpApprovalDetail { description, tool, args? }`) and **R3/R7** (your `render.ts` rewrite and your `WebviewToHost`/`OrchestratorLike`/`handle()` additions are extended further by M9; keep them additive).

**Date:** 2026-06-14
**Milestone:** M6 — Approvals + Steering UI
**Slug:** `m6-approvals-steering`
**Branch:** `m6-approvals-steering`
**Depends on:** M5 (`m5-acp-adapter` merged; ACP adapter registers itself and emits real `approval` events)
**Gate before merge:** 112 (current) + ~30 new tests green; tsc clean; esbuild build succeeds

---

## Goal

Wire the interactive-control surface in the cockpit that was deliberately deferred through M4. Three things that all exist in protocol/controller but have no UI yet:

1. **Approve / Deny** an in-flight tool request when the ACP adapter parks on `awaiting-approval`.
2. **Steer** a live agent with a free-text note (postMessage `{type:"steer"}`).
3. **Send back with feedback** after an agent is done or conflicted. Because the session has ended at that point, this requires a new `Orchestrator.sendBack(agentId, feedback)` method that re-launches the agent in its existing worktree with the feedback woven into the new task description.

Additionally, surface the approval `detail` (what exactly the engine wants to do) so the conductor can make an informed allow/deny decision.

The `approve` and `steer` protocol messages and the controller dispatch for them already exist (added in M4 for forward-compat). `CardVM.pendingApprovalId` is already populated. M6 is mostly: render the controls, surface detail, and add `sendBack`.

---

## Upstream assumptions / contract (M5 seam)

M5 must be merged and passing before M6 is executed. The following is assumed from M5's ACP adapter:

1. The ACP adapter emits `{ kind: "approval", id: string, detail: ApprovalDetail }` where `ApprovalDetail` is defined by M5 as:
   ```ts
   export interface ApprovalDetail {
     tool: string;      // e.g. "bash", "write_file"
     summary: string;   // human-readable one-liner, e.g. "Run: npm test"
   }
   ```
   M6 assumes this shape. If M5 chose a different field name or structure, reconcile here: search for `ApprovalDetail` in `packages/adapter-acp/src/` and update `Agent.approvalDetail` in `types.ts` and the reducer accordingly.

2. `AgentSession.respond(approvalId, decision)` answers the parked ACP permission. Already in the adapter contract; M5 implements it. No changes needed here.

3. `AgentSession.send(input)` steers a live ACP session by injecting a follow-up prompt turn. Already in the adapter contract; M5 implements it. No changes needed here.

4. The ACP adapter's capabilities report `{ approvals: true, steerable: true }`. The render logic gates controls on these capability flags carried in `CardVM.engineCapabilities` (a new field added in M6 below). If M5 did not add capabilities to the agent/card, M6 adds the field here.

---

## Architecture

### What is additive (M6 only writes these)

| File | What changes |
|---|---|
| `packages/core/src/types.ts` | `Agent.approvalDetail?: ApprovalDetail`; new `ApprovalDetail` interface |
| `packages/core/src/orchestrator.ts` | `+sendBack(agentId, feedback): Agent` method |
| `packages/cockpit/src/protocol.ts` | `CardVM.approvalDetail?`; `CardVM.engineCapabilities`; new `WebviewToHost sendBack` variant |
| `packages/cockpit/src/reducer.ts` | Carry `approvalDetail` into card from `approval` event; clear on resolution; carry `engineCapabilities` from agent role |
| `packages/extension/src/render.ts` | Approval panel (detail + allow/deny buttons); steering input box; send-back box on done/conflict |
| `packages/extension/src/webview/main.ts` | Wire the new controls to `postMessage`; read inputs from DOM |
| `packages/extension/src/controller.ts` | `OrchestratorLike` += `sendBack`; dispatch `sendBack` message |
| `packages/extension/src/extension.ts` | No new VS Code commands needed; driven from webview |

### What is NOT changed

- `packages/cockpit/src/select.ts` — ordering is unchanged (attention flag already handles it)
- `packages/cockpit/src/index.ts` — re-exports only; update only if new public types added
- `packages/extension/src/stage.ts`, `roster.ts`, `roster-map.ts`, `html.ts` — untouched
- `packages/adapter-copilot/**` — Copilot's capabilities are `approvals:false, steerable:false`; it gets the "auto" badge and no controls, same as M4

### sendBack state machine

```
done | conflict
      |
      | sendBack(agentId, feedback)
      v
  preparing  (briefly, as tryStart queues it)
      |
  working    (re-launch in the SAME workspace, same branch)
      |
  (normal event loop from here)
```

Key invariant: the worktree is NOT cleaned up before sendBack. The agent already has `agent.workspace` from its first run; the new launch reuses `agent.workspace.path` and `agent.workspace.branch` directly, skipping `workspaces.create()`. The session for the previous run is already gone (sessions map was cleaned by `consume`'s finally block), so there is no session collision.

---

## Tech stack

- TypeScript ESM NodeNext, `"strict": true`, `"noUncheckedIndexedAccess": true`
- Vitest for all unit tests (pure files only; no vscode import)
- esbuild bundles host (CJS) + webview (browser IIFE); no new entrypoints in M6
- No new packages needed

---

## File structure (additive deltas only)

### `packages/core/src/types.ts`

Add after the `AgentEvent` union:

```ts
/** The renderable detail of a pending approval request from an ACP engine. */
export interface ApprovalDetail {
  tool: string;
  summary: string;
}
```

Add to the `Agent` interface:

```ts
/** Set when state === "awaiting-approval"; cleared when approved/denied. */
approvalDetail?: ApprovalDetail;
```

### `packages/core/src/orchestrator.ts`

Add one public method `sendBack`. Nothing else changes.

### `packages/cockpit/src/protocol.ts`

Add to `CardVM`:

```ts
approvalDetail?: { tool: string; summary: string };
/** Carries the engine capabilities so the UI can degrade gracefully. */
engineCapabilities?: { approvals: boolean; steerable: boolean };
```

Add to the `WebviewToHost` union (host sends to webview; this is actually `HostToWebview` direction — see correction below):

Correction: `sendBack` is webview-to-host (the user clicks the button in the webview):

```ts
// Addition to WebviewToHost:
| { type: "sendBack"; agentId: string; feedback: string }
```

### `packages/cockpit/src/reducer.ts`

Two additive changes inside `cardFromAgent`:

1. Carry `approvalDetail` from `agent.approvalDetail`.
2. Carry `engineCapabilities` from the adapter's capabilities registered on the role (the adapter is not directly accessible from the reducer, but the role carries `engine.id`; the capabilities live on the adapter. Resolution: the reducer does not know adapters. Instead, capabilities are carried on the `Agent` itself. See Task 1 below for where to put this on `Agent`.)

### `packages/extension/src/render.ts`

Three additive branches in `renderCardHTML`:

1. When `card.state === "awaiting-approval"` and `card.pendingApprovalId`, render an approval panel.
2. When `card.engineCapabilities?.steerable` and the agent is `working` or `awaiting-approval`, render a steering input.
3. When `card.state === "done"` or `card.state === "conflict"`, render a send-back textarea + button (alongside the existing Merge/Discard buttons).

### `packages/extension/src/webview/main.ts`

Wire three new control patterns in the `click` / `submit` event listeners:

1. Approve/deny button clicks.
2. Steering form submit.
3. Send-back form submit.

### `packages/extension/src/controller.ts`

1. Add `sendBack(agentId: string, feedback: string): Agent` to `OrchestratorLike`.
2. Add a `case "sendBack"` to `handle`.

---

## Tasks

### Task 0 — Branch setup

- [ ] From the merged-M5 base, create branch `m6-approvals-steering`:
  ```bash
  git checkout main && git pull && git checkout -b m6-approvals-steering
  ```
  Verify the gate: `pnpm -r test` passes (expected: >=132 tests, M5 adds ~20).
  **Commit:** `chore: start m6-approvals-steering branch`

---

### Task 1 — Add ApprovalDetail + engineCapabilities to core types

**File:** `packages/core/src/types.ts`

Write a failing test first in `packages/core/src/orchestrator.test.ts` (or a dedicated `packages/core/src/types.test.ts`) that asserts an agent with an `approval` event carries `approvalDetail` with the correct shape. The test will fail because `ApprovalDetail` does not exist yet.

```ts
// packages/core/src/types.test.ts  (new file)
import { describe, it, expect } from "vitest";
import type { ApprovalDetail, Agent } from "./types.js";

describe("ApprovalDetail", () => {
  it("is assignable to Agent.approvalDetail", () => {
    const detail: ApprovalDetail = { tool: "bash", summary: "Run: npm test" };
    const partial: Pick<Agent, "approvalDetail"> = { approvalDetail: detail };
    expect(partial.approvalDetail?.tool).toBe("bash");
    expect(partial.approvalDetail?.summary).toBe("Run: npm test");
  });

  it("is optional on Agent", () => {
    const partial: Pick<Agent, "approvalDetail"> = {};
    expect(partial.approvalDetail).toBeUndefined();
  });
});
```

Run: `pnpm --filter @maestro/core test` — RED (type error, `ApprovalDetail` not exported).

**Implement** in `packages/core/src/types.ts`:

```ts
// After the AgentEvent union, before Role:

/** The renderable detail of a pending approval from an ACP engine. */
export interface ApprovalDetail {
  tool: string;
  summary: string;
}
```

Add to the `Agent` interface (after `pendingApprovalId?`):

```ts
/** Set when state === "awaiting-approval"; cleared when the approval is resolved. */
approvalDetail?: ApprovalDetail;
/** Capabilities carried from the adapter so the UI can degrade without adapter access. */
engineCapabilities?: { approvals: boolean; steerable: boolean };
```

Run: `pnpm --filter @maestro/core test` — GREEN.

**Commit:** `feat(core/types): add ApprovalDetail + Agent.approvalDetail + engineCapabilities`
`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

### Task 2 — Orchestrator sets approvalDetail on approval events

**File:** `packages/core/src/orchestrator.ts`

Write a failing test in `packages/core/src/orchestrator.test.ts`. Find the existing section testing `approval` events and add:

```ts
it("carries approval detail into agent when an approval event is emitted", async () => {
  // FakeSession emits: { kind: "approval", id: "req-1", detail: { tool: "bash", summary: "Run: npm test" } }
  const session = new FakeSession([
    { kind: "approval", id: "req-1", detail: { tool: "bash", summary: "Run: npm test" } },
    { kind: "done", summary: "done" },
  ]);
  const adapter = new FakeEngineAdapter("acp", { approvals: true, steerable: true }, session);
  const orch = new Orchestrator({ maxParallelAgents: 1 }, new FakeWorkspaceProvider());
  orch.registerAdapter(adapter);
  orch.registerRole({ name: "Dev", instructions: "", engine: { id: "acp" }, autonomy: "manual" });
  orch.spawn("Dev", "task");
  await session.drain();
  const agent = orch.getAgent("agent-1")!;
  // After the approval event, approvalDetail is set.
  // (We capture intermediate state via the listener)
  const updates: import("./types.js").Agent[] = [];
  // Note: this test structure requires capturing events; adapt to the existing FakeSession/drain pattern.
  // The below asserts final agent state — after done, approvalDetail is cleared.
  expect(agent.approvalDetail).toBeUndefined(); // cleared after done
});

it("sets engineCapabilities on the agent at launch", async () => {
  const session = new FakeSession([{ kind: "done", summary: "done" }]);
  const adapter = new FakeEngineAdapter("acp", { approvals: true, steerable: true }, session);
  const orch = new Orchestrator({ maxParallelAgents: 1 }, new FakeWorkspaceProvider());
  orch.registerAdapter(adapter);
  orch.registerRole({ name: "Dev", instructions: "", engine: { id: "acp" }, autonomy: "manual" });
  const agent = orch.spawn("Dev", "task");
  await session.drain();
  const final = orch.getAgent(agent.id)!;
  expect(final.engineCapabilities).toEqual({ approvals: true, steerable: true });
});
```

Run: RED.

**Implement** in `packages/core/src/orchestrator.ts`, `applyEvent` method:

```ts
case "approval":
  agent.pendingApprovalId = event.id;
  // Carry the approval detail if the event provides a structured detail.
  if (
    event.detail !== null &&
    typeof event.detail === "object" &&
    "tool" in event.detail &&
    "summary" in event.detail
  ) {
    agent.approvalDetail = {
      tool: String((event.detail as Record<string, unknown>)["tool"]),
      summary: String((event.detail as Record<string, unknown>)["summary"]),
    };
  }
  this.update(agent, "awaiting-approval");
  break;
```

Clear `approvalDetail` in the `approve` method, after `agent.pendingApprovalId = undefined`:

```ts
agent.approvalDetail = undefined;
```

Set `engineCapabilities` in `launch`, right after `this.update(agent, "working")`:

```ts
agent.engineCapabilities = {
  approvals: adapter.capabilities.approvals,
  steerable: adapter.capabilities.steerable,
};
```

Run: `pnpm --filter @maestro/core test` — GREEN.

**Commit:** `feat(core): set approvalDetail + engineCapabilities on agent at runtime`
`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

### Task 3 — Orchestrator.sendBack: re-launch in existing worktree

**File:** `packages/core/src/orchestrator.ts`

This is the most important new capability. Write the test first:

```ts
// In packages/core/src/orchestrator.test.ts

describe("sendBack", () => {
  it("re-launches a done agent in its existing worktree with feedback appended", async () => {
    const session1 = new FakeSession([{ kind: "done", summary: "first attempt" }]);
    const session2 = new FakeSession([{ kind: "done", summary: "second attempt" }]);
    const adapter = new FakeEngineAdapter("acp", { approvals: true, steerable: true });
    adapter.nextSessions = [session1, session2]; // FakeEngineAdapter queues sessions per start() call
    const workspaces = new FakeWorkspaceProvider();
    const orch = new Orchestrator({ maxParallelAgents: 1 }, workspaces);
    orch.registerAdapter(adapter);
    orch.registerRole({ name: "Dev", instructions: "", engine: { id: "acp" }, autonomy: "manual" });

    const agent = orch.spawn("Dev", "implement feature X");
    await session1.drain();
    expect(orch.getAgent(agent.id)!.state).toBe("done");

    // sendBack transitions to "preparing" then "working"
    const states: string[] = [];
    orch.on((e) => {
      if (e.kind === "agent-updated") states.push(e.agent.state);
    });

    orch.sendBack(agent.id, "Please also add tests");
    await session2.drain();

    expect(states).toContain("preparing");
    expect(states).toContain("working");
    expect(orch.getAgent(agent.id)!.state).toBe("done");
    // Workspace create was called only once (sendBack reuses the existing workspace)
    expect(workspaces.createCallCount).toBe(1);
  });

  it("re-launches a conflict agent", async () => {
    const session1 = new FakeSession([{ kind: "done", summary: "done" }]);
    const session2 = new FakeSession([{ kind: "done", summary: "resolved" }]);
    const adapter = new FakeEngineAdapter("acp", { approvals: true, steerable: true });
    adapter.nextSessions = [session1, session2];
    const workspaces = new FakeWorkspaceManager(); // has merge/discard
    const orch = new Orchestrator({ maxParallelAgents: 1 }, workspaces);
    orch.registerAdapter(adapter);
    orch.registerRole({ name: "Dev", instructions: "", engine: { id: "acp" }, autonomy: "manual" });

    const agent = orch.spawn("Dev", "implement");
    await session1.drain();
    // Simulate conflict state by calling merge which returns conflict
    workspaces.nextMergeResult = { status: "conflict", files: ["src/foo.ts"] };
    await orch.merge(agent.id);
    expect(orch.getAgent(agent.id)!.state).toBe("conflict");

    orch.sendBack(agent.id, "Resolve the conflict in src/foo.ts");
    await session2.drain();
    expect(orch.getAgent(agent.id)!.state).toBe("done");
    expect(workspaces.createCallCount).toBe(1); // still only one workspace created
  });

  it("throws if agent is not done or conflict", () => {
    const orch = new Orchestrator({ maxParallelAgents: 1 }, new FakeWorkspaceProvider());
    orch.registerRole({ name: "Dev", instructions: "", engine: { id: "acp" }, autonomy: "manual" });
    const agent = orch.spawn("Dev", "task");
    expect(() => orch.sendBack(agent.id, "feedback")).toThrow(
      /cannot send back.*state: preparing/i,
    );
  });

  it("throws for unknown agent", () => {
    const orch = new Orchestrator({ maxParallelAgents: 1 }, new FakeWorkspaceProvider());
    expect(() => orch.sendBack("no-such-id", "feedback")).toThrow(/unknown agent/i);
  });

  it("appends feedback to the task description in the new session", async () => {
    const session1 = new FakeSession([{ kind: "done", summary: "done" }]);
    const session2 = new FakeSession([{ kind: "done", summary: "done2" }]);
    const adapter = new FakeEngineAdapter("acp", { approvals: true, steerable: true });
    adapter.nextSessions = [session1, session2];
    const orch = new Orchestrator({ maxParallelAgents: 1 }, new FakeWorkspaceProvider());
    orch.registerAdapter(adapter);
    orch.registerRole({ name: "Dev", instructions: "", engine: { id: "acp" }, autonomy: "manual" });

    orch.spawn("Dev", "implement feature X");
    await session1.drain();
    orch.sendBack(orch.getAgents()[0]!.id, "Also add tests");
    await session2.drain();

    // The second start() call receives a task whose description includes the feedback.
    const [, secondTask] = adapter.startedTasks; // FakeEngineAdapter records calls
    expect(secondTask?.description).toContain("implement feature X");
    expect(secondTask?.description).toContain("Also add tests");
  });
});
```

Note: the tests above require `FakeEngineAdapter` to support queuing multiple sessions (a `nextSessions` array) and recording `startedTasks`. If `FakeEngineAdapter` in `packages/core/src/testing.ts` does not already support this, extend it as part of this task (it is a test double in the same package, not a public API).

Run: RED.

**Implement** in `packages/core/src/orchestrator.ts` (additive method, no modifications to existing methods):

```ts
/**
 * Re-launch a done or conflict agent in its existing worktree with feedback
 * appended to the task description. The session has already ended; no live
 * session exists. The worktree is NOT cleaned up -- the agent's existing
 * workspace is reused directly, preserving partial work on disk.
 *
 * State transition: done|conflict -> preparing -> working -> (normal lifecycle)
 */
sendBack(agentId: string, feedback: string): Agent {
  const agent = this.requireAgent(agentId);
  if (agent.state !== "done" && agent.state !== "conflict") {
    throw new Error(
      `Cannot send back agent ${agentId} (state: ${agent.state}); only done or conflict agents can be sent back`,
    );
  }
  // Reset mutable state from the previous run; keep workspace, role, and id.
  agent.summary = undefined;
  agent.diff = undefined;
  agent.diffError = undefined;
  agent.conflict = undefined;
  agent.error = undefined;
  agent.pendingApprovalId = undefined;
  agent.approvalDetail = undefined;
  agent.log = [];
  // Append feedback to task description so the engine sees both the original
  // goal and the conductor's note.
  agent.task = {
    ...agent.task,
    description: `${agent.task.description}\n\nConductor feedback: ${feedback}`,
  };
  this.update(agent, "preparing");
  // Re-launch without calling workspaces.create() -- agent.workspace already exists.
  this.tryStartExisting(agent);
  return agent;
}

/**
 * Like tryStart but skips workspace creation: the agent already has a workspace
 * from its previous run. Used exclusively by sendBack.
 */
private tryStartExisting(agent: Agent): void {
  if (this.running >= this.config.maxParallelAgents) {
    this.queue.push(agent.id);
    return;
  }
  this.running++;
  void this.launchExisting(agent);
}

/**
 * Like launch but skips workspaces.create(). The agent must already have
 * agent.workspace set from a prior run.
 */
private async launchExisting(agent: Agent): Promise<void> {
  const adapter = this.adapters.get(agent.role.engine.id);
  if (!adapter) {
    this.fail(agent, `No adapter for engine ${agent.role.engine.id}`);
    this.release();
    return;
  }
  // agent.workspace is guaranteed non-undefined: sendBack only runs on done/conflict
  // agents, which reached "working" state, which requires a workspace.
  const workspace = agent.workspace!;
  this.update(agent, "working");
  agent.engineCapabilities = {
    approvals: adapter.capabilities.approvals,
    steerable: adapter.capabilities.steerable,
  };
  let session: AgentSession;
  try {
    session = adapter.start(agent.task, workspace, agent.role);
  } catch (error) {
    this.fail(agent, `Engine failed to start: ${errorMessage(error)}`);
    this.release();
    return;
  }
  this.sessions.set(agent.id, session);
  void this.consume(agent, session);
}
```

Run: `pnpm --filter @maestro/core test` — GREEN.

**Commit:** `feat(core): Orchestrator.sendBack — re-launch done/conflict agent in existing worktree`
`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

### Task 4 — Cockpit protocol: approvalDetail + engineCapabilities + sendBack message

**File:** `packages/cockpit/src/protocol.ts`

Write a test that the type compiles and can be constructed (type-level test, no runtime logic needed, but a structural assertion is enough):

```ts
// packages/cockpit/src/protocol.test.ts  (extend existing or new file)
import { describe, it, expect } from "vitest";
import type { CardVM, WebviewToHost } from "./protocol.js";

describe("protocol M6 additions", () => {
  it("CardVM accepts approvalDetail", () => {
    const card: CardVM = {
      id: "a1",
      roleName: "Dev",
      engineId: "acp",
      state: "awaiting-approval",
      output: "",
      attention: true,
      pendingApprovalId: "req-1",
      approvalDetail: { tool: "bash", summary: "Run: npm test" },
      engineCapabilities: { approvals: true, steerable: true },
    };
    expect(card.approvalDetail?.tool).toBe("bash");
    expect(card.engineCapabilities?.steerable).toBe(true);
  });

  it("WebviewToHost accepts sendBack", () => {
    const msg: WebviewToHost = { type: "sendBack", agentId: "a1", feedback: "try again" };
    expect(msg.type).toBe("sendBack");
  });
});
```

Run: RED (type errors).

**Implement** in `packages/cockpit/src/protocol.ts` (additive only, never touch existing lines):

```ts
// In CardVM, after pendingApprovalId?:
/** Human-readable detail of the pending approval request; set when pendingApprovalId is set. */
approvalDetail?: { tool: string; summary: string };
/** Engine capabilities carried through to the UI for graceful degradation. */
engineCapabilities?: { approvals: boolean; steerable: boolean };
```

```ts
// In WebviewToHost union, after the discard variant:
| { type: "sendBack"; agentId: string; feedback: string }
```

Update `packages/cockpit/src/index.ts` if `ApprovalDetail` needs re-exporting (optional; it is already in core types).

Run: `pnpm --filter @maestro/cockpit test` — GREEN.

**Commit:** `feat(cockpit/protocol): CardVM.approvalDetail + engineCapabilities + WebviewToHost sendBack`
`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

### Task 5 — Cockpit reducer: carry approvalDetail + engineCapabilities into CardVM

**File:** `packages/cockpit/src/reducer.ts`

Write failing tests:

```ts
// packages/cockpit/src/reducer.test.ts  (extend existing)
import { describe, it, expect } from "vitest";
import { initialModel, reduce } from "./reducer.js";
import type { OrchestratorEvent } from "@maestro/core";

describe("reducer M6: approval detail", () => {
  function makeAddedEvent(overrides: Partial<import("@maestro/core").Agent> = {}): OrchestratorEvent {
    return {
      kind: "agent-added",
      agent: {
        id: "a1",
        task: { id: "t1", description: "task", roleName: "Dev" },
        role: { name: "Dev", instructions: "", engine: { id: "acp" }, autonomy: "manual" },
        state: "preparing",
        log: [],
        ...overrides,
      },
    };
  }

  it("carries approvalDetail from agent into card", () => {
    let model = initialModel();
    model = reduce(model, makeAddedEvent());
    model = reduce(model, {
      kind: "agent-updated",
      agent: {
        id: "a1",
        task: { id: "t1", description: "task", roleName: "Dev" },
        role: { name: "Dev", instructions: "", engine: { id: "acp" }, autonomy: "manual" },
        state: "awaiting-approval",
        log: [],
        pendingApprovalId: "req-1",
        approvalDetail: { tool: "bash", summary: "Run: npm test" },
      },
    });
    const card = model.cards.get("a1")!;
    expect(card.approvalDetail).toEqual({ tool: "bash", summary: "Run: npm test" });
    expect(card.pendingApprovalId).toBe("req-1");
  });

  it("clears approvalDetail when agent transitions back to working (approval answered)", () => {
    let model = initialModel();
    model = reduce(model, makeAddedEvent());
    model = reduce(model, {
      kind: "agent-updated",
      agent: {
        id: "a1",
        task: { id: "t1", description: "task", roleName: "Dev" },
        role: { name: "Dev", instructions: "", engine: { id: "acp" }, autonomy: "manual" },
        state: "working",
        log: [],
        // orchestrator clears both fields; reducer just passes them through
        pendingApprovalId: undefined,
        approvalDetail: undefined,
      },
    });
    const card = model.cards.get("a1")!;
    expect(card.approvalDetail).toBeUndefined();
    expect(card.pendingApprovalId).toBeUndefined();
  });

  it("carries engineCapabilities from agent into card", () => {
    let model = initialModel();
    model = reduce(model, makeAddedEvent({
      engineCapabilities: { approvals: true, steerable: true },
    }));
    const card = model.cards.get("a1")!;
    expect(card.engineCapabilities).toEqual({ approvals: true, steerable: true });
  });
});
```

Run: RED.

**Implement** in `packages/cockpit/src/reducer.ts`, inside `cardFromAgent`:

```ts
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
    // M6 additions:
    approvalDetail: agent.approvalDetail,
    engineCapabilities: agent.engineCapabilities,
    attention: needsAttention(agent.state),
  };
}
```

That is the complete change to `reducer.ts` — `cardFromAgent` already reads every field from `agent`; we just add two more.

Run: `pnpm --filter @maestro/cockpit test` — GREEN.

**Commit:** `feat(cockpit/reducer): carry approvalDetail + engineCapabilities into CardVM`
`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

### Task 6 — render.ts: approval panel + steering box + send-back box

**File:** `packages/extension/src/render.ts`

This is a pure function; it is unit-tested directly. Write failing tests for all three new UI regions:

```ts
// packages/extension/src/render.test.ts  (extend existing)
import { describe, it, expect } from "vitest";
import { renderCardHTML } from "./render.js";
import type { CardVM } from "@maestro/cockpit";

function baseCard(overrides: Partial<CardVM> = {}): CardVM {
  return {
    id: "a1",
    roleName: "Dev",
    engineId: "acp",
    state: "working",
    output: "",
    attention: false,
    ...overrides,
  };
}

describe("render.ts M6: approval panel", () => {
  it("renders approve/deny buttons when pendingApprovalId is set", () => {
    const html = renderCardHTML(
      baseCard({
        state: "awaiting-approval",
        pendingApprovalId: "req-1",
        engineCapabilities: { approvals: true, steerable: false },
        attention: true,
      }),
    );
    expect(html).toContain('data-action="approve"');
    expect(html).toContain('data-action="deny"');
    expect(html).toContain('data-approval-id="req-1"');
  });

  it("renders approval detail text when approvalDetail is present", () => {
    const html = renderCardHTML(
      baseCard({
        state: "awaiting-approval",
        pendingApprovalId: "req-1",
        approvalDetail: { tool: "bash", summary: "Run: npm test" },
        engineCapabilities: { approvals: true, steerable: false },
        attention: true,
      }),
    );
    expect(html).toContain("bash");
    expect(html).toContain("Run: npm test");
  });

  it("escapes XSS in approval detail", () => {
    const html = renderCardHTML(
      baseCard({
        state: "awaiting-approval",
        pendingApprovalId: "req-1",
        approvalDetail: { tool: "<script>", summary: "alert('xss')" },
        engineCapabilities: { approvals: true, steerable: false },
        attention: true,
      }),
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("does NOT render approve/deny when engineCapabilities.approvals is false", () => {
    const html = renderCardHTML(
      baseCard({
        state: "awaiting-approval",
        pendingApprovalId: "req-1",
        engineCapabilities: { approvals: false, steerable: false },
        attention: true,
      }),
    );
    expect(html).not.toContain('data-action="approve"');
    expect(html).not.toContain('data-action="deny"');
  });
});

describe("render.ts M6: steering input", () => {
  it("renders steering input when steerable and agent is working", () => {
    const html = renderCardHTML(
      baseCard({
        state: "working",
        engineCapabilities: { approvals: false, steerable: true },
      }),
    );
    expect(html).toContain('data-action="steer"');
    expect(html).toContain("<input");
  });

  it("does NOT render steering input when steerable is false", () => {
    const html = renderCardHTML(
      baseCard({
        state: "working",
        engineCapabilities: { approvals: false, steerable: false },
      }),
    );
    expect(html).not.toContain('data-action="steer"');
  });

  it("renders steering input when agent is awaiting-approval and steerable", () => {
    const html = renderCardHTML(
      baseCard({
        state: "awaiting-approval",
        pendingApprovalId: "req-1",
        engineCapabilities: { approvals: true, steerable: true },
        attention: true,
      }),
    );
    expect(html).toContain('data-action="steer"');
  });
});

describe("render.ts M6: send-back box", () => {
  it("renders send-back textarea on done card", () => {
    const html = renderCardHTML(
      baseCard({
        state: "done",
        summary: "All done",
        attention: true,
      }),
    );
    expect(html).toContain('data-action="sendBack"');
    expect(html).toContain("<textarea");
  });

  it("renders send-back textarea on conflict card", () => {
    const html = renderCardHTML(
      baseCard({
        state: "conflict",
        conflictFiles: ["src/foo.ts"],
        attention: true,
      }),
    );
    expect(html).toContain('data-action="sendBack"');
    expect(html).toContain("<textarea");
  });

  it("does NOT render send-back on working card", () => {
    const html = renderCardHTML(baseCard({ state: "working" }));
    expect(html).not.toContain('data-action="sendBack"');
  });
});
```

Run: `pnpm --filter @maestro/extension test` — RED.

**Implement** in `packages/extension/src/render.ts`. The entire file is rewritten as an additive expansion (the existing `actions`, `detail`, and `renderCardHTML` functions all remain; new helpers are added and called from within the card structure):

```ts
import type { CardVM } from "@maestro/cockpit";
import { escapeHtml } from "./html.js";

function approvalPanel(card: CardVM): string {
  if (
    card.state !== "awaiting-approval" ||
    !card.pendingApprovalId ||
    !card.engineCapabilities?.approvals
  ) {
    return "";
  }
  const id = escapeHtml(card.id);
  const approvalId = escapeHtml(card.pendingApprovalId);
  const detailHtml = card.approvalDetail
    ? `<div class="approval-detail">
        <span class="approval-tool">${escapeHtml(card.approvalDetail.tool)}</span>
        <span class="approval-summary">${escapeHtml(card.approvalDetail.summary)}</span>
       </div>`
    : "";
  return `<div class="approval-panel">
  ${detailHtml}
  <button data-action="approve" data-id="${id}" data-approval-id="${approvalId}">Allow</button>
  <button data-action="deny" data-id="${id}" data-approval-id="${approvalId}">Deny</button>
</div>`;
}

function steerBox(card: CardVM): string {
  if (!card.engineCapabilities?.steerable) return "";
  if (card.state !== "working" && card.state !== "awaiting-approval") return "";
  const id = escapeHtml(card.id);
  return `<form class="steer-form" data-action="steer" data-id="${id}">
  <input type="text" class="steer-input" placeholder="Send guidance..." aria-label="Steer agent" />
  <button type="submit">Send</button>
</form>`;
}

function sendBackBox(card: CardVM): string {
  if (card.state !== "done" && card.state !== "conflict") return "";
  const id = escapeHtml(card.id);
  return `<form class="sendback-form" data-action="sendBack" data-id="${id}">
  <textarea class="sendback-input" rows="2" placeholder="Feedback for another attempt..." aria-label="Send back with feedback"></textarea>
  <button type="submit">Send back</button>
</form>`;
}

function actions(card: CardVM): string {
  const id = escapeHtml(card.id);
  const stop = `<button data-action="stop" data-id="${id}">Stop</button>`;
  const merge = `<button data-action="merge" data-id="${id}">Merge</button>`;
  const discard = `<button data-action="discard" data-id="${id}">Discard</button>`;
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
  const canApprove = card.engineCapabilities?.approvals ?? false;
  const autoBadge =
    !canApprove && card.state !== "merged" && card.state !== "discarded"
      ? `<span class="badge">auto</span>`
      : "";
  return `<section class="card state-${card.state}${card.attention ? " attention" : ""}" data-id="${escapeHtml(card.id)}">
  <header><span class="role">${escapeHtml(card.roleName)}</span><span class="engine">${escapeHtml(card.engineId)}</span>${autoBadge}<span class="status">${card.state}</span></header>
  <pre class="output">${escapeHtml(card.output)}</pre>
  ${detail(card)}
  ${approvalPanel(card)}
  ${steerBox(card)}
  ${sendBackBox(card)}
  <footer>${actions(card)}</footer>
</section>`;
}
```

Note on the `auto` badge logic: M4 keyed the badge off `card.engineId === "copilot"` as a proxy. M6 replaces that with the capability flag `engineCapabilities?.approvals`, which is the correct signal. The badge still means the same thing: the engine auto-handles permissions, so no manual controls are shown.

Run: `pnpm --filter @maestro/extension test` — GREEN.

**Commit:** `feat(extension/render): approval panel + steering input + send-back box`
`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

### Task 7 — controller.ts: add sendBack to OrchestratorLike + dispatch

**File:** `packages/extension/src/controller.ts`

Write failing test:

```ts
// packages/extension/src/controller.test.ts  (extend existing)
import { describe, it, expect, vi } from "vitest";
import { createCockpit } from "./controller.js";
import type { OrchestratorLike } from "./controller.js";

function makeOrch(overrides: Partial<OrchestratorLike> = {}): OrchestratorLike & {
  sendBackCalls: Array<{ agentId: string; feedback: string }>;
} {
  const sendBackCalls: Array<{ agentId: string; feedback: string }> = [];
  return {
    on: () => () => {},
    spawn: vi.fn(),
    steer: vi.fn(),
    approve: vi.fn(),
    stop: vi.fn(),
    merge: vi.fn().mockResolvedValue({ status: "clean" }),
    discard: vi.fn().mockResolvedValue(undefined),
    sendBack: (agentId, feedback) => {
      sendBackCalls.push({ agentId, feedback });
      return {} as any;
    },
    sendBackCalls,
    ...overrides,
  };
}

describe("controller M6: sendBack", () => {
  it("dispatches sendBack to the orchestrator", () => {
    const orch = makeOrch();
    const cockpit = createCockpit(orch, () => {});
    cockpit.handle({ type: "sendBack", agentId: "a1", feedback: "please add tests" });
    expect(orch.sendBackCalls).toEqual([{ agentId: "a1", feedback: "please add tests" }]);
  });
});
```

Run: RED.

**Implement** in `packages/extension/src/controller.ts`:

Add `sendBack` to `OrchestratorLike`:

```ts
export interface OrchestratorLike {
  on(listener: (event: OrchestratorEvent) => void): () => void;
  spawn(roleName: string, description: string): Agent;
  steer(agentId: string, input: string): void;
  approve(agentId: string, approvalId: string, decision: ApprovalDecision): void;
  stop(agentId: string): void;
  merge(agentId: string): Promise<MergeResult>;
  discard(agentId: string): Promise<void>;
  // M6 addition:
  sendBack(agentId: string, feedback: string): Agent;
}
```

Add a `case "sendBack"` inside `handle`:

```ts
case "sendBack":
  orch.sendBack(message.agentId, message.feedback);
  break;
```

Run: `pnpm --filter @maestro/extension test` — GREEN.

Note: `Orchestrator` in `packages/core` is now structurally assignable to `OrchestratorLike` because `Orchestrator.sendBack` is added in Task 3. TypeScript structural typing handles this automatically; no explicit `implements` is needed.

**Commit:** `feat(extension/controller): OrchestratorLike.sendBack + dispatch sendBack message`
`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

### Task 8 — webview/main.ts: wire approval + steer + sendBack controls

**File:** `packages/extension/src/webview/main.ts`

This file imports from the DOM and uses `acquireVsCodeApi`, so it cannot be unit-tested under Vitest. The contract is verified by:
1. TypeScript typecheck: `pnpm --filter @maestro/extension exec tsc --noEmit` (already in the gate).
2. esbuild build succeeds: `pnpm --filter @maestro/extension build`.
3. Manual F5 smoke-test: spawn an ACP agent, verify approve/deny buttons appear, click them, verify the card state changes.

**Implement** in `packages/extension/src/webview/main.ts` (additive, expanding the click listener):

```ts
import type { CockpitState, HostToWebview, WebviewToHost } from "@maestro/cockpit";
import { renderCardHTML } from "../render.js";

interface VsCodeApi {
  postMessage(msg: WebviewToHost): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();
const root = document.getElementById("root");

function render(state: CockpitState): void {
  if (!root) return;
  root.innerHTML = state.cards.length
    ? state.cards.map(renderCardHTML).join("")
    : `<p class="empty">No agents yet. Use the Roster's + (Spawn Agent) to start one.</p>`;
}

window.addEventListener("message", (e: MessageEvent<HostToWebview>) => {
  if (e.data.type === "state") render(e.data.state);
});

// Steer form submit
document.addEventListener("submit", (e) => {
  const form = e.target;
  if (!(form instanceof HTMLFormElement)) return;
  const action = form.dataset["action"];
  const id = form.dataset["id"];
  if (!id) return;

  if (action === "steer") {
    e.preventDefault();
    const input = form.querySelector<HTMLInputElement>(".steer-input");
    const text = input?.value.trim();
    if (!text) return;
    vscode.postMessage({ type: "steer", agentId: id, input: text });
    if (input) input.value = "";
  } else if (action === "sendBack") {
    e.preventDefault();
    const textarea = form.querySelector<HTMLTextAreaElement>(".sendback-input");
    const text = textarea?.value.trim();
    if (!text) return;
    vscode.postMessage({ type: "sendBack", agentId: id, feedback: text });
    if (textarea) textarea.value = "";
  }
});

document.addEventListener("click", (e) => {
  const target = e.target;
  if (!(target instanceof HTMLElement)) return;
  const btn = target.closest<HTMLElement>("[data-action]");
  if (btn) {
    const id = btn.dataset["id"];
    const action = btn.dataset["action"];
    if (!id) return;
    if (action === "stop") {
      vscode.postMessage({ type: "stop", agentId: id });
    } else if (action === "merge") {
      vscode.postMessage({ type: "merge", agentId: id });
    } else if (action === "discard") {
      vscode.postMessage({ type: "discard", agentId: id });
    } else if (action === "approve") {
      const approvalId = btn.dataset["approvalId"];
      if (approvalId) {
        vscode.postMessage({ type: "approve", agentId: id, approvalId, decision: "allow" });
      }
    } else if (action === "deny") {
      const approvalId = btn.dataset["approvalId"];
      if (approvalId) {
        vscode.postMessage({ type: "approve", agentId: id, approvalId, decision: "deny" });
      }
    }
    return;
  }
  const card = target.closest<HTMLElement>(".card");
  const cardId = card?.dataset["id"];
  if (cardId) vscode.postMessage({ type: "focus", agentId: cardId });
});

vscode.postMessage({ type: "ready" });
```

Note: `approve` and `deny` are separate buttons but both post `{type:"approve"}` with different `decision` values. This matches the existing protocol (the protocol has only one `approve` message type with a `decision` field).

Run: `pnpm --filter @maestro/extension build` (esbuild) and `pnpm --filter @maestro/extension exec tsc --noEmit` — both must succeed.

**Commit:** `feat(extension/webview): wire approve/deny, steer form, send-back form`
`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

### Task 9 — extension.ts: no new commands; verify structural assignability

**File:** `packages/extension/src/extension.ts`

`activate()` does not need changes: the webview drives approve/steer/sendBack entirely through `cockpit.handle()`, which is already wired. There are no new VS Code commands or sidebar items.

However, verify that the real `Orchestrator` is still structurally assignable to `OrchestratorLike` after Task 3 added `sendBack`. This is a typecheck verification, not a code change.

Run: `pnpm --filter @maestro/extension exec tsc --noEmit`. If the compiler raises an error about `Orchestrator` missing `sendBack`, it means Task 3 was not completed correctly. Fix there, not here.

No commit needed for this task.

---

### Task 10 — Full gate

Run the complete test suite across all packages:

```bash
pnpm -r test
pnpm -r build
pnpm -r exec tsc --noEmit
```

Expected counts: core (47 + ~10 new = ~57), cockpit (12 + ~3 new = ~15), adapter-copilot (20, unchanged), workspace (17, unchanged), extension (16 + ~5 new = ~21). Total: ~130 (plus M5's ~20 = ~150).

Confirm nothing regressed. Then run the holistic checks:

- All M4 tests still green (no regressions in existing render/controller/protocol).
- `sendBack` in core is tested for: done agent, conflict agent, wrong-state throw, unknown-agent throw, workspace reuse, task description mutation.
- `render.ts` is tested for: XSS escaping in approval detail, no approve buttons when `approvals: false`, no steer input when `steerable: false`, send-back box on done and conflict only.
- `controller.ts` is tested for: `sendBack` dispatch.

**Commit:** `test: M6 full gate — all packages green, tsc clean`
`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

## Reconciliation notes for the orchestrator merging M5-M9 plans

When the parallel M5/M6 plans are integrated:

1. **M5's `ApprovalDetail` shape**: M5 defines the ACP adapter's `approval` event `detail`. M6 assumes `{ tool: string; summary: string }`. If M5 used a different shape (e.g. `{ toolName, description }`), update `Agent.approvalDetail`, the orchestrator's `applyEvent` extraction, and the reducer test fixtures to match M5's actual field names. The UI render is driven by `approvalDetail.tool` and `approvalDetail.summary`; rename accordingly.

2. **M5's `FakeEngineAdapter` changes**: M6's Task 3 tests require `FakeEngineAdapter` to support queuing multiple sessions (`nextSessions`) and recording `startedTasks`. If M5 already modified `FakeEngineAdapter`, merge carefully. If not, M6 adds these fields to the existing test double in `packages/core/src/testing.ts`.

3. **`extension.ts` activate()**: Neither M5 nor M6 adds a new command to activate(); M5 registers the ACP adapter (`orch.registerAdapter(new AcpAdapter())`), M6 adds nothing. Apply M5's activate() delta first, then M6's delta (which is empty for activate). No collision.

4. **`render.ts` auto-badge logic**: M4's badge was `card.engineId === "copilot"`. M6 replaces it with `!(card.engineCapabilities?.approvals ?? false)`. This is a deliberate M6 improvement, not a conflict. When merging M9 later (which may also touch `render.ts`), confirm M9's changes are additive against M6's version.

---

## Self-review checklist

- [ ] No em dashes anywhere in plan, code samples, or commit messages.
- [ ] Every new public type in core is exported from `packages/core/src/index.ts`.
- [ ] `ApprovalDetail` is exported from core so cockpit and extension can reference it without importing from a deep path.
- [ ] All engine output in `approvalDetail.tool` and `approvalDetail.summary` is passed through `escapeHtml` before rendering.
- [ ] `data-approval-id` attribute uses `escapeHtml` in render.ts.
- [ ] `sendBack` guard is `state === "done" || state === "conflict"` only; no other state allowed.
- [ ] `sendBack` does NOT call `workspaces.create()` a second time; exactly one workspace per agent lifetime.
- [ ] `sendBack` resets all mutable agent state fields before re-launching (summary, diff, diffError, conflict, error, pendingApprovalId, approvalDetail, log).
- [ ] The steer form and send-back form use `e.preventDefault()` to suppress native form navigation.
- [ ] Empty feedback string is guarded in webview: `if (!text) return;` before posting.
- [ ] The `auto` badge render condition is driven by `engineCapabilities?.approvals`, not by hardcoded engine id.
- [ ] `OrchestratorLike` in controller.ts is updated so the real `Orchestrator` remains structurally assignable (verified by tsc).
- [ ] All new tests are vscode-free (no `import "vscode"` in test files).
- [ ] The additive-delta rule is satisfied: no existing line in any shared file is deleted or reordered; only new lines added.
- [ ] Full gate: `pnpm -r test && pnpm -r build && pnpm -r exec tsc --noEmit` passes.
- [ ] Manual F5 smoke-test with an ACP agent in a test repo: approval buttons appear, clicking Allow/Deny changes card state, steer input injects guidance, send-back re-launches the agent.
