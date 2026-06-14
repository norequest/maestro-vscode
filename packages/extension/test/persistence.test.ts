import { describe, it, expect } from "vitest";
import type { OrchestratorEvent, Agent } from "@maestro/core";
import {
  serializeEvent,
  deserializeEvent,
  replayToRecords,
  isSafeAgentId,
  safeAgentFileName,
  MemoryPersistenceBackend,
  EventLogger,
  type PersistenceBackend,
} from "../src/persistence.js";

/** A backend whose append() resolves only when `flush()` is called, to expose ordering. */
class DeferredAppendBackend implements PersistenceBackend {
  private readonly inner = new MemoryPersistenceBackend();
  private pending: Array<() => void> = [];
  read(id: string): Promise<string> { return this.inner.read(id); }
  append(id: string, line: string): Promise<void> {
    return new Promise((resolveAppend) => {
      this.pending.push(() => { void this.inner.append(id, line).then(resolveAppend); });
    });
  }
  listAgentIds(): Promise<string[]> { return this.inner.listAgentIds(); }
  remove(id: string): Promise<void> { return this.inner.remove(id); }
  flush(): void { const p = this.pending; this.pending = []; for (const run of p) run(); }
}

function agent(over: Partial<Agent> = {}): Agent {
  return {
    id: "a1",
    task: { id: "t1", description: "fix it", roleName: "Implementer" },
    role: { name: "Implementer", instructions: "do the thing", engine: { id: "copilot" }, autonomy: "auto-approve-safe" },
    state: "working",
    log: [],
    ...over,
  };
}

describe("serializeEvent / deserializeEvent round-trip", () => {
  it("round-trips agent-added", () => {
    const event: OrchestratorEvent = { kind: "agent-added", agent: agent() };
    const line = serializeEvent(event);
    expect(line.endsWith("\n")).toBe(true);
    expect(deserializeEvent(line.trim())).toEqual(event);
  });

  it("round-trips agent-event with output", () => {
    const event: OrchestratorEvent = { kind: "agent-event", agentId: "a1", event: { kind: "output", text: "hello world" } };
    expect(deserializeEvent(serializeEvent(event).trim())).toEqual(event);
  });

  it("round-trips agent-updated with summary and diff", () => {
    const event: OrchestratorEvent = {
      kind: "agent-updated",
      agent: agent({ state: "done", summary: "patched 3 tests", diff: { files: ["src/foo.ts"], patch: "- old\n+ new" } }),
    };
    expect(deserializeEvent(serializeEvent(event).trim())).toEqual(event);
  });

  it("returns null for malformed JSON", () => {
    expect(deserializeEvent("not json")).toBeNull();
  });

  it("returns null for a JSON object with no kind field", () => {
    expect(deserializeEvent('{"foo":1}')).toBeNull();
  });
});

describe("replayToRecords", () => {
  it("extracts the last known Agent snapshot per agent id", () => {
    const events: OrchestratorEvent[] = [
      { kind: "agent-added", agent: agent({ state: "preparing" }) },
      { kind: "agent-updated", agent: agent({ state: "working" }) },
      { kind: "agent-event", agentId: "a1", event: { kind: "output", text: "hi" } },
      { kind: "agent-updated", agent: agent({ state: "done", summary: "done" }) },
    ];
    const records = replayToRecords(events);
    expect(records).toHaveLength(1);
    expect(records[0]!.agent.state).toBe("done");
    expect(records[0]!.agent.summary).toBe("done");
  });

  it("carries workspacePath/workspaceBranch from the agent snapshot", () => {
    const events: OrchestratorEvent[] = [
      { kind: "agent-added", agent: agent({ state: "done", workspace: { agentId: "a1", path: "/wt/a1", branch: "agent/a1" } }) },
    ];
    const records = replayToRecords(events);
    expect(records[0]!.workspacePath).toBe("/wt/a1");
    expect(records[0]!.workspaceBranch).toBe("agent/a1");
  });

  it("handles multiple agents", () => {
    const events: OrchestratorEvent[] = [
      { kind: "agent-added", agent: agent({ id: "a1" }) },
      { kind: "agent-added", agent: agent({ id: "a2" }) },
    ];
    expect(replayToRecords(events).map((r) => r.agent.id).sort()).toEqual(["a1", "a2"]);
  });

  it("returns empty array for empty event list", () => {
    expect(replayToRecords([])).toEqual([]);
  });
});

describe("MemoryPersistenceBackend", () => {
  it("appends and reads lines", async () => {
    const backend = new MemoryPersistenceBackend();
    await backend.append("a1", "line1\n");
    await backend.append("a1", "line2\n");
    expect(await backend.read("a1")).toBe("line1\nline2\n");
  });

  it("lists agent ids", async () => {
    const backend = new MemoryPersistenceBackend();
    await backend.append("a1", "x\n");
    await backend.append("a2", "y\n");
    expect((await backend.listAgentIds()).sort()).toEqual(["a1", "a2"]);
  });

  it("returns empty string for an unknown agent", async () => {
    expect(await new MemoryPersistenceBackend().read("missing")).toBe("");
  });

  it("remove deletes the agent log", async () => {
    const backend = new MemoryPersistenceBackend();
    await backend.append("a1", "x\n");
    await backend.remove("a1");
    expect(await backend.listAgentIds()).toEqual([]);
  });
});

