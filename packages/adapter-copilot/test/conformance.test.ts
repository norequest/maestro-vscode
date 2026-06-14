import { describe, expect, it } from "vitest";
import { FakeWorkspaceProvider, Orchestrator } from "@maestro/core";
import type { Role } from "@maestro/core";
import { CopilotAdapter } from "../src/adapter.js";
import { makeFakeSpawn } from "./fake-spawn.js";

const role: Role = {
  name: "Implementer",
  instructions: "build it",
  engine: { id: "copilot", model: "claude-sonnet-4.6" },
  autonomy: "yolo",
};

function waitForState(orch: Orchestrator, agentId: string, target: string): Promise<void> {
  return new Promise((resolve) => {
    const check = () => {
      if (orch.getAgent(agentId)?.state === target) resolve();
    };
    orch.on(check);
    check();
  });
}

describe("CopilotAdapter conformance via Orchestrator", () => {
  it("spawns, streams, and reaches done through the orchestrator", async () => {
    const fake = makeFakeSpawn();
    const orch = new Orchestrator({ maxParallelAgents: 1 }, new FakeWorkspaceProvider());
    orch.registerRole(role);
    orch.registerAdapter(new CopilotAdapter({ spawn: fake.fn }));

    const agent = orch.spawn("Implementer", "add a feature");
    await waitForState(orch, agent.id, "working");

    fake.child()!.out("implementing\n");
    fake.child()!.close(0);

    await waitForState(orch, agent.id, "done");
    const final = orch.getAgent(agent.id)!;
    expect(final.state).toBe("done");
    expect(final.log.map((e) => e.kind)).toEqual(["output", "done"]);
  });

  it("reaches error on a non-zero exit", async () => {
    const fake = makeFakeSpawn();
    const orch = new Orchestrator({ maxParallelAgents: 1 }, new FakeWorkspaceProvider());
    orch.registerRole(role);
    orch.registerAdapter(new CopilotAdapter({ spawn: fake.fn }));

    const agent = orch.spawn("Implementer", "task");
    await waitForState(orch, agent.id, "working");

    fake.child()!.close(1);
    await waitForState(orch, agent.id, "error");
    expect(orch.getAgent(agent.id)!.error).toContain("code 1");
  });
});
