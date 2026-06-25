import { describe, expect, it } from "vitest";
import { isLibraryMessage } from "../src/library-protocol.js";

describe("isLibraryMessage", () => {
  // ─── accepts well-formed variants ─────────────────────────────────────────

  it("accepts open-library", () => {
    expect(isLibraryMessage({ type: "open-library" })).toBe(true);
  });

  it("accepts switch-library-tab with valid tab", () => {
    expect(isLibraryMessage({ type: "switch-library-tab", tab: "agents" })).toBe(true);
    expect(isLibraryMessage({ type: "switch-library-tab", tab: "teams" })).toBe(true);
    expect(isLibraryMessage({ type: "switch-library-tab", tab: "skills" })).toBe(true);
    expect(isLibraryMessage({ type: "switch-library-tab", tab: "discover" })).toBe(true);
  });

  it("accepts skill-create", () => {
    expect(isLibraryMessage({ type: "skill-create" })).toBe(true);
  });

  it("accepts skill-save with required fields", () => {
    expect(
      isLibraryMessage({ type: "skill-save", name: "mySkill", description: "desc", body: "body" })
    ).toBe(true);
  });

  it("accepts skill-save with optional allowedTools", () => {
    expect(
      isLibraryMessage({
        type: "skill-save",
        name: "mySkill",
        description: "desc",
        body: "body",
        allowedTools: ["Bash", "Read"],
      })
    ).toBe(true);
  });

  it("accepts skill-delete", () => {
    expect(isLibraryMessage({ type: "skill-delete", name: "mySkill" })).toBe(true);
  });

  it("accepts attach-skill", () => {
    expect(
      isLibraryMessage({ type: "attach-skill", roleName: "Tester", skillName: "run-tests" })
    ).toBe(true);
  });

  it("accepts detach-skill", () => {
    expect(
      isLibraryMessage({ type: "detach-skill", roleName: "Tester", skillName: "run-tests" })
    ).toBe(true);
  });

  // ─── rejects invalid messages ──────────────────────────────────────────────

  it("rejects null", () => {
    expect(isLibraryMessage(null)).toBe(false);
  });

  it("rejects a non-object (string)", () => {
    expect(isLibraryMessage("open-library")).toBe(false);
  });

  it("rejects a non-object (number)", () => {
    expect(isLibraryMessage(42)).toBe(false);
  });

  it("rejects an unknown type", () => {
    expect(isLibraryMessage({ type: "unknown-type" })).toBe(false);
  });

  it("rejects switch-library-tab with missing tab", () => {
    expect(isLibraryMessage({ type: "switch-library-tab" })).toBe(false);
  });

  it("rejects switch-library-tab with invalid tab value", () => {
    expect(isLibraryMessage({ type: "switch-library-tab", tab: "invalid" })).toBe(false);
    expect(isLibraryMessage({ type: "switch-library-tab", tab: 42 })).toBe(false);
  });

  it("rejects attach-skill missing skillName", () => {
    expect(isLibraryMessage({ type: "attach-skill", roleName: "Tester" })).toBe(false);
  });

  it("rejects attach-skill missing roleName", () => {
    expect(isLibraryMessage({ type: "attach-skill", skillName: "run-tests" })).toBe(false);
  });

  it("rejects detach-skill missing skillName", () => {
    expect(isLibraryMessage({ type: "detach-skill", roleName: "Tester" })).toBe(false);
  });

  it("rejects skill-save with non-string name", () => {
    expect(
      isLibraryMessage({ type: "skill-save", name: 123, description: "desc", body: "body" })
    ).toBe(false);
  });

  it("rejects skill-save with missing name", () => {
    expect(isLibraryMessage({ type: "skill-save", description: "desc", body: "body" })).toBe(
      false
    );
  });

  it("rejects skill-save with missing description", () => {
    expect(isLibraryMessage({ type: "skill-save", name: "foo", body: "body" })).toBe(false);
  });

  it("rejects skill-save with missing body", () => {
    expect(isLibraryMessage({ type: "skill-save", name: "foo", description: "desc" })).toBe(false);
  });

  it("rejects skill-save with allowedTools present but not a string[]", () => {
    expect(
      isLibraryMessage({
        type: "skill-save",
        name: "foo",
        description: "desc",
        body: "body",
        allowedTools: "Bash",
      })
    ).toBe(false);
  });

  it("rejects skill-save with allowedTools containing a non-string element", () => {
    expect(
      isLibraryMessage({
        type: "skill-save",
        name: "foo",
        description: "desc",
        body: "body",
        allowedTools: ["Bash", 42],
      })
    ).toBe(false);
  });

  it("rejects skill-delete with missing name", () => {
    expect(isLibraryMessage({ type: "skill-delete" })).toBe(false);
  });

  it("rejects skill-delete with non-string name", () => {
    expect(isLibraryMessage({ type: "skill-delete", name: 123 })).toBe(false);
  });

  it("rejects object with no type field", () => {
    expect(isLibraryMessage({ roleName: "Tester" })).toBe(false);
  });

  // ─── discover/adopt variants ───────────────────────────────────────────────

  it("accepts scan-repo", () => {
    expect(isLibraryMessage({ type: "scan-repo" })).toBe(true);
  });

  it("accepts scan-plugins", () => {
    expect(isLibraryMessage({ type: "scan-plugins" })).toBe(true);
  });

  it("accepts adopt-agent with a valid itemId", () => {
    expect(isLibraryMessage({ type: "adopt-agent", itemId: "some/path.md" })).toBe(true);
  });

  it("accepts adopt-skill with a valid itemId", () => {
    expect(isLibraryMessage({ type: "adopt-skill", itemId: "some/path.md" })).toBe(true);
  });

  it("accepts browse-source with a valid itemId", () => {
    expect(isLibraryMessage({ type: "browse-source", itemId: "some/path.md" })).toBe(true);
  });

  it("rejects adopt-agent with missing itemId", () => {
    expect(isLibraryMessage({ type: "adopt-agent" })).toBe(false);
  });

  it("rejects adopt-agent with non-string itemId", () => {
    expect(isLibraryMessage({ type: "adopt-agent", itemId: 123 })).toBe(false);
  });

  it("rejects adopt-skill with missing itemId", () => {
    expect(isLibraryMessage({ type: "adopt-skill" })).toBe(false);
  });

  it("accepts browse-source with an empty-string itemId (type check only)", () => {
    expect(isLibraryMessage({ type: "browse-source", itemId: "" })).toBe(true);
  });

  it("rejects unknown types even after new variants exist", () => {
    expect(isLibraryMessage({ type: "not-a-real-type" })).toBe(false);
  });

  // ─── Group 1: new-role / delete-role ────────────────────────────────────────

  it("accepts new-role with a name", () => {
    expect(isLibraryMessage({ type: "new-role", name: "Reviewer" })).toBe(true);
  });

  it("accepts new-role without a name (host prompts) but rejects a non-string name", () => {
    // The webview can't use window.prompt(), so it omits the name and the host
    // collects it via a native input box; a name-less new-role is therefore valid.
    expect(isLibraryMessage({ type: "new-role" })).toBe(true);
    expect(isLibraryMessage({ type: "new-role", name: 7 })).toBe(false);
  });

  it("accepts delete-role with a name", () => {
    expect(isLibraryMessage({ type: "delete-role", name: "Tester" })).toBe(true);
  });

  it("rejects delete-role with missing name", () => {
    expect(isLibraryMessage({ type: "delete-role" })).toBe(false);
  });

  // ─── Group 2: team-create / team-save / team-delete ─────────────────────────

  it("accepts team-create", () => {
    expect(isLibraryMessage({ type: "team-create" })).toBe(true);
  });

  it("accepts team-save with name + roleNames (no goal)", () => {
    expect(isLibraryMessage({ type: "team-save", name: "Squad", roleNames: ["A", "B"] })).toBe(true);
  });

  it("accepts team-save with an optional goal", () => {
    expect(
      isLibraryMessage({ type: "team-save", name: "Squad", roleNames: [], goal: "ship it" })
    ).toBe(true);
  });

  it("rejects team-save with missing name", () => {
    expect(isLibraryMessage({ type: "team-save", roleNames: ["A"] })).toBe(false);
  });

  it("rejects team-save with missing roleNames", () => {
    expect(isLibraryMessage({ type: "team-save", name: "Squad" })).toBe(false);
  });

  it("rejects team-save with non-string roleNames element", () => {
    expect(isLibraryMessage({ type: "team-save", name: "Squad", roleNames: ["A", 2] })).toBe(false);
  });

  it("rejects team-save with a non-string goal", () => {
    expect(
      isLibraryMessage({ type: "team-save", name: "Squad", roleNames: [], goal: 9 })
    ).toBe(false);
  });

  it("accepts team-delete with a name", () => {
    expect(isLibraryMessage({ type: "team-delete", name: "Squad" })).toBe(true);
  });

  it("rejects team-delete with missing name", () => {
    expect(isLibraryMessage({ type: "team-delete" })).toBe(false);
  });

  // ─── Group 3: launch-team ───────────────────────────────────────────────────

  it("accepts launch-team with a name", () => {
    expect(isLibraryMessage({ type: "launch-team", name: "Squad" })).toBe(true);
  });

  it("rejects launch-team with missing or non-string name", () => {
    expect(isLibraryMessage({ type: "launch-team" })).toBe(false);
    expect(isLibraryMessage({ type: "launch-team", name: 5 })).toBe(false);
  });

  it("accepts launch-team with an optional task (the overlay path), rejects a non-string task", () => {
    expect(isLibraryMessage({ type: "launch-team", name: "Squad", task: "ship the thing" })).toBe(true);
    expect(isLibraryMessage({ type: "launch-team", name: "Squad", task: 9 })).toBe(false);
  });

  // The standalone default-agent path was removed: launch-default is no longer a
  // valid LibraryToHost variant, so the guard must REJECT it.
  it("rejects the removed launch-default message", () => {
    expect(isLibraryMessage({ type: "launch-default", task: "do the thing" })).toBe(false);
  });
});
