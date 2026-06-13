import { describe, expect, it } from "vitest";
import { Orchestrator } from "../src/orchestrator.js";
import { FakeEngineAdapter } from "../src/fake-adapter.js";
import { FakeWorkspaceProvider } from "../src/workspace.js";
import type { OrchestratorEvent, Role } from "../src/types.js";

const role: Role = {
  name: "Implementer",
  instructions: "build it",
  engine: { id: "fake" },
  autonomy: "manual",
};

function deterministicIds(): () => string {
  let n = 0;
  return () => `agent-${++n}`;
}

/** Resolves once the agent reaches a terminal-ish target state. */
function waitForState(
  orch: Orchestrator,
  agentId: string,
  target: string,
): Promise<void> {
  return new Promise((resolve) => {
    const check = () => {
      if (orch.getAgent(agentId)?.state === target) resolve();
    };
    orch.on(check);
    check();
  });
}

describe("Orchestrator happy path", () => {
  it("spawns an agent, runs it, and reaches done with summary and diff", async () => {
    const workspaces = new FakeWorkspaceProvider();
    const orch = new Orchestrator({ maxParallelAgents: 2 }, workspaces, deterministicIds());
    orch.registerRole(role);
    orch.registerAdapter(
      new FakeEngineAdapter({
        script: [
          { kind: "output", text: "writing code" },
          { kind: "done", summary: "added rate limiting", diff: { files: ["a.ts"], patch: "diff" } },
        ],
      }),
    );

    const events: OrchestratorEvent[] = [];
    orch.on((e) => events.push(e));

    const agent = orch.spawn("Implementer", "add rate limiting");
    expect(agent.state).toBe("preparing");

    await waitForState(orch, agent.id, "done");

    const final = orch.getAgent(agent.id)!;
    expect(final.state).toBe("done");
    expect(final.summary).toBe("added rate limiting");
    expect(final.diff).toEqual({ files: ["a.ts"], patch: "diff" });
    expect(final.log.map((e) => e.kind)).toEqual(["output", "done"]);
    expect(workspaces.created).toEqual([agent.id]);
    expect(events[0]).toEqual({ kind: "agent-added", agent: expect.objectContaining({ id: agent.id }) });
  });

  it("throws when spawning an unknown role", () => {
    const orch = new Orchestrator({ maxParallelAgents: 1 }, new FakeWorkspaceProvider());
    expect(() => orch.spawn("Nope", "x")).toThrow("Unknown role: Nope");
  });

  it("passes the role (instructions/model/autonomy) to the engine adapter", async () => {
    const orch = new Orchestrator({ maxParallelAgents: 1 }, new FakeWorkspaceProvider());
    orch.registerRole(role);
    const adapter = new FakeEngineAdapter({
      script: [{ kind: "done", summary: "ok", diff: { files: [], patch: "" } }],
    });
    orch.registerAdapter(adapter);

    const agent = orch.spawn("Implementer", "task");
    await waitForState(orch, agent.id, "done");

    expect(adapter.lastRole).toEqual(role);
  });

  it("accepts a done event with no diff", async () => {
    const orch = new Orchestrator({ maxParallelAgents: 1 }, new FakeWorkspaceProvider());
    orch.registerRole(role);
    orch.registerAdapter(
      new FakeEngineAdapter({ script: [{ kind: "done", summary: "no diff here" }] }),
    );

    const agent = orch.spawn("Implementer", "task");
    await waitForState(orch, agent.id, "done");

    const final = orch.getAgent(agent.id)!;
    expect(final.state).toBe("done");
    expect(final.summary).toBe("no diff here");
    expect(final.diff).toBeUndefined();
  });
});
