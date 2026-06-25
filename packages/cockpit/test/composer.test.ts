import { describe, expect, it } from "vitest";
import type { Role, Team } from "@maestro/core";
import { composerOptions, buildDispatchMessage, canDispatch, ENGINE_FAMILIES } from "../src/composer.js";

const role = (over: Partial<Role> = {}): Role => ({ name: "Test Author", instructions: "Write thorough unit tests for the changed code before implementing it.", engine: { id: "copilot" }, autonomy: "auto-approve-safe", ...over });

describe("composerOptions", () => {
  it("maps roles to preset chips with name, default engine, and an instructions snippet", () => {
    const opts = composerOptions([role()], []);
    const chip = opts.presets[0]!;
    expect(chip.roleName).toBe("Test Author");
    expect(chip.engineId).toBe("copilot");
    expect(chip.instructionsSnippet.length).toBeLessThanOrEqual(120);
    expect(chip.instructionsSnippet).toContain("Write thorough");
  });
  it("carries the role model into the chip when present", () => {
    const opts = composerOptions([role({ engine: { id: "acp", model: "gemini" } })], []);
    expect(opts.presets[0]!.engineId).toBe("acp");
    expect(opts.presets[0]!.model).toBe("gemini");
  });
  it("maps teams to rows with a role-count summary", () => {
    const team: Team = { name: "Strike", roles: [role(), role({ name: "Reviewer" })] };
    const opts = composerOptions([], [team]);
    expect(opts.teams[0]!.name).toBe("Strike");
    expect(opts.teams[0]!.roleCount).toBe(2);
  });
  it("exposes the two known engine families with model variants", () => {
    const ids = ENGINE_FAMILIES.map((f) => f.id);
    expect(ids).toEqual(["copilot", "acp"]);
    const allModels = ENGINE_FAMILIES.flatMap((f) => f.models);
    expect(allModels).toEqual(expect.arrayContaining(["claude-sonnet-4.5", "gpt-5", "o3", "gemini"]));
  });
});
describe("canDispatch + buildDispatchMessage", () => {
  it("needs a role (preset or new) and a non-blank task", () => {
    expect(canDispatch({ description: "" })).toBe(false);
    expect(canDispatch({ roleName: "Test Author", description: "  " })).toBe(false);
    expect(canDispatch({ description: "do it" })).toBe(false);
    expect(canDispatch({ roleName: "Test Author", description: "do it" })).toBe(true);
    expect(canDispatch({ newRoleName: "Doc Writer", description: "do it" })).toBe(true);
  });
  it("builds a preset dispatch message, trimming and dropping empty optionals", () => {
    const msg = buildDispatchMessage({ roleName: "Test Author", description: "  write tests  ", goal: "" });
    expect(msg).toEqual({ type: "dispatch", roleName: "Test Author", description: "write tests" });
  });
  it("builds an ad-hoc dispatch with engine, model, and goal", () => {
    const msg = buildDispatchMessage({ newRoleName: "Doc Writer", engineId: "copilot", model: "gpt-5", goal: "so the API is documented", description: "document the public API" });
    expect(msg).toMatchObject({ type: "dispatch", newRoleName: "Doc Writer", engineId: "copilot", model: "gpt-5", goal: "so the API is documented", description: "document the public API" });
  });
  it("returns null when the form cannot dispatch", () => {
    expect(buildDispatchMessage({ description: "" })).toBeNull();
  });
});