describe("EventLogger", () => {
  it("appends serialized events to the backend, routed by agent id", async () => {
    const backend = new MemoryPersistenceBackend();
    const logger = new EventLogger(backend);
    const event: OrchestratorEvent = { kind: "agent-added", agent: agent({ state: "preparing" }) };
    logger.write(event);
    await new Promise((r) => setTimeout(r, 0));
    expect(deserializeEvent((await backend.read("a1")).trim())).toEqual(event);
  });

  it("routes agent-event to the right agent log", async () => {
    const backend = new MemoryPersistenceBackend();
    const logger = new EventLogger(backend);
    logger.write({ kind: "agent-added", agent: agent({ id: "a2" }) });
    logger.write({ kind: "agent-event", agentId: "a2", event: { kind: "output", text: "hi" } });
    await new Promise((r) => setTimeout(r, 0));
    expect((await backend.read("a2")).trim().split("\n")).toHaveLength(2);
  });

  it("loadAll replays all agents and returns PersistedAgentRecord[]", async () => {
    const backend = new MemoryPersistenceBackend();
    await backend.append("a1", serializeEvent({ kind: "agent-added", agent: agent({ state: "working" }) }));
    await backend.append("a1", serializeEvent({ kind: "agent-updated", agent: agent({ state: "done", summary: "done" }) }));
    const records = await new EventLogger(backend).loadAll();
    expect(records).toHaveLength(1);
    expect(records[0]!.agent.state).toBe("done");
  });

  it("forget removes the agent log", async () => {
    const backend = new MemoryPersistenceBackend();
    await backend.append("a1", "x\n");
    await new EventLogger(backend).forget("a1");
    expect(await backend.listAgentIds()).toEqual([]);
  });

  it("loadAll skips a corrupt JSONL line but keeps the valid records (Issue 8/TG8)", async () => {
    const backend = new MemoryPersistenceBackend();
    // A valid line, then a garbage non-JSON line, then another valid line for the
    // same id. deserializeEvent returns null for the garbage; loadAll must drop
    // it (no throw) and still rebuild the record from the surviving events.
    await backend.append("a1", serializeEvent({ kind: "agent-added", agent: agent({ state: "working" }) }));
    await backend.append("a1", "this is not json at all\n");
    await backend.append("a1", serializeEvent({ kind: "agent-updated", agent: agent({ state: "done", summary: "finished" }) }));
    const records = await new EventLogger(backend).loadAll();
    // One record, reflecting the LAST valid state, corrupt line skipped.
    expect(records).toHaveLength(1);
    expect(records[0]!.agent.state).toBe("done");
    expect(records[0]!.agent.summary).toBe("finished");
  });
});

describe("EventLogger persist/forget ordering (Issue 8)", () => {
  it("forget runs after a pending write for the same id: no ghost log", async () => {
    const backend = new DeferredAppendBackend();
    const logger = new EventLogger(backend);
    // A late terminal write is submitted, then forget for the same id. With the
    // per-id chain, the write completes first, then forget removes the file.
    logger.write({ kind: "agent-updated", agent: agent({ state: "merged" }) });
    const forgotten = logger.forget("a1");
    // The chained append runs on a later microtask, so flush after a tick to let
    // the write get queued, then release it. forget's remove then runs after.
    await Promise.resolve();
    backend.flush();
    await forgotten;
    expect(await backend.listAgentIds()).toEqual([]);
    expect(await backend.read("a1")).toBe("");
  });

  it("a write arriving after forget for a terminal id does not recreate the file", async () => {
    const backend = new MemoryPersistenceBackend();
    const logger = new EventLogger(backend);
    await logger.forget("a1");
    logger.write({ kind: "agent-event", agentId: "a1", event: { kind: "output", text: "late" } });
    await new Promise((r) => setTimeout(r, 0));
    expect(await backend.listAgentIds()).toEqual([]);
    expect(await backend.read("a1")).toBe("");
  });
});

describe("isSafeAgentId / safeAgentFileName (Issue 30)", () => {
  it("accepts a normal id", () => {
    expect(isSafeAgentId("agent-1.2_x")).toBe(true);
    expect(safeAgentFileName("agent-1")).toBe("agent-1.jsonl");
  });
  it("rejects ids with a slash, backslash, or traversal", () => {
    expect(isSafeAgentId("a/b")).toBe(false);
    expect(isSafeAgentId("a\\b")).toBe(false);
    expect(isSafeAgentId("..")).toBe(false);
    expect(isSafeAgentId(".")).toBe(false);
    expect(isSafeAgentId("../../etc/passwd")).toBe(false);
    expect(isSafeAgentId("")).toBe(false);
  });
  it("safeAgentFileName throws on an unsafe id", () => {
    expect(() => safeAgentFileName("../escape")).toThrow();
    expect(() => safeAgentFileName("a/b")).toThrow();
  });
  it("listAgentIds-style filtering drops unsafe names", () => {
    const onDisk = ["good-1", "good_2", "..", "../evil", "a/b"];
    expect(onDisk.filter(isSafeAgentId)).toEqual(["good-1", "good_2"]);
  });
});
