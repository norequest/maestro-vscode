import { describe, expect, it } from "vitest";
import type { AgentEvent, Role, Task, Workspace } from "@hallucinate/core";
import { CopilotAdapter } from "../src/adapter.js";
import { makeFakeSpawn } from "./fake-spawn.js";

const role: Role = {
  name: "Fleet Lead",
  instructions: "Coordinate the scribes.",
  engine: { id: "copilot", model: "claude-sonnet-4.6" },
  autonomy: "yolo",
};
// In fleet mode the extension supplies the leading "/fleet ..." text and roster
// as task.description; the adapter passes it through -p VERBATIM.
const task: Task = {
  id: "t1",
  description: "/fleet write the docs with scribe-alpha and scribe-beta",
  roleName: "Fleet Lead",
};
const workspace: Workspace = { agentId: "a1", path: "/tmp/wt/a1", branch: "agent/a1" };

async function collect(events: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const e of events) out.push(e);
  return out;
}

function envelope(type: string, data: Record<string, unknown>): string {
  return JSON.stringify({ type, data }) + "\n";
}

describe("CopilotAdapter fleet mode", () => {
  it("advertises structured-events capabilities in fleet mode", () => {
    const adapter = new CopilotAdapter({ spawn: makeFakeSpawn().fn, fleet: true });
    expect(adapter.capabilities).toEqual({
      streaming: true,
      structuredEvents: true,
      approvals: false,
      steerable: false,
    });
  });

  it("builds fleet argv: NO --agent, -p verbatim, json + no-color, -C path", () => {
    const fake = makeFakeSpawn();
    new CopilotAdapter({ spawn: fake.fn, fleet: true }).start(task, workspace, role);

    const args = fake.lastArgs()!;
    expect(args[0]).toBe("-C");
    expect(args[1]).toBe("/tmp/wt/a1");
    expect(args[2]).toBe("-p");
    // The description is passed VERBATIM (no /fleet prepend, no preamble).
    expect(args[3]).toBe("/fleet write the docs with scribe-alpha and scribe-beta");
    // Fleet mode must NOT pass --agent: Copilot's built-in dispatcher owns the
    // `task` dispatch tool; a custom lead agent teaches a dead ```delegate
    // convention and never dispatches.
    expect(args).not.toContain("--agent");
    expect(args).not.toContain("fleet-lead");
    expect(args).toContain("--no-ask-user");
    expect(args).toContain("--allow-all");
    expect(args).toContain("--output-format");
    expect(args).toContain("json");
    expect(args).toContain("--no-color");
    // Fleet mode must NOT pass -s (silent), which would suppress the JSON stream.
    expect(args).not.toContain("-s");
    // Model still forwarded.
    expect(args.slice(-2)).toEqual(["--model", "claude-sonnet-4.6"]);
    // The worktree is the spawn cwd.
    expect(fake.lastCwd()).toBe("/tmp/wt/a1");
  });

  it("parses the fleet JSONL stream into sub-agent events ending in done", async () => {
    const fake = makeFakeSpawn();
    const adapter = new CopilotAdapter({ spawn: fake.fn, fleet: true });
    const session = adapter.start(task, workspace, role);
    const events = collect(session.events);

    const child = fake.child()!;
    child.out(envelope("assistant.message", { text: "Delegating to two scribes." }));
    child.out(
      envelope("subagent.started", {
        toolCallId: "call-alpha",
        agentName: "scribe-alpha",
        agentDescription: "drafts the intro",
      }),
    );
    child.out(envelope("assistant.message", { text: "On it.", parentToolCallId: "call-alpha" }));
    child.out(
      envelope("tool.execution_start", {
        toolName: "create",
        arguments: { path: "docs/intro.md" },
        toolCallId: "t-a1",
        parentToolCallId: "call-alpha",
      }),
    );
    child.out(envelope("subagent.completed", { toolCallId: "call-alpha" }));
    child.out(envelope("result", { exitCode: 0, usage: { codeChanges: { filesModified: 1 } } }));
    child.close(0);

    expect(await events).toEqual([
      { kind: "output", text: "Delegating to two scribes." },
      { kind: "subagent-started", callId: "call-alpha", name: "scribe-alpha", description: "drafts the intro" },
      { kind: "subagent-output", callId: "call-alpha", text: "On it." },
      { kind: "subagent-output", callId: "call-alpha", text: "▸ create: docs/intro.md" },
      { kind: "subagent-done", callId: "call-alpha" },
      { kind: "done", summary: "fleet run complete, 1 file modified" },
    ]);
  });

  it("does not double the terminal event when result precedes close", async () => {
    const fake = makeFakeSpawn();
    const session = new CopilotAdapter({ spawn: fake.fn, fleet: true }).start(task, workspace, role);
    const events = collect(session.events);

    const child = fake.child()!;
    child.out(envelope("result", { exitCode: 0, usage: {} }));
    child.close(0);

    const result = await events;
    expect(result).toEqual([{ kind: "done", summary: "fleet run complete" }]);
    // Exactly one terminal event, sourced from the result line.
    expect(result.filter((e) => e.kind === "done" || e.kind === "error")).toHaveLength(1);
  });

  it("synthesizes a terminal event on close when no result line was seen", async () => {
    const fake = makeFakeSpawn();
    const session = new CopilotAdapter({ spawn: fake.fn, fleet: true }).start(task, workspace, role);
    const events = collect(session.events);

    const child = fake.child()!;
    child.out(envelope("assistant.message", { text: "Starting up." }));
    child.close(1); // crashed before emitting a result

    const result = await events;
    expect(result.at(-1)).toMatchObject({ kind: "error" });
  });
});
