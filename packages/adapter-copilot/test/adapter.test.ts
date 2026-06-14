import { describe, expect, it } from "vitest";
import type { AgentEvent, Role, Task, Workspace } from "@maestro/core";
import { CopilotAdapter } from "../src/adapter.js";
import { makeFakeSpawn } from "./fake-spawn.js";

const role: Role = {
  name: "Implementer",
  instructions: "build it",
  engine: { id: "copilot", model: "claude-sonnet-4.6" },
  autonomy: "yolo",
};
const task: Task = { id: "t1", description: "add caching", roleName: "Implementer" };
const workspace: Workspace = { agentId: "a1", path: "/tmp/wt/a1", branch: "agent/a1" };

async function collect(events: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const e of events) out.push(e);
  return out;
}

describe("CopilotAdapter", () => {
  it("exposes id and capabilities", () => {
    const adapter = new CopilotAdapter({ spawn: makeFakeSpawn().fn });
    expect(adapter.id).toBe("copilot");
    expect(adapter.capabilities).toEqual({
      streaming: true,
      structuredEvents: false,
      approvals: false,
      steerable: false,
    });
  });

  it("health reflects the injected env", async () => {
    expect((await new CopilotAdapter({ env: { GH_TOKEN: "x" } }).health()).ok).toBe(true);
    expect((await new CopilotAdapter({ env: {} }).health()).ok).toBe(false);
  });

  it("spawns copilot with the worktree cwd and correct argv, and runs to done", async () => {
    const fake = makeFakeSpawn();
    const adapter = new CopilotAdapter({ spawn: fake.fn });

    const session = adapter.start(task, workspace, role);
    const events = collect(session.events);

    expect(fake.lastCwd()).toBe("/tmp/wt/a1");
    expect(fake.lastArgs()).toEqual([
      "-C",
      "/tmp/wt/a1",
      "-p",
      "add caching",
      "-s",
      "--no-ask-user",
      "--allow-all",
      "--model",
      "claude-sonnet-4.6",
    ]);

    fake.child()!.out("edited cache.ts\n");
    fake.child()!.close(0);

    expect(await events).toEqual([
      { kind: "output", text: "edited cache.ts\n" },
      { kind: "done", summary: "edited cache.ts" },
    ]);
  });
});
