import { describe, expect, it } from "vitest";
import {
  parseAcpLine,
  buildInitialize,
  buildPermissionResponse,
  buildUserTurn,
} from "../src/messages.js";

describe("parseAcpLine", () => {
  it("returns null for empty or whitespace lines", () => {
    expect(parseAcpLine("")).toBeNull();
    expect(parseAcpLine("  \n")).toBeNull();
  });

  it("returns null for non-JSON lines", () => {
    expect(parseAcpLine("not json")).toBeNull();
  });

  it("parses a session/update notification", () => {
    const line = JSON.stringify({
      jsonrpc: "2.0",
      method: "session/update",
      params: { delta: { type: "text", text: "working on it" } },
    });
    const msg = parseAcpLine(line);
    expect(msg).not.toBeNull();
    expect(msg!.method).toBe("session/update");
  });

  it("parses a requestPermission notification", () => {
    const line = JSON.stringify({
      jsonrpc: "2.0",
      id: 42,
      method: "requestPermission",
      params: { tool: "bash", description: "run npm test", args: { cmd: "npm test" } },
    });
    const msg = parseAcpLine(line);
    expect(msg).not.toBeNull();
    expect(msg!.method).toBe("requestPermission");
    expect(msg!.id).toBe(42);
  });

  it("parses a turn/complete notification", () => {
    const line = JSON.stringify({
      jsonrpc: "2.0",
      method: "turn/complete",
      params: { summary: "all done" },
    });
    const msg = parseAcpLine(line);
    expect(msg!.method).toBe("turn/complete");
  });

  it("parses an error notification", () => {
    const line = JSON.stringify({
      jsonrpc: "2.0",
      method: "error",
      params: { message: "something went wrong" },
    });
    expect(parseAcpLine(line)!.method).toBe("error");
  });
});

describe("buildInitialize", () => {
  it("builds a valid ACP initialize request", () => {
    const msg = buildInitialize({ instructions: "be helpful", permissionMode: "ask" });
    expect(msg.method).toBe("initialize");
    expect((msg.params as any).permissionMode).toBe("ask");
    expect((msg.params as any).systemPrompt).toBe("be helpful");
  });
});

describe("buildPermissionResponse", () => {
  it("grants when decision is allow", () => {
    const msg = buildPermissionResponse("42", "allow");
    expect(msg.method).toBe("permission_response");
    expect((msg.params as any).id).toBe("42");
    expect((msg.params as any).granted).toBe(true);
  });

  it("denies when decision is deny", () => {
    const msg = buildPermissionResponse("42", "deny");
    expect((msg.params as any).granted).toBe(false);
  });
});

describe("buildUserTurn", () => {
  it("builds a user_turn notification with the given content", () => {
    const msg = buildUserTurn("please fix the lint error");
    expect(msg.method).toBe("user_turn");
    expect((msg.params as any).content).toBe("please fix the lint error");
  });
});
