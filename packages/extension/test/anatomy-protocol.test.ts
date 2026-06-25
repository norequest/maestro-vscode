import { describe, expect, it } from "vitest";
import { isAnatomyMessage } from "../src/anatomy-protocol.js";

describe("isAnatomyMessage", () => {
  // ─── accepts well-formed variants ─────────────────────────────────────────

  it("accepts open-anatomy", () => {
    expect(isAnatomyMessage({ type: "open-anatomy", roleName: "Tester" })).toBe(true);
  });

  it("accepts role-set-soul", () => {
    expect(
      isAnatomyMessage({ type: "role-set-soul", roleName: "Tester", soul: "You are careful." })
    ).toBe(true);
  });

  it("accepts role-set-instructions", () => {
    expect(
      isAnatomyMessage({ type: "role-set-instructions", roleName: "Tester", instructions: "Run tests." })
    ).toBe(true);
  });

  it("accepts role-set-tools with an object tools value", () => {
    expect(
      isAnatomyMessage({
        type: "role-set-tools",
        roleName: "Tester",
        tools: { builtins: { read: ["Read"] } },
      })
    ).toBe(true);
  });

  it("accepts role-set-engine with engineId only", () => {
    expect(
      isAnatomyMessage({ type: "role-set-engine", roleName: "Tester", engineId: "copilot" })
    ).toBe(true);
  });

  it("accepts role-set-engine with optional model", () => {
    expect(
      isAnatomyMessage({
        type: "role-set-engine",
        roleName: "Tester",
        engineId: "copilot",
        model: "gpt-4o",
      })
    ).toBe(true);
  });

  it("accepts role-set-autonomy with manual", () => {
    expect(
      isAnatomyMessage({ type: "role-set-autonomy", roleName: "Tester", autonomy: "manual" })
    ).toBe(true);
  });

  it("accepts role-set-autonomy with auto-approve-safe", () => {
    expect(
      isAnatomyMessage({
        type: "role-set-autonomy",
        roleName: "Tester",
        autonomy: "auto-approve-safe",
      })
    ).toBe(true);
  });

  it("accepts role-set-autonomy with yolo", () => {
    expect(
      isAnatomyMessage({ type: "role-set-autonomy", roleName: "Tester", autonomy: "yolo" })
    ).toBe(true);
  });

  it("accepts grant-tool with write true", () => {
    expect(
      isAnatomyMessage({ type: "grant-tool", roleName: "Tester", tool: "Git", write: true })
    ).toBe(true);
  });

  it("accepts grant-tool with write false", () => {
    expect(
      isAnatomyMessage({ type: "grant-tool", roleName: "Tester", tool: "Read", write: false })
    ).toBe(true);
  });

  it("accepts role-attach-skill with string roleName and skillName", () => {
    expect(
      isAnatomyMessage({ type: "role-attach-skill", roleName: "Tester", skillName: "run-tests" })
    ).toBe(true);
  });

  it("accepts role-detach-skill with string roleName and skillName", () => {
    expect(
      isAnatomyMessage({ type: "role-detach-skill", roleName: "Tester", skillName: "run-tests" })
    ).toBe(true);
  });

  // ─── rejects missing roleName ──────────────────────────────────────────────

  it("rejects open-anatomy with missing roleName", () => {
    expect(isAnatomyMessage({ type: "open-anatomy" })).toBe(false);
  });

  it("rejects role-set-soul with missing roleName", () => {
    expect(isAnatomyMessage({ type: "role-set-soul", soul: "body" })).toBe(false);
  });

  it("rejects role-set-instructions with missing roleName", () => {
    expect(isAnatomyMessage({ type: "role-set-instructions", instructions: "do it" })).toBe(false);
  });

  it("rejects role-set-tools with missing roleName", () => {
    expect(isAnatomyMessage({ type: "role-set-tools", tools: {} })).toBe(false);
  });

  it("rejects role-set-engine with missing roleName", () => {
    expect(isAnatomyMessage({ type: "role-set-engine", engineId: "copilot" })).toBe(false);
  });

  it("rejects role-set-autonomy with missing roleName", () => {
    expect(isAnatomyMessage({ type: "role-set-autonomy", autonomy: "manual" })).toBe(false);
  });

  it("rejects grant-tool with missing roleName", () => {
    expect(isAnatomyMessage({ type: "grant-tool", tool: "Git", write: true })).toBe(false);
  });

  it("rejects role-attach-skill with missing roleName", () => {
    expect(isAnatomyMessage({ type: "role-attach-skill", skillName: "run-tests" })).toBe(false);
  });

  it("rejects role-detach-skill with missing roleName", () => {
    expect(isAnatomyMessage({ type: "role-detach-skill", skillName: "run-tests" })).toBe(false);
  });

  // ─── rejects bad autonomy ─────────────────────────────────────────────────

  it("rejects role-set-autonomy with invalid autonomy value", () => {
    expect(
      isAnatomyMessage({ type: "role-set-autonomy", roleName: "Tester", autonomy: "full-auto" })
    ).toBe(false);
  });

  it("rejects role-set-autonomy with non-string autonomy", () => {
    expect(
      isAnatomyMessage({ type: "role-set-autonomy", roleName: "Tester", autonomy: 42 })
    ).toBe(false);
  });

  it("rejects role-set-autonomy with missing autonomy field", () => {
    expect(isAnatomyMessage({ type: "role-set-autonomy", roleName: "Tester" })).toBe(false);
  });

  // ─── rejects role-set-tools with non-object tools ─────────────────────────

  it("rejects role-set-tools with string tools", () => {
    expect(
      isAnatomyMessage({ type: "role-set-tools", roleName: "Tester", tools: "Read" })
    ).toBe(false);
  });

  it("rejects role-set-tools with null tools", () => {
    expect(
      isAnatomyMessage({ type: "role-set-tools", roleName: "Tester", tools: null })
    ).toBe(false);
  });

  it("rejects role-set-tools with array tools", () => {
    expect(
      isAnatomyMessage({ type: "role-set-tools", roleName: "Tester", tools: ["Read"] })
    ).toBe(false);
  });

  it("rejects role-set-tools with missing tools", () => {
    expect(isAnatomyMessage({ type: "role-set-tools", roleName: "Tester" })).toBe(false);
  });

  // ─── rejects grant-tool with non-boolean write ───────────────────────────

  it("rejects grant-tool with string write", () => {
    expect(
      isAnatomyMessage({ type: "grant-tool", roleName: "Tester", tool: "Git", write: "true" })
    ).toBe(false);
  });

  it("rejects grant-tool with numeric write", () => {
    expect(
      isAnatomyMessage({ type: "grant-tool", roleName: "Tester", tool: "Git", write: 1 })
    ).toBe(false);
  });

  it("rejects grant-tool with missing write field", () => {
    expect(isAnatomyMessage({ type: "grant-tool", roleName: "Tester", tool: "Git" })).toBe(false);
  });

  it("rejects grant-tool with missing tool field", () => {
    expect(isAnatomyMessage({ type: "grant-tool", roleName: "Tester", write: true })).toBe(false);
  });

  // ─── rejects skill verbs with bad skillName ──────────────────────────────

  it("rejects role-attach-skill with missing skillName", () => {
    expect(isAnatomyMessage({ type: "role-attach-skill", roleName: "Tester" })).toBe(false);
  });

  it("rejects role-attach-skill with non-string skillName", () => {
    expect(
      isAnatomyMessage({ type: "role-attach-skill", roleName: "Tester", skillName: 42 })
    ).toBe(false);
  });

  it("rejects role-detach-skill with missing skillName", () => {
    expect(isAnatomyMessage({ type: "role-detach-skill", roleName: "Tester" })).toBe(false);
  });

  it("rejects role-detach-skill with non-string skillName", () => {
    expect(
      isAnatomyMessage({ type: "role-detach-skill", roleName: "Tester", skillName: 42 })
    ).toBe(false);
  });

  // ─── rejects unknown type and null ────────────────────────────────────────

  it("rejects unknown type", () => {
    expect(isAnatomyMessage({ type: "anatomy-noop", roleName: "Tester" })).toBe(false);
  });

  it("rejects null", () => {
    expect(isAnatomyMessage(null)).toBe(false);
  });

  it("rejects a non-object string", () => {
    expect(isAnatomyMessage("open-anatomy")).toBe(false);
  });

  it("rejects an object with no type field", () => {
    expect(isAnatomyMessage({ roleName: "Tester" })).toBe(false);
  });

  it("rejects role-set-engine with non-string model", () => {
    expect(
      isAnatomyMessage({ type: "role-set-engine", roleName: "Tester", engineId: "copilot", model: 42 })
    ).toBe(false);
  });
});
