import { describe, expect, it } from "vitest";
import type { Role, Task, Workspace } from "@maestro/core";
import { AcpAdapter } from "../src/adapter.js";
import { FakeAcpTransport, acpSessionUpdate, acpTurnComplete } from "./fake-transport.js";
import type { AcpTransportFn } from "../src/types.js";

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

  it("health() resolves to a HealthStatus shape", async () => {
    const { fn } = makeTransportFn();
    const adapter = new AcpAdapter({ transportFn: fn });
    const h = await adapter.health();
    expect(typeof h.ok).toBe("boolean");
  });

  it("start() creates an AcpSession, sends initialize + user_turn, returns session", async () => {
    const { fn, transport } = makeTransportFn();
    const adapter = new AcpAdapter({ transportFn: fn, command: "gemini" });

    const session = adapter.start(task, workspace, role);
    expect(session).toBeDefined();

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

  // Issue 32-acp: undefined env values are filtered out, defined ones forwarded.
  it("filters out env keys whose value is undefined while forwarding defined ones", () => {
    let capturedEnv: NodeJS.ProcessEnv | undefined;
    const fn: AcpTransportFn = (_cmd, _args, opts) => {
      capturedEnv = opts.env;
      return new FakeAcpTransport();
    };
    const adapter = new AcpAdapter({
      transportFn: fn,
      command: "gemini",
      env: { KEEP: "yes", DROP: undefined, TOKEN: "abc" },
    });
    adapter.start(task, workspace, role);
    expect(capturedEnv).toBeDefined();
    expect(capturedEnv).not.toHaveProperty("DROP");
    expect(capturedEnv!["KEEP"]).toBe("yes");
    expect(capturedEnv!["TOKEN"]).toBe("abc");
  });
});
