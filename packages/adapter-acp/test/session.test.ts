import { describe, expect, it } from "vitest";
import type { AgentEvent } from "@maestro/core";
import { AcpSession } from "../src/session.js";
import {
  FakeAcpTransport,
  acpSessionUpdate,
  acpRequestPermission,
  acpSessionRequestPermission,
  acpTurnComplete,
  acpError,
  acpErrorResponse,
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

  // Issue 2 (A5/ACP5): slash-namespaced permission method and missing id.
  it("handles a session/request_permission frame as an approval with the correct id", async () => {
    const { transport, session } = makeSession("manual");
    const events = collect(session.events);

    transport.receive(acpSessionRequestPermission(11, "bash", "run npm test", { cmd: "npm test" }));
    await new Promise((r) => setImmediate(r));
    session.respond("11", "allow");
    transport.receive(acpTurnComplete("done"));
    transport.end();

    const result = await events;
    const approvalEvent = result.find((e) => e.kind === "approval");
    expect(approvalEvent).toMatchObject({ kind: "approval", id: "11" });
  });

  it("emits an error event (not a hung empty-id approval) for a permission request with no id", async () => {
    const { transport, session } = makeSession("manual");
    const events = collect(session.events);

    transport.receive(acpSessionRequestPermission(undefined, "bash", "run something"));
    transport.end();

    const result = await events;
    expect(result.find((e) => e.kind === "approval")).toBeUndefined();
    const errorEvent = result.find((e) => e.kind === "error");
    expect(errorEvent).toMatchObject({ kind: "error" });
    expect((errorEvent as { message: string }).message).toContain("missing id");
  });

  // Issue 3 (A3/ACP6): a JSON-RPC error response frame fails the session.
  it("fails the session when an initialize error response arrives", async () => {
    const { transport, session } = makeSession("manual");
    const events = collect(session.events);

    transport.receive(acpErrorResponse(1, -32603, "init failed"));
    transport.end();

    const result = await events;
    expect(result.at(-1)).toMatchObject({ kind: "error", message: "init failed" });
  });

  // Issue 13-acp (ACP1/ACP3/ACP4): unvalidated wire JSON.
  it("does not emit an output event when delta.text is not a string", async () => {
    const { transport, session } = makeSession();
    const events = collect(session.events);

    transport.receive({
      jsonrpc: "2.0",
      method: "session/update",
      params: { delta: { type: "text", text: 42 } },
    } as any);
    transport.receive(acpTurnComplete("done"));
    transport.end();

    const result = await events;
    const outputs = result.filter((e) => e.kind === "output");
    expect(outputs).toHaveLength(0);
  });

  it("omits args from the approval detail when args is not a plain object", async () => {
    const { transport, session } = makeSession("manual");
    const events = collect(session.events);

    transport.receive({
      jsonrpc: "2.0",
      id: 5,
      method: "requestPermission",
      params: { tool: "bash", description: "run", args: ["not", "an", "object"] },
    } as any);
    await new Promise((r) => setImmediate(r));
    session.respond("5", "deny");
    transport.receive(acpTurnComplete("done"));
    transport.end();

    const result = await events;
    const approvalEvent = result.find((e) => e.kind === "approval") as
      | { detail: Record<string, unknown> }
      | undefined;
    expect(approvalEvent).toBeDefined();
    expect(approvalEvent!.detail).not.toHaveProperty("args");
  });

  it("omits a non-string tool from the approval detail rather than coercing it", async () => {
    const { transport, session } = makeSession("manual");
    const events = collect(session.events);

    transport.receive({
      jsonrpc: "2.0",
      id: 6,
      method: "requestPermission",
      params: { tool: 99, description: "do a thing" },
    } as any);
    await new Promise((r) => setImmediate(r));
    session.respond("6", "deny");
    transport.receive(acpTurnComplete("done"));
    transport.end();

    const result = await events;
    const approvalEvent = result.find((e) => e.kind === "approval") as
      | { detail: Record<string, unknown> }
      | undefined;
    expect(approvalEvent).toBeDefined();
    expect(approvalEvent!.detail).not.toHaveProperty("tool");
    expect(approvalEvent!.detail).toMatchObject({ description: "do a thing" });
  });
});
