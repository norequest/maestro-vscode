import { describe, expect, it } from "vitest";
import { FakeEngineAdapter } from "../src/fake-adapter.js";
import type { AgentEvent, Task, Workspace } from "../src/types.js";

const task: Task = { id: "t1", description: "do it", roleName: "Impl" };
const workspace: Workspace = { agentId: "a1", path: "/tmp/a1", branch: "agent/a1" };

async function collect(events: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const e of events) out.push(e);
  return out;
}

describe("FakeEngineAdapter", () => {
  it("reports configured capabilities and health", async () => {
    const adapter = new FakeEngineAdapter({
      script: [],
      capabilities: { approvals: false },
    });
    expect(adapter.capabilities).toEqual({
      streaming: true,
      structuredEvents: true,
      approvals: false,
      steerable: true,
    });
    expect(await adapter.health()).toEqual({ ok: true });
  });

  it("reports unhealthy when configured", async () => {
    const adapter = new FakeEngineAdapter({ script: [], healthy: false });
    expect(await adapter.health()).toEqual({ ok: false, detail: "fake unhealthy" });
  });

  it("emits the scripted events in order then ends", async () => {
    const adapter = new FakeEngineAdapter({
      script: [
        { kind: "output", text: "hello" },
        { kind: "done", summary: "ok", diff: { files: [], patch: "" } },
      ],
    });
    const session = adapter.start(task, workspace);
    expect(await collect(session.events)).toEqual([
      { kind: "output", text: "hello" },
      { kind: "done", summary: "ok", diff: { files: [], patch: "" } },
    ]);
  });

  it("pauses on an approval event until respond() is called", async () => {
    const adapter = new FakeEngineAdapter({
      script: [
        { kind: "approval", id: "ap1", detail: "run npm test" },
        { kind: "done", summary: "ok", diff: { files: [], patch: "" } },
      ],
    });
    const session = adapter.start(task, workspace);
    const iterator = session.events[Symbol.asyncIterator]();

    const first = await iterator.next();
    expect(first.value).toEqual({ kind: "approval", id: "ap1", detail: "run npm test" });

    let resolved = false;
    const secondPromise = iterator.next().then((r) => {
      resolved = true;
      return r;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);

    session.respond("ap1", "allow");
    const second = await secondPromise;
    expect(second.value).toEqual({ kind: "done", summary: "ok", diff: { files: [], patch: "" } });
    expect(session.decisions).toEqual([{ id: "ap1", decision: "allow" }]);
  });

  it("records send() calls", async () => {
    const adapter = new FakeEngineAdapter({ script: [] });
    const session = adapter.start(task, workspace);
    session.send("try harder");
    expect(session.sent).toEqual(["try harder"]);
  });

  it("stop() ends the stream early", async () => {
    const adapter = new FakeEngineAdapter({
      script: [{ kind: "approval", id: "ap1", detail: null }],
    });
    const session = adapter.start(task, workspace);
    const iterator = session.events[Symbol.asyncIterator]();
    await iterator.next(); // the approval event
    session.stop();
    const ended = await iterator.next();
    expect(ended.done).toBe(true);
    expect(session.stopped).toBe(true);
  });
});
