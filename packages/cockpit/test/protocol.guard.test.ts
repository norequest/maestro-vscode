import { describe, it, expect } from "vitest";
import { isWebviewMessage } from "../src/protocol.js";

describe("isWebviewMessage runtime guard", () => {
  it("accepts a valid ready message", () => {
    expect(isWebviewMessage({ type: "ready" })).toBe(true);
  });

  it("accepts the bare new-task message (the board funnel trigger)", () => {
    expect(isWebviewMessage({ type: "new-task" })).toBe(true);
  });

  it("accepts the bare clear-done-lane message (no agentId)", () => {
    expect(isWebviewMessage({ type: "clear-done-lane" })).toBe(true);
  });

  it("accepts a valid spawn message", () => {
    expect(isWebviewMessage({ type: "spawn", roleName: "Implementer", description: "fix it" })).toBe(true);
  });

  it("accepts a valid steer message", () => {
    expect(isWebviewMessage({ type: "steer", agentId: "a1", input: "go left" })).toBe(true);
  });

  it("accepts a valid approve message", () => {
    expect(isWebviewMessage({ type: "approve", agentId: "a1", approvalId: "r1", decision: "allow" })).toBe(true);
    expect(isWebviewMessage({ type: "approve", agentId: "a1", approvalId: "r1", decision: "deny" })).toBe(true);
  });

  it("accepts a valid sendBack message", () => {
    expect(isWebviewMessage({ type: "sendBack", agentId: "a1", feedback: "again" })).toBe(true);
  });

  it("accepts simple agentId-only messages", () => {
    for (const type of ["focus", "stop", "merge", "discard", "resolve-conflict", "finish-merge", "create-pr", "retry-cleanup"]) {
      expect(isWebviewMessage({ type, agentId: "a1" })).toBe(true);
    }
  });

  it("rejects a non-object", () => {
    expect(isWebviewMessage(null)).toBe(false);
    expect(isWebviewMessage(undefined)).toBe(false);
    expect(isWebviewMessage("merge")).toBe(false);
    expect(isWebviewMessage(42)).toBe(false);
  });

  it("rejects an unknown type", () => {
    expect(isWebviewMessage({ type: "explode", agentId: "a1" })).toBe(false);
  });

  it("rejects a missing or non-string type", () => {
    expect(isWebviewMessage({ agentId: "a1" })).toBe(false);
    expect(isWebviewMessage({ type: 7, agentId: "a1" })).toBe(false);
  });

  it("rejects an agentId message with a missing agentId", () => {
    expect(isWebviewMessage({ type: "merge" })).toBe(false);
    expect(isWebviewMessage({ type: "stop", agentId: 5 })).toBe(false);
  });

  it("rejects a steer with a non-string input", () => {
    expect(isWebviewMessage({ type: "steer", agentId: "a1" })).toBe(false);
    expect(isWebviewMessage({ type: "steer", agentId: "a1", input: 9 })).toBe(false);
  });

  it("rejects a spawn with a missing field", () => {
    expect(isWebviewMessage({ type: "spawn", roleName: "Implementer" })).toBe(false);
  });

  it("accepts a spawn with an optional goal string", () => {
    expect(isWebviewMessage({ type: "spawn", roleName: "r", description: "d", goal: "g" })).toBe(true);
  });

  it("rejects a spawn where goal is present but not a string", () => {
    expect(isWebviewMessage({ type: "spawn", roleName: "r", description: "d", goal: 123 })).toBe(false);
  });

  it("rejects an approve with a bad decision", () => {
    expect(isWebviewMessage({ type: "approve", agentId: "a1", approvalId: "r1", decision: "maybe" })).toBe(false);
  });
});

describe("isWebviewMessage · dispatch", () => {
  it("accepts a preset dispatch (roleName + description)", () => {
    expect(isWebviewMessage({ type: "dispatch", roleName: "Test Author", description: "write tests" })).toBe(true);
  });
  it("accepts an ad-hoc dispatch (newRoleName + description) with engine + goal", () => {
    expect(isWebviewMessage({ type: "dispatch", newRoleName: "Doc Writer", engineId: "copilot", model: "gpt-5", goal: "so the API is documented", description: "document the public API" })).toBe(true);
  });
  it("requires a string description and rejects wrong-typed fields", () => {
    expect(isWebviewMessage({ type: "dispatch", roleName: "X" })).toBe(false);
    expect(isWebviewMessage({ type: "dispatch", description: 7 })).toBe(false);
    expect(isWebviewMessage({ type: "dispatch", description: "ok", engineId: 9 })).toBe(false);
  });
  it("dispatch carries no agentId (validates without one)", () => {
    expect(isWebviewMessage({ type: "dispatch", roleName: "X", description: "y" })).toBe(true);
  });
});

describe("isWebviewMessage · open-review", () => {
  it("accepts a valid open-review with agentId", () => {
    expect(isWebviewMessage({ type: "open-review", agentId: "a1" })).toBe(true);
  });
  it("rejects open-review missing agentId", () => {
    expect(isWebviewMessage({ type: "open-review" })).toBe(false);
  });
  it("rejects open-review with non-string agentId", () => {
    expect(isWebviewMessage({ type: "open-review", agentId: 42 })).toBe(false);
  });
});
