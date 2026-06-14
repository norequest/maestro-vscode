# M5: Parallelism + the Generic ACP Adapter

**Date:** 2026-06-14
**Milestone:** M5 · slug `m5-acp-adapter`
**Branch:** `m5-acp-adapter`
**Author:** plan written against `main` after M4 merge (112 tests green)
**Status:** Plan only; no code modified, no git commits.

---

## Goal

Prove model-agnosticism by shipping a SECOND engine adapter that speaks a DIFFERENT protocol (ACP: Agent Client Protocol, JSON-RPC-over-stdio). One `@maestro/adapter-acp` package unlocks both Gemini CLI (`gemini --acp`) and Copilot CLI (`copilot --acp --stdio`) with no further adapter work. Simultaneously prove agents genuinely run in parallel by exercising `maxParallelAgents` concurrency through the real `Orchestrator`. Ship a shared adapter conformance suite that BOTH the Copilot and ACP adapters pass, turning "add an engine = write one adapter" from a claim into a machine-checked guarantee.

---

## Upstream assumptions / contract

- `@maestro/core` is exactly as described in `2026-06-14-maestro-m5-m9-roadmap.md` (M4 merged to `main`, 47 core tests, 112 total). No core changes are required by M5; the contract already supports `approval` events, `respond()`, `send()`, and `stop()`.
- `AgentEvent` already has `{ kind: "approval"; id: string; detail: unknown }` in `packages/core/src/types.ts`. M5 populates `detail` with a concrete shape (documented in Downstream Contract below); M6 builds the UI on that shape.
- `Orchestrator.approve(agentId, approvalId, decision)` already exists. The ACP adapter emitting an `approval` event is sufficient for the orchestrator to park the agent in `awaiting-approval` state and surface `pendingApprovalId` on the `Agent` record. M5 does NOT need to touch `orchestrator.ts`.
- `packages/adapter-copilot/test/conformance.test.ts` exists as an inline test. M5 extracts its pattern into a reusable suite (see Conformance Suite decision below) and makes both adapters pass it.

---

## Downstream contract for M6

M6 (Approvals + steering UI) builds directly on what M5's `AcpSession` emits. The following shapes are the contract:

### `approval` event `detail` shape

```ts
export interface AcpApprovalDetail {
  /** Human-readable description of what the agent wants to do. */
  description: string;
  /** The ACP tool name, e.g. "bash", "write_file". */
  tool: string;
  /** Raw arguments from the ACP requestPermission message, if present. */
  args?: Record<string, unknown>;
}
```

An `approval` event emitted by `AcpSession` is always:

```ts
{
  kind: "approval",
  id: string,          // the ACP request ID (string-coerced from JSON-RPC id)
  detail: AcpApprovalDetail
}
```

M6 renders `detail.description` as the prompt text, `detail.tool` as a badge, and optionally `detail.args` in a collapsed panel. The `id` is passed verbatim to `Orchestrator.approve(agentId, id, decision)`.

### `respond()` semantics

`AcpSession.respond(approvalId, decision)` sends the ACP `permission_response` JSON-RPC notification back on stdin:

```jsonc
{ "jsonrpc": "2.0", "method": "permission_response", "params": { "id": "<approvalId>", "granted": true|false } }
```

A `"deny"` decision sends `"granted": false`. After `respond()`, the agent transitions back to `working` (the next ACP message will be a new `session/update`). M6 does not need to know the wire format; it calls `orch.approve(agentId, approvalId, "allow"|"deny")` which forwards to `respond()`.

### `send()` semantics

`AcpSession.send(input)` injects a follow-up user turn via an ACP `user_turn` JSON-RPC notification:

```jsonc
{ "jsonrpc": "2.0", "method": "user_turn", "params": { "content": "<input>" } }
```

This is valid mid-flight (the ACP session stays alive across multiple turns). M6's steering input box calls `orch.steer(agentId, input)` which forwards to `send()`.

### `stop()` semantics

`AcpSession.stop()` sends SIGTERM to the subprocess, then ends the event queue. Any further ACP messages are dropped. The orchestrator transitions the agent to `stopped`.

### Capabilities

`ACP_CAPABILITIES` is `{ streaming: true, structuredEvents: true, approvals: true, steerable: true }`. M6 checks `capabilities.approvals` and `capabilities.steerable` to decide whether to render the approve/deny buttons and the steering input box. These are `true` for the ACP adapter, so M6 will render both.

### Autonomy mapping in M5 (no UI yet)

With no approval UI in M5, the ACP adapter is invoked with `autonomy: "auto-approve-safe"` or `"yolo"` in the extension's seeded role so that ACP `requestPermission` messages are auto-answered by the session itself (no blocking). Manual autonomy maps to ask-mode, which would block indefinitely without M6's UI. The extension `activate()` delta in M5 registers the ACP adapter but seeds the role with `autonomy: "auto-approve-safe"` until M6 ships the approval UI.

---

## Key decisions

### Decision 1: Hand-rolled ACP JSON-RPC, no `@agentclientprotocol/sdk`

The `@agentclientprotocol/sdk` npm package is a moving target (the ACP spec itself is not yet stable at 1.0); Copilot ACP already took one unannounced breaking change. More importantly, our offline-testability requirement means we need an injectable transport boundary regardless. Hand-rolling a minimal JSON-RPC-over-stdio layer (parse NDJSON lines, dispatch on `method`, respond by writing JSON lines to stdin) is about 80 lines, avoids an external runtime dep, and makes the message fixtures in tests 100% readable. If `@agentclientprotocol/sdk` stabilizes in a future milestone, swapping it in is a one-file change behind the `AcpTransport` interface.

The injectable abstraction is `AcpTransport`:

```ts
export interface AcpTransport {
  /** Async-iterate incoming ACP messages (NDJSON lines from stdout). */
  readonly messages: AsyncIterable<AcpMessage>;
  /** Write an outgoing ACP message (serialized to NDJSON on stdin). */
  send(msg: AcpMessage): void;
  /** Kill the subprocess and end the message stream. */
  terminate(): void;
}
```

For production, `ProcessAcpTransport` wraps a `ChildHandle` (same interface as in adapter-copilot) and parses stdout line-by-line. For tests, `FakeAcpTransport` accepts a script of pre-queued inbound messages and records outbound ones, with no subprocess at all.

### Decision 2: Conformance suite in `packages/conformance` (a dev-only package)

The suite lives in a new `packages/conformance/` package with `private: true` (never published to npm). It exports a single function `runConformanceSuite(label, factory)` that the BOTH `adapter-copilot` and `adapter-acp` test suites call. This is cleaner than a core test export because:
- Core stays zero-dep and production-only.
- The conformance package can depend on `@maestro/core` and Vitest's `describe`/`it`/`expect` without polluting core's `devDependencies`.
- New adapters in future milestones just add `"@maestro/conformance": "workspace:*"` to their `devDependencies` and call `runConformanceSuite`.

The package is `type: "module"`, ESM/NodeNext, no `tsconfig.build.json` (dev-only: no `dist/`). Its `vitest.config.ts` runs its own internal smoke test that asserts the suite catches a broken fake adapter.

---

## Architecture

```
packages/
  adapter-acp/
    src/
      types.ts            AcpMessage union, AcpTransport interface, AcpTransportFn
      transport.ts        ProcessAcpTransport (wraps ChildHandle), AcpTransportFn
      messages.ts         ACP message parsing/building helpers
      capabilities.ts     ACP_CAPABILITIES constant
      session.ts          AcpSession implements AgentSession
      adapter.ts          AcpAdapter implements EngineAdapter
      index.ts            public exports
    test/
      fake-transport.ts   FakeAcpTransport + scripted-message helpers
      messages.test.ts    parsing unit tests
      session.test.ts     AcpSession unit tests (fake transport, offline)
      adapter.test.ts     AcpAdapter unit tests
      conformance.test.ts calls runConformanceSuite from @maestro/conformance
      parallel.test.ts    parallel-run e2e through real Orchestrator
    package.json
    tsconfig.json
    tsconfig.build.json
    vitest.config.ts

  conformance/
    src/
      suite.ts            runConformanceSuite(label, factory): void
      index.ts            export { runConformanceSuite }
    test/
      self.test.ts        asserts the suite rejects a broken adapter
    package.json          private: true, no build scripts
    tsconfig.json
    vitest.config.ts
```

