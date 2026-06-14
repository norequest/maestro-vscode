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
    let unsub: (() => void) | undefined;
    const check = () => {
      if (orch.getAgent(agentId)?.state === target) {
        unsub?.();
        resolve();
      }
    };
    unsub = orch.on(check);
    check();
  });
}

function waitForTerminal(orch: Orchestrator, agentId: string): Promise<void> {
  return new Promise((resolve) => {
    let unsub: (() => void) | undefined;
    const check = () => {
      const a = orch.getAgent(agentId);
      if (a && isTerminalState(a.state)) {
        unsub?.();
        resolve();
      }
    };
    unsub = orch.on(check);
    check();
  });
}

describe("parallel ACP agents through Orchestrator", () => {
  it("runs 3 agents concurrently when maxParallelAgents=3", async () => {
    const { orch, transports } = makeOrchWithFakeAcp(3);

    const a1 = orch.spawn("Worker", "task one");
    const a2 = orch.spawn("Worker", "task two");
    const a3 = orch.spawn("Worker", "task three");

    await Promise.all([
      waitForState(orch, a1.id, "working"),
      waitForState(orch, a2.id, "working"),
      waitForState(orch, a3.id, "working"),
    ]);

    expect(transports()).toHaveLength(3);

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
    const a4 = orch.spawn("Worker", "task four");

    await Promise.all([
      waitForState(orch, a1.id, "working"),
      waitForState(orch, a2.id, "working"),
      waitForState(orch, a3.id, "working"),
    ]);

    expect(orch.getAgent(a4.id)!.state).toBe("preparing");
    expect(transports()).toHaveLength(3);

    const ts = transports();
    ts[0]!.receive(acpTurnComplete("a1 done"));
    ts[0]!.end();
    await waitForTerminal(orch, a1.id);

    await new Promise((r) => setImmediate(r));
    await waitForState(orch, a4.id, "working");
    expect(transports()).toHaveLength(4);

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

    ts[0]!.receive(acpTurnComplete("a1 done"));
    ts[0]!.end();
    await waitForTerminal(orch, a1.id);

    expect(orch.getAgent(a2.id)!.state).toBe("working");

    ts[1]!.receive(acpTurnComplete("a2 done"));
    ts[1]!.end();
    await waitForTerminal(orch, a2.id);
  });
});
