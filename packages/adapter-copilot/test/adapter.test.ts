import { describe, expect, it } from "vitest";
import type { AgentEvent, Role, Task, Workspace } from "@maestro/core";
import { CopilotAdapter } from "../src/adapter.js";
import type { ChildHandle, SpawnFn } from "../src/types.js";
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

  it("keeps default (text) capabilities reporting no structured events", () => {
    const text = new CopilotAdapter({ spawn: makeFakeSpawn().fn });
    const explicitText = new CopilotAdapter({ spawn: makeFakeSpawn().fn, outputFormat: "text" });
    expect(text.capabilities.structuredEvents).toBe(false);
    expect(explicitText.capabilities.structuredEvents).toBe(false);
  });

  it("advertises structured events only when constructed in json mode, never approvals", () => {
    const json = new CopilotAdapter({ spawn: makeFakeSpawn().fn, outputFormat: "json" });
    expect(json.capabilities).toEqual({
      streaming: true,
      structuredEvents: true,
      approvals: false,
      steerable: false,
    });
  });

  it("spawns with --output-format json only in json mode", () => {
    const fakeText = makeFakeSpawn();
    new CopilotAdapter({ spawn: fakeText.fn }).start(task, workspace, role);
    expect(fakeText.lastArgs()).not.toContain("--output-format");

    const fakeJson = makeFakeSpawn();
    new CopilotAdapter({ spawn: fakeJson.fn, outputFormat: "json" }).start(task, workspace, role);
    expect(fakeJson.lastArgs()).toContain("--output-format");
    expect(fakeJson.lastArgs()).toContain("json");
  });

  it("parses structured JSON output into formatted events in json mode", async () => {
    const fake = makeFakeSpawn();
    const adapter = new CopilotAdapter({ spawn: fake.fn, outputFormat: "json" });
    const session = adapter.start(task, workspace, role);
    const events = collect(session.events);

    fake.child()!.out(JSON.stringify({ type: "tool", name: "edit", input: { path: "cache.ts" } }) + "\n");
    fake.child()!.close(0);

    const result = await events;
    expect(result.filter((e) => e.kind === "output")).toEqual([
      { kind: "output", text: "▸ edit: cache.ts" },
    ]);
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
    const spawnArgs = fake.lastArgs()!;
    expect(spawnArgs[0]).toBe("-C");
    expect(spawnArgs[1]).toBe("/tmp/wt/a1");
    expect(spawnArgs[2]).toBe("-p");
    expect(spawnArgs[3]).toContain("add caching");
    expect(spawnArgs[3]).toContain("# Instructions");
    expect(spawnArgs[4]).toBe("-s");
    expect(spawnArgs[5]).toBe("--no-ask-user");
    expect(spawnArgs[6]).toBe("--allow-all");
    expect(spawnArgs[7]).toBe("--model");
    expect(spawnArgs[8]).toBe("claude-sonnet-4.6");

    fake.child()!.out("edited cache.ts\n");
    fake.child()!.close(0);

    // The line's terminating newline is preserved on the output event.
    expect(await events).toEqual([
      { kind: "output", text: "edited cache.ts\n" },
      { kind: "done", summary: "edited cache.ts" },
    ]);
  });

  it("filters undefined-valued env keys but forwards all defined ones", () => {
    const fake = makeFakeSpawn();
    const adapter = new CopilotAdapter({
      spawn: fake.fn,
      env: { GH_TOKEN: "abc", PATH: "/usr/bin", UNSET: undefined },
    });

    adapter.start(task, workspace, role);

    const env = fake.lastEnv()!;
    expect(env.GH_TOKEN).toBe("abc");
    expect(env.PATH).toBe("/usr/bin");
    expect("UNSET" in env).toBe(false);
  });

  it("throws a clear error when the spawned child has no piped stdio", () => {
    // A child whose stdout was not piped (one `stdio` edit away). Node types
    // stdout/stderr as `Readable | null`; the adapter must not launder that.
    const badSpawn: SpawnFn = () =>
      ({
        stdout: null,
        stderr: null,
        on: () => {},
        kill: () => {},
      }) as unknown as ChildHandle;
    const adapter = new CopilotAdapter({ spawn: badSpawn });
    expect(() => adapter.start(task, workspace, role)).toThrow(/stdio streams not piped/);
  });
});