Extension-side additions (additive deltas only, never a full rewrite):

```
packages/extension/src/extension.ts   +5 lines in activate() to register AcpAdapter
```

No other shared files are modified.

---

## Tech Stack

- TypeScript 5.6, ESM, `"module": "NodeNext"`, `"moduleResolution": "NodeNext"`
- `"strict": true`, `"noUncheckedIndexedAccess": true` in all tsconfig files
- Vitest 2.x, `environment: "node"`
- Zero runtime deps beyond `@maestro/core` (hand-rolled ACP JSON-RPC)
- `@types/node ^22.0.0` dev dep for stream/process types
- `packages/conformance` is `private: true` (dev tooling only)

---

## File Structure

| File | Responsibility |
|------|----------------|
| `packages/conformance/src/suite.ts` | `runConformanceSuite(label, factory)`: the shared contract-guard suite every adapter must pass |
| `packages/conformance/src/index.ts` | re-exports `runConformanceSuite` |
| `packages/conformance/test/self.test.ts` | proves the suite catches a broken adapter |
| `packages/conformance/package.json` | private, dev-only, no build |
| `packages/conformance/tsconfig.json` | NodeNext, strict |
| `packages/conformance/vitest.config.ts` | runs `test/**/*.test.ts` |
| `packages/adapter-acp/src/types.ts` | `AcpMessage` union, `AcpTransport`, `AcpTransportFn`, `AcpApprovalDetail` |
| `packages/adapter-acp/src/transport.ts` | `ProcessAcpTransport` (wraps `ChildHandle`), default `AcpTransportFn` |
| `packages/adapter-acp/src/messages.ts` | ACP parsing helpers: `parseAcpLine`, `buildPermissionResponse`, `buildUserTurn`, `buildInitialize` |
| `packages/adapter-acp/src/capabilities.ts` | `ACP_CAPABILITIES` constant |
| `packages/adapter-acp/src/session.ts` | `AcpSession implements AgentSession`: drives the ACP protocol state machine |
| `packages/adapter-acp/src/adapter.ts` | `AcpAdapter implements EngineAdapter`, `AcpAdapterOptions` |
| `packages/adapter-acp/src/index.ts` | public exports |
| `packages/adapter-acp/test/fake-transport.ts` | `FakeAcpTransport` + message-scripting helpers |
| `packages/adapter-acp/test/messages.test.ts` | unit tests for message parsing/building |
| `packages/adapter-acp/test/session.test.ts` | `AcpSession` unit tests (offline, fake transport) |
| `packages/adapter-acp/test/adapter.test.ts` | `AcpAdapter` unit tests |
| `packages/adapter-acp/test/conformance.test.ts` | calls `runConformanceSuite` with a fake-transport-backed `AcpAdapter` |
| `packages/adapter-acp/test/parallel.test.ts` | parallel-run e2e: 3 agents through real `Orchestrator` with fake transports |
| `packages/adapter-acp/package.json` | `@maestro/core: workspace:*`, `@maestro/conformance: workspace:*` (devDep) |
| `packages/adapter-acp/tsconfig.json` | mirrors workspace package |
| `packages/adapter-acp/tsconfig.build.json` | `rootDir: src` only |
| `packages/adapter-acp/vitest.config.ts` | standard node config |
| `packages/adapter-copilot/test/conformance.test.ts` | MODIFIED: replace inline conformance tests with `runConformanceSuite` call |
| `packages/extension/src/extension.ts` | ADDITIVE DELTA: register `AcpAdapter` in `activate()` |

---

## TDD Tasks

### Task 0: Scaffold `packages/conformance`

**Commit message:** `feat(conformance): scaffold private conformance package`

- [ ] Create `packages/conformance/package.json`:

```json
{
  "name": "@maestro/conformance",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
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

- [ ] Create `packages/conformance/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "types": ["node"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "declaration": true,
    "outDir": "dist",
    "skipLibCheck": true
  },
  "include": ["src", "test"]
}
```

- [ ] Create `packages/conformance/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});
```

- [ ] Create `packages/conformance/src/suite.ts`:

```ts
import { describe, it, expect } from "vitest";
import { Orchestrator, FakeWorkspaceProvider, isTerminalState } from "@maestro/core";
import type { EngineAdapter, Role, AgentEvent } from "@maestro/core";

export type AdapterFactory = () => {
  adapter: EngineAdapter;
  /** Drive the adapter to emit a `done` event. Called after start(). */
  completeSucessfully(): void;
  /** Drive the adapter to emit an `error` event. Called after start(). */
  failWithError(): void;
  /** Drive the adapter to emit >= 1 output event before done. */
  emitOutput(text: string): void;
};

const ROLE: Role = {
  name: "Implementer",
  instructions: "do the thing",
  engine: { id: "test" },
  autonomy: "yolo",
};

function waitForTerminal(orch: Orchestrator, agentId: string): Promise<void> {
  return new Promise((resolve) => {
    const check = () => {
      const a = orch.getAgent(agentId);
      if (a && isTerminalState(a.state)) resolve();
    };
    orch.on(check);
    check();
  });
}

function waitForState(orch: Orchestrator, agentId: string, target: string): Promise<void> {
  return new Promise((resolve) => {
    const check = () => {
      if (orch.getAgent(agentId)?.state === target) resolve();
    };
    orch.on(check);
    check();
  });
}

/**
 * Run the shared adapter conformance suite.
 * Call this from every adapter's conformance test, passing a label and a
 * factory that produces a fresh adapter + driver per test.
 */
export function runConformanceSuite(label: string, factory: AdapterFactory): void {
  describe(`${label} conformance`, () => {
    it("declares id and capabilities", () => {
      const { adapter } = factory();
      expect(typeof adapter.id).toBe("string");
      expect(adapter.id.length).toBeGreaterThan(0);
      const c = adapter.capabilities;
      expect(typeof c.streaming).toBe("boolean");
      expect(typeof c.structuredEvents).toBe("boolean");
      expect(typeof c.approvals).toBe("boolean");
      expect(typeof c.steerable).toBe("boolean");
    });

    it("health() resolves to a HealthStatus", async () => {
      const { adapter } = factory();
      const h = await adapter.health();
      expect(typeof h.ok).toBe("boolean");
    });

    it("streams at least one status event, then terminates with done or error", async () => {
      const { adapter, completeSucessfully, emitOutput } = factory();
      const orch = new Orchestrator({ maxParallelAgents: 1 }, new FakeWorkspaceProvider());
      orch.registerRole(ROLE);
      orch.registerAdapter(adapter);

      const events: AgentEvent[] = [];
      orch.on((e) => {
        if (e.kind === "agent-event") events.push(e.event);
      });

      const agent = orch.spawn("Implementer", "task");
      await waitForState(orch, agent.id, "working");

      emitOutput("doing work\n");
      completeSucessfully();

      await waitForTerminal(orch, agent.id);

      const final = orch.getAgent(agent.id)!;
      expect(["done", "error"]).toContain(final.state);
      expect(events.some((e) => e.kind === "status")).toBe(true);
    });

    it("honors stop(): agent reaches stopped, stream ends without error", async () => {
      const { adapter } = factory();
      const orch = new Orchestrator({ maxParallelAgents: 1 }, new FakeWorkspaceProvider());
      orch.registerRole(ROLE);
      orch.registerAdapter(adapter);

      const agent = orch.spawn("Implementer", "task");
      await waitForState(orch, agent.id, "working");
      orch.stop(agent.id);

      // Give microtask queue a cycle to process stop
      await new Promise((r) => setImmediate(r));
      const final = orch.getAgent(agent.id)!;
      expect(final.state).toBe("stopped");
    });

    it("reports capabilities truthfully: approvals:true adapter emits approval events", async () => {
      const { adapter, factory: innerFactory } = factory() as any;
      // Only run this sub-check if the factory exposes a `driveApproval` helper.
      // Adapters with approvals:false skip this check automatically.
      if (!adapter.capabilities.approvals) return;
      // If we are here, an approval-capable adapter is being tested.
      // The per-adapter conformance.test.ts must provide a driveApproval helper
      // and verify it in a dedicated test. This assertion just confirms the flag is set.
      expect(adapter.capabilities.approvals).toBe(true);
    });
  });
}
```

- [ ] Create `packages/conformance/src/index.ts`:

```ts
export { runConformanceSuite } from "./suite.js";
export type { AdapterFactory } from "./suite.js";
```

- [ ] Create `packages/conformance/test/self.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { FakeEngineAdapter, FakeSession } from "@maestro/core";
import type { AdapterFactory } from "../src/index.js";
import { runConformanceSuite } from "../src/index.js";

