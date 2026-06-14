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
    await new Promise((r) => setImmediate(r));
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
      detail: { tool: "bash", description: "run npm test", args: { cmd: "npm test" } },
    });
  });

  it("auto-approves requestPermission when autonomy is yolo", async () => {
    const { transport, session } = makeSession("yolo");
    const events = collect(session.events);

    transport.receive(acpRequestPermission(3, "write_file", "write index.ts"));
    transport.receive(acpTurnComplete("done"));
    transport.end();

    const result = await events;
    expect(result.find((e) => e.kind === "approval")).toBeUndefined();
    const response = transport.sent.find((m) => m.method === "permission_response");
    expect(response).toBeDefined();
    expect((response!.params as any).granted).toBe(true);
  });

  it("auto-approves safe tools when autonomy is auto-approve-safe", async () => {
    const { transport, session } = makeSession("auto-approve-safe");
    const events = collect(session.events);

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
    expect(result.some((e) => e.kind === "done" || e.kind === "error")).toBe(false);
  });

  it("ignores incoming messages after stop()", async () => {
    const { transport, session } = makeSession();
    const events = collect(session.events);

    session.stop();
    transport.receive(acpTurnComplete("late"));
    const result = await events;
    expect(result).toHaveLength(0);
  });

  it("sends initialize on the transport when start() is called", async () => {
    const { transport, session } = makeSession("manual");
    session.start({ description: "fix the bug", id: "t1", roleName: "Implementer" });
    transport.end();
    const events = collect(session.events);
    await events;

    const init = transport.sent.find((m) => m.method === "initialize");
    expect(init).toBeDefined();
    expect((init!.params as any).permissionMode).toBe("ask");
  });
});