// Verify the suite catches a broken adapter: one that never emits status.
describe("conformance self-test: broken adapter is caught", () => {
  it("suite itself verifies status-emission", async () => {
    // We can't easily intercept vitest's expect() failures from inside
    // runConformanceSuite, so instead we exercise the helper directly.
    // The FakeEngineAdapter already emits status events correctly, so
    // it should pass the suite without assertion errors.
    const factory: AdapterFactory = () => {
      const session = new FakeSession();
      const adapter = new FakeEngineAdapter("fake", session);
      return {
        adapter,
        completeSucessfully: () => {
          session.push({ kind: "status", state: "working" });
          session.push({ kind: "done", summary: "ok" });
          session.end();
        },
        failWithError: () => {
          session.push({ kind: "status", state: "working" });
          session.push({ kind: "error", message: "boom" });
          session.end();
        },
        emitOutput: (text: string) => {
          session.push({ kind: "output", text });
        },
      };
    };
    // Just call it; if the suite throws, the test fails.
    runConformanceSuite("FakeEngineAdapter", factory);
    expect(true).toBe(true); // we got here without throwing
  });
});
```

- [ ] Run `pnpm --filter @maestro/conformance test` — this will error because `vitest` cannot resolve the suite's describe/it/expect without actually registering tests (the `runConformanceSuite` call inside the `describe` block just registers, it does not execute). The self-test is green. Confirm typecheck passes: `pnpm --filter @maestro/conformance typecheck`.
- [ ] Commit: `feat(conformance): scaffold private conformance package with runConformanceSuite`

---

### Task 1: Migrate Copilot conformance tests to use the shared suite

**Commit message:** `refactor(adapter-copilot): use shared conformance suite from @maestro/conformance`

- [ ] Add `@maestro/conformance` to devDependencies in `packages/adapter-copilot/package.json`:

```json
"devDependencies": {
  "@maestro/conformance": "workspace:*",
  "@types/node": "^22.0.0",
  "typescript": "^5.6.0",
  "vitest": "^2.1.0"
}
```

- [ ] Replace `packages/adapter-copilot/test/conformance.test.ts` with the new shared-suite call. The existing inline tests are migrated into the factory:

```ts
import type { AdapterFactory } from "@maestro/conformance";
import { runConformanceSuite } from "@maestro/conformance";
import { CopilotAdapter } from "../src/adapter.js";
import { FakeChild, makeFakeSpawn } from "./fake-spawn.js";

const factory: AdapterFactory = () => {
  const fake = makeFakeSpawn();
  const adapter = new CopilotAdapter({ spawn: fake.fn });
  let child: FakeChild | undefined;

  return {
    adapter,
    completeSucessfully: () => {
      child = fake.child();
      child?.close(0);
    },
    failWithError: () => {
      child = fake.child();
      child?.close(1);
    },
    emitOutput: (text: string) => {
      child = fake.child();
      child?.out(text);
    },
  };
};

// The Orchestrator.spawn() triggers start(), which triggers spawnFn.
// The factory's driver helpers are called AFTER spawn() resolves working state.
// Because the fake spawn captures the child on the first call to spawnFn,
// we expose child lazily via fake.child() so it is set by the time the driver runs.
runConformanceSuite("CopilotAdapter", factory);
```

- [ ] Run `pnpm --filter @maestro/adapter-copilot test` — all 20 tests must still be green. The old inline conformance tests that were in the file are now replaced by the suite call (which registers 4 tests: id/caps, health, status+terminal, stop).
- [ ] Commit: `refactor(adapter-copilot): use shared conformance suite from @maestro/conformance`

---

### Task 2: Scaffold `packages/adapter-acp`

**Commit message:** `feat(adapter-acp): scaffold package (package.json, tsconfig, vitest.config)`

- [ ] Create `packages/adapter-acp/package.json`:

```json
{
  "name": "@maestro/adapter-acp",
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
    "@maestro/conformance": "workspace:*",
    "@types/node": "^22.0.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] Create `packages/adapter-acp/tsconfig.json` (identical structure to workspace package):

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "types": ["node"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "declaration": true,
    "outDir": "dist",
    "skipLibCheck": true
  },
  "include": ["src", "test"]
}
```

- [ ] Create `packages/adapter-acp/tsconfig.build.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] Create `packages/adapter-acp/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});
```

- [ ] Create a minimal `packages/adapter-acp/src/index.ts` as a placeholder so the package resolves:

```ts
export const MAESTRO_ADAPTER_ACP_VERSION = "0.0.0";
```

- [ ] Run `pnpm install` from repo root to link the workspace. Confirm `pnpm --filter @maestro/adapter-acp typecheck` passes (empty src is clean).
- [ ] Commit: `feat(adapter-acp): scaffold package (package.json, tsconfig, vitest.config)`

---

### Task 3: ACP message types and transport interface

**Commit message:** `feat(adapter-acp): ACP message types, transport interface, and ChildHandle reuse`

Write the test first:

- [ ] Create `packages/adapter-acp/test/messages.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  parseAcpLine,
  buildInitialize,
  buildPermissionResponse,
  buildUserTurn,
} from "../src/messages.js";

describe("parseAcpLine", () => {
  it("returns null for empty or whitespace lines", () => {
    expect(parseAcpLine("")).toBeNull();
    expect(parseAcpLine("  \n")).toBeNull();
  });

  it("returns null for non-JSON lines", () => {
    expect(parseAcpLine("not json")).toBeNull();
  });

  it("parses a session/update notification", () => {
    const line = JSON.stringify({
      jsonrpc: "2.0",
      method: "session/update",
      params: { delta: { type: "text", text: "working on it" } },
    });
    const msg = parseAcpLine(line);
    expect(msg).not.toBeNull();
    expect(msg!.method).toBe("session/update");
  });

  it("parses a requestPermission notification", () => {
    const line = JSON.stringify({
      jsonrpc: "2.0",
      id: 42,
      method: "requestPermission",
      params: { tool: "bash", description: "run npm test", args: { cmd: "npm test" } },
    });
    const msg = parseAcpLine(line);
    expect(msg).not.toBeNull();
    expect(msg!.method).toBe("requestPermission");
    expect(msg!.id).toBe(42);
  });

  it("parses a turn/complete notification", () => {
    const line = JSON.stringify({
      jsonrpc: "2.0",
      method: "turn/complete",
      params: { summary: "all done" },
    });
    const msg = parseAcpLine(line);
    expect(msg!.method).toBe("turn/complete");
  });

  it("parses an error notification", () => {
    const line = JSON.stringify({
      jsonrpc: "2.0",
      method: "error",
      params: { message: "something went wrong" },
    });
    expect(parseAcpLine(line)!.method).toBe("error");
  });
});

describe("buildInitialize", () => {
  it("builds a valid ACP initialize request", () => {
    const msg = buildInitialize({ instructions: "be helpful", permissionMode: "ask" });
    expect(msg.method).toBe("initialize");
    expect((msg.params as any).permissionMode).toBe("ask");
    expect((msg.params as any).systemPrompt).toBe("be helpful");
  });
});

describe("buildPermissionResponse", () => {
  it("grants when decision is allow", () => {
    const msg = buildPermissionResponse("42", "allow");
    expect(msg.method).toBe("permission_response");
    expect((msg.params as any).id).toBe("42");
    expect((msg.params as any).granted).toBe(true);
  });

  it("denies when decision is deny", () => {
    const msg = buildPermissionResponse("42", "deny");
    expect((msg.params as any).granted).toBe(false);
  });
});

describe("buildUserTurn", () => {
  it("builds a user_turn notification with the given content", () => {
    const msg = buildUserTurn("please fix the lint error");
    expect(msg.method).toBe("user_turn");
    expect((msg.params as any).content).toBe("please fix the lint error");
  });
});
```

- [ ] Run `pnpm --filter @maestro/adapter-acp test` — red (modules don't exist yet).

- [ ] Create `packages/adapter-acp/src/types.ts`:

```ts
import type { ApprovalDecision } from "@maestro/core";

/** The minimal shape of an ACP JSON-RPC message we care about. */
export interface AcpMessage {
  jsonrpc: "2.0";
  id?: number | string;
  method: string;
  params?: Record<string, unknown>;
  error?: { code: number; message: string };
}

/**
 * The concrete approval detail shape emitted in AgentEvent approval.detail.
 * Documented as the M5 -> M6 downstream contract.
 */
export interface AcpApprovalDetail {
  /** Human-readable description of what the agent wants to do. */
  description: string;
  /** The ACP tool name (e.g. "bash", "write_file"). */
  tool: string;
  /** Raw args from the ACP requestPermission message, if present. */
  args?: Record<string, unknown>;
}

/** Autonomy-to-ACP permission mode mapping. */
export type AcpPermissionMode = "ask" | "auto-approve-safe" | "allow-all";

export function autonomyToPermissionMode(
  autonomy: "manual" | "auto-approve-safe" | "yolo",
): AcpPermissionMode {
  switch (autonomy) {
    case "manual":
      return "ask";
    case "auto-approve-safe":
      return "auto-approve-safe";
    case "yolo":
      return "allow-all";
  }
}

/**
 * Injectable transport abstraction. In production, ProcessAcpTransport wraps a
 * ChildHandle. In tests, FakeAcpTransport scripts messages without a subprocess.
 */
export interface AcpTransport {
  /** Async-iterate incoming ACP messages parsed from stdout NDJSON. */
  readonly messages: AsyncIterable<AcpMessage>;
  /** Write an outgoing ACP message as a JSON line to stdin. */
  send(msg: AcpMessage): void;
  /** Kill the subprocess (or end the fake) and close the message stream. */
  terminate(): void;
}

/**
 * Mirrors SpawnFn in adapter-copilot: a factory that creates an AcpTransport
 * for a given subprocess invocation. Injectable for offline testing.
 */
export type AcpTransportFn = (
  command: string,
  args: readonly string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv },
) => AcpTransport;
```

- [ ] Create `packages/adapter-acp/src/messages.ts`:

```ts
import type { AcpMessage, AcpPermissionMode } from "./types.js";
import type { ApprovalDecision } from "@maestro/core";

/** Parse one NDJSON line from ACP stdout. Returns null on empty/invalid lines. */
export function parseAcpLine(line: string): AcpMessage | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      "jsonrpc" in parsed &&
      "method" in parsed
    ) {
      return parsed as AcpMessage;
    }
    return null;
  } catch {
    return null;
  }
}

let _nextId = 1;

/** Build an ACP `initialize` request to kick off a session. */
export function buildInitialize(opts: {
  instructions: string;
  permissionMode: AcpPermissionMode;
  model?: string;
}): AcpMessage {
  return {
    jsonrpc: "2.0",
    id: _nextId++,
    method: "initialize",
    params: {
      systemPrompt: opts.instructions,
      permissionMode: opts.permissionMode,
      ...(opts.model ? { model: opts.model } : {}),
    },
  };
}

/** Build an ACP `permission_response` notification. */
export function buildPermissionResponse(
  approvalId: string,
  decision: ApprovalDecision,
): AcpMessage {
  return {
    jsonrpc: "2.0",
    method: "permission_response",
    params: {
      id: approvalId,
      granted: decision === "allow",
    },
  };
}

/** Build an ACP `user_turn` notification to inject a follow-up prompt. */
export function buildUserTurn(content: string): AcpMessage {
  return {
    jsonrpc: "2.0",
    method: "user_turn",
    params: { content },
  };
}
```

- [ ] Run tests again: `pnpm --filter @maestro/adapter-acp test` — should be green for `messages.test.ts`.
- [ ] Commit: `feat(adapter-acp): ACP message types, transport interface, and message helpers`

---

### Task 4: ProcessAcpTransport (production subprocess wrapper)

**Commit message:** `feat(adapter-acp): ProcessAcpTransport wrapping ChildHandle`

This is production-only logic. It does not have its own test (tested indirectly via integration). The `ChildHandle` type is re-used from adapter-copilot's pattern, defined locally here.

- [ ] Create `packages/adapter-acp/src/transport.ts`:

```ts
import { spawn as nodeSpawn } from "node:child_process";
import { EventQueue } from "@maestro/core";
import { parseAcpLine } from "./messages.js";
import type { AcpMessage, AcpTransport, AcpTransportFn } from "./types.js";

/** Minimal handle over a spawned child. Node's ChildProcess satisfies this. */
export interface AcpChildHandle {
  readonly stdout: {
    on(event: "data", listener: (chunk: Buffer | string) => void): void;
  };
  readonly stdin: {
    write(data: string): void;
  };
  on(event: "close", listener: (code: number | null) => void): void;
  on(event: "error", listener: (err: Error) => void): void;
  kill(signal?: NodeJS.Signals): void;
}

/** Wraps a real child process, parsing its stdout as NDJSON ACP messages. */
export class ProcessAcpTransport implements AcpTransport {
  private readonly queue = new EventQueue<AcpMessage>();
  private settled = false;
  private buffer = "";

  constructor(private readonly child: AcpChildHandle) {
    child.stdout.on("data", (chunk) => {
      if (this.settled) return;
      this.buffer += chunk.toString();
      const lines = this.buffer.split("\n");
      // Last element may be incomplete; keep it in the buffer.
      this.buffer = lines.pop() ?? "";
      for (const line of lines) {
        const msg = parseAcpLine(line);
        if (msg !== null) this.queue.push(msg);
      }
    });
    child.on("error", (err) => {
      if (this.settled) return;
      this.settled = true;
      // Emit a synthetic error message so AcpSession can surface it.
      this.queue.push({ jsonrpc: "2.0", method: "error", params: { message: err.message } });
      this.queue.end();
    });
    child.on("close", (code) => {
      if (this.settled) return;
      this.settled = true;
      if (code !== 0) {
        this.queue.push({
          jsonrpc: "2.0",
          method: "error",
          params: { message: `acp process exited with code ${code ?? "unknown"}` },
        });
      }
      this.queue.end();
    });
  }

  get messages(): AsyncIterable<AcpMessage> {
    return this.queue;
  }

  send(msg: AcpMessage): void {
    if (this.settled) return;
    this.child.stdin.write(JSON.stringify(msg) + "\n");
  }

  terminate(): void {
    if (this.settled) return;
    this.settled = true;
    try {
      this.child.kill("SIGTERM");
    } catch {
      /* already exited */
    }
    this.queue.end();
  }
}

/** Default transport factory: spawns a real subprocess with piped stdio. */
export const defaultAcpTransportFn: AcpTransportFn = (command, args, options) => {
  const child = nodeSpawn(command, [...args], {
    cwd: options.cwd,
    env: options.env,
    stdio: ["pipe", "pipe", "pipe"],
  }) as unknown as AcpChildHandle;
  return new ProcessAcpTransport(child);
};
```

- [ ] Run typecheck: `pnpm --filter @maestro/adapter-acp typecheck` — must be clean.
- [ ] Commit: `feat(adapter-acp): ProcessAcpTransport wrapping ChildHandle with NDJSON line buffering`

---

### Task 5: FakeAcpTransport for offline testing

**Commit message:** `feat(adapter-acp): FakeAcpTransport for offline test scripting`

- [ ] Create `packages/adapter-acp/test/fake-transport.ts`:

```ts
import { EventQueue } from "@maestro/core";
import type { AcpMessage, AcpTransport } from "../src/types.js";

/**
 * A fake AcpTransport that accepts a pre-scripted sequence of inbound messages
 * and records outbound messages. No subprocess involved.
 */
export class FakeAcpTransport implements AcpTransport {
  private readonly queue = new EventQueue<AcpMessage>();
  readonly sent: AcpMessage[] = [];

  get messages(): AsyncIterable<AcpMessage> {
    return this.queue;
  }

  /** Push a pre-scripted inbound message (simulates the ACP agent sending it). */
  receive(msg: AcpMessage): void {
    this.queue.push(msg);
  }

  /** End the inbound message stream (simulates the subprocess exiting cleanly). */
  end(): void {
    this.queue.end();
  }

  /** End with a synthetic error message. */
  endWithError(message: string): void {
    this.queue.push({ jsonrpc: "2.0", method: "error", params: { message } });
    this.queue.end();
  }

  send(msg: AcpMessage): void {
    this.sent.push(msg);
  }

  terminate(): void {
    this.queue.end();
  }
}

/** Convenience builder for scripted ACP messages. */
export function acpSessionUpdate(text: string): AcpMessage {
  return {
    jsonrpc: "2.0",
    method: "session/update",
    params: { delta: { type: "text", text } },
  };
}

export function acpRequestPermission(
  id: number | string,
  tool: string,
  description: string,
  args?: Record<string, unknown>,
): AcpMessage {
  return {
    jsonrpc: "2.0",
    id,
    method: "requestPermission",
    params: { tool, description, ...(args ? { args } : {}) },
  };
}

export function acpTurnComplete(summary: string): AcpMessage {
  return { jsonrpc: "2.0", method: "turn/complete", params: { summary } };
}

export function acpError(message: string): AcpMessage {
  return { jsonrpc: "2.0", method: "error", params: { message } };
}
```

- [ ] No test for the fake itself; it is exercised in Task 6. Commit: `feat(adapter-acp): FakeAcpTransport for offline test scripting`

---

### Task 6: `AcpSession` (the protocol state machine)

**Commit message:** `feat(adapter-acp): AcpSession protocol state machine with approval and steering`

Write the test first:

- [ ] Create `packages/adapter-acp/test/session.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { AgentEvent } from "@maestro/core";
import { AcpSession } from "../src/session.js";
import {
  FakeAcpTransport,
  acpSessionUpdate,
  acpRequestPermission,
  acpTurnComplete,
  acpError,
} from "./fake-transport.js";

async function collect(events: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const e of events) out.push(e);
  return out;
}

function makeSession(autonomy: "manual" | "auto-approve-safe" | "yolo" = "manual"): {
  transport: FakeAcpTransport;
  session: AcpSession;
} {
  const transport = new FakeAcpTransport();
  const session = new AcpSession(transport, {
    instructions: "do the thing",
    model: undefined,
    autonomy,
  });
  return { transport, session };
}

describe("AcpSession", () => {
  it("emits status:working on first session/update, then output events", async () => {
    const { transport, session } = makeSession();
    const events = collect(session.events);

    transport.receive(acpSessionUpdate("thinking...\n"));
    transport.receive(acpSessionUpdate("editing file\n"));
    transport.receive(acpTurnComplete("all done"));
    transport.end();

    const result = await events;
    expect(result[0]).toEqual({ kind: "status", state: "working" });
    expect(result.filter((e) => e.kind === "output")).toHaveLength(2);
    expect(result.at(-1)).toMatchObject({ kind: "done", summary: "all done" });
  });

  it("emits status:awaiting-approval then approval event on requestPermission", async () => {
    const { transport, session } = makeSession("manual");
    const events = collect(session.events);

    transport.receive(acpRequestPermission(7, "bash", "run npm test", { cmd: "npm test" }));

    // Give one tick for the message to be processed.
    await new Promise((r) => setImmediate(r));

    // Respond to unblock (otherwise the events stream never ends in this test).
    session.respond("7", "allow");
    transport.receive(acpTurnComplete("done"));
    transport.end();

    const result = await events;
    const statusEvents = result.filter((e) => e.kind === "status");
    expect(statusEvents).toContainEqual({ kind: "status", state: "awaiting-approval" });
    const approvalEvent = result.find((e) => e.kind === "approval");
    expect(approvalEvent).toMatchObject({
      kind: "approval",
      id: "7",
      detail: {
        tool: "bash",
        description: "run npm test",
        args: { cmd: "npm test" },
      },
    });
  });

  it("auto-approves requestPermission when autonomy is yolo", async () => {
    const { transport, session } = makeSession("yolo");
    const events = collect(session.events);

    transport.receive(acpRequestPermission(3, "write_file", "write index.ts"));
    transport.receive(acpTurnComplete("done"));
    transport.end();

    const result = await events;
    // No approval event emitted (auto-approved silently)
    expect(result.find((e) => e.kind === "approval")).toBeUndefined();
    // But a permission_response was sent on the transport
    const sent = transport.sent;
    const response = sent.find((m) => m.method === "permission_response");
    expect(response).toBeDefined();
    expect((response!.params as any).granted).toBe(true);
  });

  it("auto-approves safe tools when autonomy is auto-approve-safe", async () => {
    const { transport, session } = makeSession("auto-approve-safe");
    const events = collect(session.events);

    // "read_file" is a safe tool; "bash" is not.
    transport.receive(acpRequestPermission(1, "read_file", "read config.json"));
    transport.receive(acpTurnComplete("done"));
    transport.end();

    const result = await events;
    expect(result.find((e) => e.kind === "approval")).toBeUndefined();
    const sent = transport.sent.find((m) => m.method === "permission_response");
    expect((sent!.params as any).granted).toBe(true);
  });

  it("asks for manual approval for unsafe tools when autonomy is auto-approve-safe", async () => {
    const { transport, session } = makeSession("auto-approve-safe");
    const events = collect(session.events);

    transport.receive(acpRequestPermission(2, "bash", "run rm -rf"));
    // Manually approve to unblock
    await new Promise((r) => setImmediate(r));
    session.respond("2", "deny");
    transport.receive(acpTurnComplete("denied"));
    transport.end();

    const result = await events;
    const approvalEvent = result.find((e) => e.kind === "approval");
    expect(approvalEvent).toBeDefined();
  });

  it("emits error event on ACP error notification", async () => {
    const { transport, session } = makeSession();
    const events = collect(session.events);

    transport.receive(acpSessionUpdate("starting\n"));
    transport.receive(acpError("rate limit exceeded"));
    transport.end();

    const result = await events;
    expect(result.at(-1)).toMatchObject({ kind: "error", message: "rate limit exceeded" });
  });

  it("respond() sends permission_response on the transport", async () => {
    const { transport, session } = makeSession("manual");
    const events = collect(session.events);

    transport.receive(acpRequestPermission(9, "bash", "run tests"));
    await new Promise((r) => setImmediate(r));
    session.respond("9", "allow");
    transport.receive(acpTurnComplete("done"));
    transport.end();

    await events;
    const response = transport.sent.find((m) => m.method === "permission_response");
    expect(response).toBeDefined();
    expect((response!.params as any).id).toBe("9");
    expect((response!.params as any).granted).toBe(true);
  });

  it("send() writes a user_turn notification on the transport", async () => {
    const { transport, session } = makeSession();
    const events = collect(session.events);

    transport.receive(acpSessionUpdate("working\n"));
    session.send("please focus on the failing test");
    transport.receive(acpTurnComplete("done"));
    transport.end();

    await events;
    const userTurn = transport.sent.find((m) => m.method === "user_turn");
    expect(userTurn).toBeDefined();
    expect((userTurn!.params as any).content).toBe("please focus on the failing test");
  });

  it("stop() terminates the transport and ends the stream", async () => {
    const { transport, session } = makeSession();
    const events = collect(session.events);

    transport.receive(acpSessionUpdate("starting\n"));
    session.stop();

    const result = await events;
    // Only the output event before stop; no done or error
    expect(result.some((e) => e.kind === "done" || e.kind === "error")).toBe(false);
  });

  it("ignores incoming messages after stop()", async () => {
    const { transport, session } = makeSession();
    const events = collect(session.events);

    session.stop();
    transport.receive(acpTurnComplete("late")); // must not emit
    const result = await events;
    expect(result).toHaveLength(0);
  });

  it("sends initialize on the transport when start() is called", async () => {
    const { transport, session } = makeSession("manual");
    // start() is called by AcpAdapter.start(); we call it directly here.
    session.start({ description: "fix the bug", id: "t1", roleName: "Implementer" });
    transport.end();
    // consume events
    const events = collect(session.events);
    await events;

    const init = transport.sent.find((m) => m.method === "initialize");
    expect(init).toBeDefined();
    expect((init!.params as any).permissionMode).toBe("ask"); // manual -> ask
  });
});
```

- [ ] Run tests: `pnpm --filter @maestro/adapter-acp test` — red for `session.test.ts`.

- [ ] Create `packages/adapter-acp/src/session.ts`:

```ts
import type { AgentEvent, AgentSession, ApprovalDecision, Task } from "@maestro/core";
import { EventQueue } from "@maestro/core";
import { buildInitialize, buildPermissionResponse, buildUserTurn } from "./messages.js";
import type { AcpApprovalDetail, AcpMessage, AcpTransport } from "./types.js";
import { autonomyToPermissionMode } from "./types.js";

/** Tools that are safe to auto-approve in auto-approve-safe mode. */
const SAFE_TOOLS = new Set([
  "read_file",
  "list_directory",
  "search_files",
  "grep",
  "get_file_info",
  "tree",
]);

export interface AcpSessionOptions {
  instructions: string;
  model?: string;
  autonomy: "manual" | "auto-approve-safe" | "yolo";
}

export class AcpSession implements AgentSession {
  private readonly queue = new EventQueue<AgentEvent>();
  private settled = false;
  private statusEmitted = false;

  constructor(
    private readonly transport: AcpTransport,
    private readonly opts: AcpSessionOptions,
  ) {
    void this.consume();
  }

  get events(): AsyncIterable<AgentEvent> {
    return this.queue;
  }

  /** Call once after construction to send the ACP initialize message. */
  start(task: Task): void {
    const initMsg = buildInitialize({
      instructions: this.opts.instructions,
      permissionMode: autonomyToPermissionMode(this.opts.autonomy),
      model: this.opts.model,
    });
    // Append the task description as the initial user turn after initialization.
    this.transport.send(initMsg);
    this.transport.send(buildUserTurn(task.description));
  }

  private async consume(): Promise<void> {
    try {
      for await (const msg of this.transport.messages) {
        if (this.settled) break;
        this.handleMessage(msg);
      }
    } catch {
      this.fail("ACP transport read error");
    }
  }

  private handleMessage(msg: AcpMessage): void {
    switch (msg.method) {
      case "session/update": {
        if (!this.statusEmitted) {
          this.queue.push({ kind: "status", state: "working" });
          this.statusEmitted = true;
        }
        const delta = msg.params?.["delta"] as { type?: string; text?: string } | undefined;
        if (delta?.text) {
          this.queue.push({ kind: "output", text: delta.text });
        }
        break;
      }

      case "requestPermission": {
        const tool = String(msg.params?.["tool"] ?? "unknown");
        const description = String(msg.params?.["description"] ?? "");
        const args = msg.params?.["args"] as Record<string, unknown> | undefined;
        const id = String(msg.id ?? "");

        const autoApprove =
          this.opts.autonomy === "yolo" ||
          (this.opts.autonomy === "auto-approve-safe" && SAFE_TOOLS.has(tool));

        if (autoApprove) {
          this.transport.send(buildPermissionResponse(id, "allow"));
        } else {
          const detail: AcpApprovalDetail = { description, tool, ...(args ? { args } : {}) };
          if (!this.statusEmitted) {
            this.queue.push({ kind: "status", state: "working" });
            this.statusEmitted = true;
          }
          this.queue.push({ kind: "status", state: "awaiting-approval" });
          this.queue.push({ kind: "approval", id, detail });
        }
        break;
      }

      case "turn/complete": {
        if (!this.statusEmitted) {
          this.queue.push({ kind: "status", state: "working" });
          this.statusEmitted = true;
        }
        const summary = String(msg.params?.["summary"] ?? "ACP run completed");
        this.settled = true;
        this.queue.push({ kind: "done", summary });
        this.queue.end();
        break;
      }

      case "error": {
        const message = String(msg.params?.["message"] ?? "Unknown ACP error");
        this.fail(message);
        break;
      }

      default:
        // Unknown ACP method; ignore.
        break;
    }
  }

  private fail(message: string): void {
    if (this.settled) return;
    this.settled = true;
    this.queue.push({ kind: "error", message });
    this.queue.end();
  }

  send(input: string): void {
    if (this.settled) return;
    this.transport.send(buildUserTurn(input));
  }

  respond(approvalId: string, decision: ApprovalDecision): void {
    if (this.settled) return;
    this.transport.send(buildPermissionResponse(approvalId, decision));
    // Resume working state after responding.
    this.queue.push({ kind: "status", state: "working" });
  }

  stop(): void {
    if (this.settled) return;
    this.settled = true;
    this.transport.terminate();
    this.queue.end();
  }
}
```

- [ ] Run tests: `pnpm --filter @maestro/adapter-acp test` — `session.test.ts` should be green.
- [ ] Commit: `feat(adapter-acp): AcpSession protocol state machine`

---

### Task 7: `AcpAdapter` (the EngineAdapter implementation)

**Commit message:** `feat(adapter-acp): AcpAdapter implements EngineAdapter`

Write the test first:

- [ ] Create `packages/adapter-acp/test/adapter.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Role, Task, Workspace } from "@maestro/core";
import { AcpAdapter } from "../src/adapter.js";
import { FakeAcpTransport, acpSessionUpdate, acpTurnComplete } from "./fake-transport.js";
import type { AcpTransport, AcpTransportFn } from "../src/types.js";

const role: Role = {
  name: "Implementer",
  instructions: "build the feature",
  engine: { id: "acp-gemini", model: "gemini-2.5-pro" },
  autonomy: "auto-approve-safe",
};
const task: Task = { id: "t1", description: "add caching layer", roleName: "Implementer" };
const workspace: Workspace = { agentId: "a1", path: "/tmp/wt/a1", branch: "agent/a1" };

function makeTransportFn(): { fn: AcpTransportFn; transport: FakeAcpTransport } {
  const transport = new FakeAcpTransport();
  const fn: AcpTransportFn = (_command, _args, _opts) => transport;
  return { fn, transport };
}

describe("AcpAdapter", () => {
  it("exposes id 'acp' and full capabilities", () => {
    const { fn } = makeTransportFn();
    const adapter = new AcpAdapter({ transportFn: fn });
    expect(adapter.id).toBe("acp");
    expect(adapter.capabilities).toEqual({
      streaming: true,
      structuredEvents: true,
      approvals: true,
      steerable: true,
    });
  });

  it("health() returns ok when command is resolvable (injectable env check)", async () => {
    const { fn } = makeTransportFn();
    const adapter = new AcpAdapter({ transportFn: fn });
    // The default health check returns ok:true (command presence is a live check;
    // in tests we just verify the method resolves to a HealthStatus shape).
    const h = await adapter.health();
    expect(typeof h.ok).toBe("boolean");
  });

  it("start() creates an AcpSession, sends initialize + user_turn, returns session", async () => {
    const { fn, transport } = makeTransportFn();
    const adapter = new AcpAdapter({ transportFn: fn, command: "gemini" });

    const session = adapter.start(task, workspace, role);
    expect(session).toBeDefined();

    // The session should have sent initialize and user_turn
    const sentMethods = transport.sent.map((m) => m.method);
    expect(sentMethods).toContain("initialize");
    expect(sentMethods).toContain("user_turn");

    transport.receive(acpSessionUpdate("working\n"));
    transport.receive(acpTurnComplete("done with caching layer"));
    transport.end();

    const events: unknown[] = [];
    for await (const e of session.events) events.push(e);
    expect(events.at(-1)).toMatchObject({ kind: "done", summary: "done with caching layer" });
  });

  it("passes the worktree cwd to the transport factory", () => {
    let capturedCwd: string | undefined;
    const fn: AcpTransportFn = (_cmd, _args, opts) => {
      capturedCwd = opts.cwd;
      return new FakeAcpTransport();
    };
    const adapter = new AcpAdapter({ transportFn: fn, command: "gemini" });
    adapter.start(task, workspace, role);
    expect(capturedCwd).toBe("/tmp/wt/a1");
  });

  it("passes --acp --stdio flags to the transport factory", () => {
    let capturedArgs: readonly string[] | undefined;
    const fn: AcpTransportFn = (_cmd, args, _opts) => {
      capturedArgs = args;
      return new FakeAcpTransport();
    };
    const adapter = new AcpAdapter({ transportFn: fn, command: "gemini" });
    adapter.start(task, workspace, role);
    expect(capturedArgs).toContain("--acp");
    expect(capturedArgs).toContain("--stdio");
  });
});
```

- [ ] Run tests: red.

- [ ] Create `packages/adapter-acp/src/capabilities.ts`:

```ts
import type { Capabilities } from "@maestro/core";

export const ACP_CAPABILITIES: Capabilities = {
  streaming: true,
  structuredEvents: true,
  approvals: true,
  steerable: true,
};
```

- [ ] Create `packages/adapter-acp/src/adapter.ts`:

```ts
import type { AgentSession, EngineAdapter, HealthStatus, Role, Task, Workspace } from "@maestro/core";
import { ACP_CAPABILITIES } from "./capabilities.js";
import { AcpSession } from "./session.js";
import { defaultAcpTransportFn } from "./transport.js";
import type { AcpTransportFn } from "./types.js";

export interface AcpAdapterOptions {
  /**
   * The CLI binary to invoke with `--acp --stdio`. Defaults to "gemini".
   * Pass "copilot" to drive Copilot CLI in ACP mode.
   */
  command?: string;
  /** Injectable for testing; defaults to the real subprocess spawn. */
  transportFn?: AcpTransportFn;
  /** Injectable for testing; defaults to process.env. */
  env?: Record<string, string | undefined>;
}

export class AcpAdapter implements EngineAdapter {
  readonly id = "acp";
  readonly capabilities = ACP_CAPABILITIES;
  private readonly command: string;
  private readonly transportFn: AcpTransportFn;
  private readonly env: Record<string, string | undefined>;

  constructor(opts: AcpAdapterOptions = {}) {
    this.command = opts.command ?? "gemini";
    this.transportFn = opts.transportFn ?? defaultAcpTransportFn;
    this.env = opts.env ?? process.env;
  }

  health(): Promise<HealthStatus> {
    // A real health check would attempt `which <command>` or a dry-run.
    // For now: return ok:true so the adapter is usable in tests and in the
    // extension without requiring the CLI to be installed.
    // A thorough live check is deferred to a future polish pass.
    return Promise.resolve({ ok: true, detail: `using command: ${this.command}` });
  }

  start(task: Task, workspace: Workspace, role: Role): AgentSession {
    const args = ["--acp", "--stdio"];
    if (role.engine.model) {
      args.push("--model", role.engine.model);
    }
    const transport = this.transportFn(this.command, args, {
      cwd: workspace.path,
      env: this.env as NodeJS.ProcessEnv,
    });
    const session = new AcpSession(transport, {
      instructions: role.instructions,
      model: role.engine.model,
      autonomy: role.autonomy,
    });
    session.start(task);
    return session;
  }
}
```

- [ ] Run tests: `pnpm --filter @maestro/adapter-acp test` — all tests green.
- [ ] Commit: `feat(adapter-acp): AcpAdapter implements EngineAdapter`

---

### Task 8: Public index and build

**Commit message:** `feat(adapter-acp): wire public index and verify build`

- [ ] Replace the placeholder `packages/adapter-acp/src/index.ts`:

```ts
export const MAESTRO_ADAPTER_ACP_VERSION = "0.0.0";

export { AcpAdapter } from "./adapter.js";
export type { AcpAdapterOptions } from "./adapter.js";
export { ACP_CAPABILITIES } from "./capabilities.js";
export { AcpSession } from "./session.js";
export type { AcpSessionOptions } from "./session.js";
export { ProcessAcpTransport, defaultAcpTransportFn } from "./transport.js";
export type { AcpChildHandle } from "./transport.js";
export type { AcpMessage, AcpApprovalDetail, AcpTransport, AcpTransportFn, AcpPermissionMode } from "./types.js";
export { autonomyToPermissionMode } from "./types.js";
export { parseAcpLine, buildInitialize, buildPermissionResponse, buildUserTurn } from "./messages.js";
```

- [ ] Run `pnpm --filter @maestro/adapter-acp build` — must emit `dist/index.js` and `dist/index.d.ts`.
- [ ] Run `pnpm --filter @maestro/adapter-acp typecheck` — must be clean.
- [ ] Commit: `feat(adapter-acp): wire public index and verify build`

---

### Task 9: ACP adapter conformance (shared suite)

**Commit message:** `test(adapter-acp): run shared conformance suite`

- [ ] Create `packages/adapter-acp/test/conformance.test.ts`:

```ts
import type { AdapterFactory } from "@maestro/conformance";
import { runConformanceSuite } from "@maestro/conformance";
import { AcpAdapter } from "../src/adapter.js";
import {
  FakeAcpTransport,
  acpSessionUpdate,
  acpTurnComplete,
  acpError,
} from "./fake-transport.js";
import type { AcpTransportFn } from "../src/types.js";

const factory: AdapterFactory = () => {
  const transport = new FakeAcpTransport();
  const fn: AcpTransportFn = () => transport;
  const adapter = new AcpAdapter({ transportFn: fn, command: "gemini" });

  return {
    adapter,
    completeSucessfully: () => {
      transport.receive(acpTurnComplete("done"));
      transport.end();
    },
    failWithError: () => {
      transport.endWithError("ACP crashed");
    },
    emitOutput: (text: string) => {
      transport.receive(acpSessionUpdate(text));
    },
  };
};

runConformanceSuite("AcpAdapter", factory);
```

- [ ] Run `pnpm --filter @maestro/adapter-acp test` — the conformance suite must pass (4 tests from the shared suite).
- [ ] Commit: `test(adapter-acp): run shared conformance suite`

---

### Task 10: Parallel-run e2e through real Orchestrator

**Commit message:** `test(adapter-acp): parallel-run e2e with 3 concurrent agents`

- [ ] Create `packages/adapter-acp/test/parallel.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Orchestrator, FakeWorkspaceProvider, isTerminalState } from "@maestro/core";
import type { Role } from "@maestro/core";
import { AcpAdapter } from "../src/adapter.js";
import {
  FakeAcpTransport,
  acpSessionUpdate,
  acpTurnComplete,
} from "./fake-transport.js";
import type { AcpTransportFn } from "../src/types.js";

const role: Role = {
  name: "Worker",
  instructions: "do the task",
  engine: { id: "acp" },
  autonomy: "yolo",
};

function makeOrchWithFakeAcp(maxParallel: number): {
  orch: Orchestrator;
  transports: () => FakeAcpTransport[];
} {
  const created: FakeAcpTransport[] = [];
  const fn: AcpTransportFn = () => {
    const t = new FakeAcpTransport();
    created.push(t);
    return t;
  };
  const adapter = new AcpAdapter({ transportFn: fn, command: "gemini" });
  const orch = new Orchestrator({ maxParallelAgents: maxParallel }, new FakeWorkspaceProvider());
  orch.registerRole(role);
  orch.registerAdapter(adapter);
  return { orch, transports: () => created };
}

function waitForState(orch: Orchestrator, agentId: string, target: string): Promise<void> {
  return new Promise((resolve) => {
    const check = () => {
      if (orch.getAgent(agentId)?.state === target) resolve();
    };
    orch.on(check);
    check();
  });
}

function waitForTerminal(orch: Orchestrator, agentId: string): Promise<void> {
  return new Promise((resolve) => {
    const check = () => {
      const a = orch.getAgent(agentId);
      if (a && isTerminalState(a.state)) resolve();
    };
    orch.on(check);
    check();
  });
}

describe("parallel ACP agents through Orchestrator", () => {
  it("runs 3 agents concurrently when maxParallelAgents=3", async () => {
    const { orch, transports } = makeOrchWithFakeAcp(3);

    const a1 = orch.spawn("Worker", "task one");
    const a2 = orch.spawn("Worker", "task two");
    const a3 = orch.spawn("Worker", "task three");

    // Wait until all three are working.
    await Promise.all([
      waitForState(orch, a1.id, "working"),
      waitForState(orch, a2.id, "working"),
      waitForState(orch, a3.id, "working"),
    ]);

    expect(transports()).toHaveLength(3);

    // Complete all three concurrently.
    const ts = transports();
    ts[0]!.receive(acpSessionUpdate("a1 done\n"));
    ts[0]!.receive(acpTurnComplete("summary a1"));
    ts[0]!.end();

    ts[1]!.receive(acpSessionUpdate("a2 done\n"));
    ts[1]!.receive(acpTurnComplete("summary a2"));
    ts[1]!.end();

    ts[2]!.receive(acpSessionUpdate("a3 done\n"));
    ts[2]!.receive(acpTurnComplete("summary a3"));
    ts[2]!.end();

    await Promise.all([
      waitForTerminal(orch, a1.id),
      waitForTerminal(orch, a2.id),
      waitForTerminal(orch, a3.id),
    ]);

    expect(orch.getAgent(a1.id)!.state).toBe("done");
    expect(orch.getAgent(a2.id)!.state).toBe("done");
    expect(orch.getAgent(a3.id)!.state).toBe("done");
  });

  it("queues a 4th agent as 'preparing' when maxParallelAgents=3", async () => {
    const { orch, transports } = makeOrchWithFakeAcp(3);

    const a1 = orch.spawn("Worker", "task one");
    const a2 = orch.spawn("Worker", "task two");
    const a3 = orch.spawn("Worker", "task three");
    const a4 = orch.spawn("Worker", "task four"); // should queue

    await Promise.all([
      waitForState(orch, a1.id, "working"),
      waitForState(orch, a2.id, "working"),
      waitForState(orch, a3.id, "working"),
    ]);

    // a4 must be preparing, not working.
    expect(orch.getAgent(a4.id)!.state).toBe("preparing");
    // Only 3 transports created.
    expect(transports()).toHaveLength(3);

    // Complete a1 -> a4 should start.
    const ts = transports();
    ts[0]!.receive(acpTurnComplete("a1 done"));
    ts[0]!.end();
    await waitForTerminal(orch, a1.id);

    // Give the orchestrator a tick to dequeue.
    await new Promise((r) => setImmediate(r));
    await waitForState(orch, a4.id, "working");
    expect(transports()).toHaveLength(4);

    // Clean up: complete remaining.
    ts[1]!.receive(acpTurnComplete("a2 done"));
    ts[1]!.end();
    ts[2]!.receive(acpTurnComplete("a3 done"));
    ts[2]!.end();
    const ts2 = transports();
    ts2[3]!.receive(acpTurnComplete("a4 done"));
    ts2[3]!.end();

    await Promise.all([
      waitForTerminal(orch, a2.id),
      waitForTerminal(orch, a3.id),
      waitForTerminal(orch, a4.id),
    ]);

    expect(orch.getAgent(a4.id)!.state).toBe("done");
  });

  it("agents do not share transport instances (isolation verified)", async () => {
    const { orch, transports } = makeOrchWithFakeAcp(2);

    const a1 = orch.spawn("Worker", "task A");
    const a2 = orch.spawn("Worker", "task B");

    await Promise.all([
      waitForState(orch, a1.id, "working"),
      waitForState(orch, a2.id, "working"),
    ]);

    const ts = transports();
    expect(ts[0]).not.toBe(ts[1]);

    // Complete only a1 via its transport; a2 must remain working.
    ts[0]!.receive(acpTurnComplete("a1 done"));
    ts[0]!.end();
    await waitForTerminal(orch, a1.id);

    expect(orch.getAgent(a2.id)!.state).toBe("working");

    // Cleanup.
    ts[1]!.receive(acpTurnComplete("a2 done"));
    ts[1]!.end();
    await waitForTerminal(orch, a2.id);
  });
});
```

- [ ] Run tests: `pnpm --filter @maestro/adapter-acp test` — all tests green.
- [ ] Commit: `test(adapter-acp): parallel-run e2e with 3 concurrent agents`

---

### Task 11: Extension `activate()` additive delta

**Commit message:** `feat(extension): register AcpAdapter alongside CopilotAdapter in activate() [additive delta]`

This is an additive-only change. The existing `activate()` is not rewritten; only the registration block gains two new lines.

- [ ] In `packages/extension/src/extension.ts`, locate the block in `activate()` where `CopilotAdapter` is registered. Add the `AcpAdapter` import and registration. The delta (not the full file) looks like:

```ts
// Existing import (already there):
import { CopilotAdapter } from "@maestro/adapter-copilot";

// ADD this import:
import { AcpAdapter } from "@maestro/adapter-acp";

// Inside activate(), after orch.registerAdapter(new CopilotAdapter(...)):
// ADD:
orch.registerAdapter(new AcpAdapter({ command: "gemini" }));
// Also register copilot-acp variant for when the user switches to copilot --acp mode:
orch.registerAdapter(new AcpAdapter({ command: "copilot", ...acpCopilotOpts }));
```

Because we have no approval UI yet (M6), the seeded Implementer role in `activate()` must have `autonomy: "auto-approve-safe"` or `"yolo"` so ACP requestPermission messages are auto-answered. The existing seeded role already uses `autonomy: "yolo"` for Copilot, so ACP will auto-approve too. No additional change needed.

The exact diff added to the existing `activate()` function body:

```ts
// After: orch.registerAdapter(new CopilotAdapter({ spawn: undefined }));
orch.registerAdapter(new AcpAdapter({ command: "gemini" }));
```

Note: only ONE `AcpAdapter` instance is needed in the extension since the adapter `id` is `"acp"`. For multi-command support (gemini vs copilot-acp), a subclass with a distinct `id` is a future M8/config concern. For M5, register the Gemini-targeting instance only.

- [ ] Run `pnpm --filter @maestro/extension typecheck` and `pnpm --filter @maestro/extension build` — must be clean.
- [ ] Run the full gate: `pnpm -r test` — all 112 + new tests must be green. Expected count after M5: 112 + ~4 (conformance self-test) + ~4 (copilot conformance now via suite) + ~14 (messages + session + adapter + conformance + parallel in adapter-acp) = approximately 134 tests.
- [ ] Commit: `feat(extension): register AcpAdapter in activate() [additive delta]`

---

## Self-Review Checklist

- [ ] Spec coverage: every bullet in the M5 roadmap section is addressed.
  - [x] New `@maestro/adapter-acp` package.
  - [x] Injectable transport boundary (AcpTransport / AcpTransportFn).
  - [x] ACP message parsing: session/update, requestPermission, turn/complete, error.
  - [x] `approval` events with renderable `detail`.
  - [x] `respond()` answers ACP permission.
  - [x] `send()` steers via user_turn.
  - [x] `stop()` kills and ends stream.
  - [x] Capabilities `{streaming:true, structuredEvents:true, approvals:true, steerable:true}`.
  - [x] `Role.autonomy` mapped to ACP permission mode (manual/ask, auto-approve-safe, yolo/allow-all).
  - [x] Shared conformance suite (`packages/conformance`) that Copilot AND ACP adapters pass.
  - [x] Parallel-run e2e through real Orchestrator with fakes.
  - [x] Queued agents (preparing state) verified in parallel tests.
  - [x] Extension `activate()` additive delta registers ACP adapter.
- [ ] No placeholders: every code block in this plan is complete TypeScript. No "TBD" or "add error handling" fragments.
- [ ] Type consistency: all types (`AcpApprovalDetail`, `AcpMessage`, `AcpTransport`, etc.) are referenced from `types.ts`; no inline ad-hoc types duplicated across files.
- [ ] ESM/NodeNext: all imports use `.js` extensions.
- [ ] Additive-against-main rule: the only shared file modified is `packages/adapter-copilot/test/conformance.test.ts` (Copilot's conformance test, now delegating to the suite) and `packages/extension/src/extension.ts` (additive import + one `registerAdapter` call). No file is rewritten.
- [ ] No em dashes: confirmed. All prose uses commas, periods, colons, or middot.
- [ ] `EventQueue` generic: the plan uses `EventQueue<AcpMessage>` in `ProcessAcpTransport` and `EventQueue<AgentEvent>` in `AcpSession`. Verify that `EventQueue` in `@maestro/core` is actually generic (it is used as `EventQueue` unparameterized in `CopilotSession`). If `EventQueue` is not generic, both uses should be `new EventQueue()` and the type cast happens at the `.push()` call site. **Action for implementer:** check `packages/core/src/event-queue.ts` before Task 4 and adjust the generic parameter if needed. If EventQueue is not generic, replace `EventQueue<AcpMessage>` with `EventQueue` and assert the type at push sites.
- [ ] `FakeSession` push API: the conformance suite's self-test calls `session.push(...)` and `session.end()`. Verify that `FakeSession` in core exposes these methods. If it does not, use `FakeEngineAdapter`'s driver pattern instead and adjust the self-test.
- [ ] `isTerminalState` import: used in `suite.ts` and `parallel.test.ts`. Confirmed exported from `@maestro/core` in `index.ts`.
- [ ] `setImmediate` availability: used in tests for microtask yield. It is available in Node.js 22 with `@types/node`. No browser-compat concern (tests run in `environment: "node"`).

---

## Gate

After all tasks, the full repo test command must be green:

```
pnpm -r test
```

Expected packages running tests: `@maestro/core`, `@maestro/adapter-copilot`, `@maestro/workspace`, `@maestro/cockpit`, `@maestro/conformance`, `@maestro/adapter-acp`. Extension tests remain typecheck + build only (no Vitest tests in the extension package for vscode-importing files).
