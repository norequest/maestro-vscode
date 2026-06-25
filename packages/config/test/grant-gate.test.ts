import { describe, it, expect } from "vitest";
import { skillNeedsGrant } from "../src/grant-gate.js";
import type { ToolGrant } from "@maestro/core";

describe("skillNeedsGrant", () => {
  it("returns null when allowedTools is empty (no needs = fully covered)", () => {
    const grant: ToolGrant = { builtins: { read: ["Read"] } };
    expect(skillNeedsGrant([], grant)).toBeNull();
  });

  it("returns null when allowedTools is undefined (no needs = fully covered)", () => {
    const grant: ToolGrant = { builtins: { read: ["Read"] } };
    expect(skillNeedsGrant(undefined, grant)).toBeNull();
  });

  it("returns a gap with missingWrite=['Git'] for ['Git(write)'] vs read-only grant", () => {
    const grant: ToolGrant = { builtins: { read: ["Read"] } };
    const gap = skillNeedsGrant(["Git(write)"], grant);
    expect(gap).not.toBeNull();
    expect(gap?.missingWrite).toContain("Git");
  });

  it("returns null for ['Git(write)'] when write grant includes Git", () => {
    const grant: ToolGrant = { builtins: { write: ["Git"] } };
    expect(skillNeedsGrant(["Git(write)"], grant)).toBeNull();
  });

  it("returns a gap with missingMcp=['sec-kit'] for ['mcp:sec-kit'] vs undefined grant", () => {
    const gap = skillNeedsGrant(["mcp:sec-kit"], undefined);
    expect(gap).not.toBeNull();
    expect(gap?.missingMcp).toContain("sec-kit");
  });

  it("returns null when mcp server is listed in the grant", () => {
    const grant: ToolGrant = { mcp: [{ server: "sec-kit", read: true }] };
    expect(skillNeedsGrant(["mcp:sec-kit"], grant)).toBeNull();
  });

  it("'Read' (no suffix) needs a read grant for Read", () => {
    const noReadGrant: ToolGrant = { builtins: { write: ["Git"] } };
    const gap = skillNeedsGrant(["Read"], noReadGrant);
    expect(gap).not.toBeNull();
    expect(gap?.missingRead).toContain("Read");
  });

  it("returns null for 'Read' when read grant includes Read", () => {
    const grant: ToolGrant = { builtins: { read: ["Read"] } };
    expect(skillNeedsGrant(["Read"], grant)).toBeNull();
  });

  it("a read grant does NOT satisfy a write need (write is strictly separate)", () => {
    // If a skill needs Git(write), a read grant for Git (hypothetically) does not satisfy it.
    // In the ToolGrant model, read and write are tracked apart.
    const grant: ToolGrant = { builtins: { read: ["Read", "Search"] } };
    const gap = skillNeedsGrant(["Git(write)"], grant);
    expect(gap).not.toBeNull();
    expect(gap?.missingWrite).toContain("Git");
  });

  it("only reports missing entries, not covered ones (no false gaps)", () => {
    const grant: ToolGrant = {
      builtins: { read: ["Read", "Search"], write: ["Git"] },
      mcp: [{ server: "sec-kit", read: true }],
    };
    // All needs are covered
    expect(skillNeedsGrant(["Read", "Git(write)", "mcp:sec-kit"], grant)).toBeNull();
  });

  it("reports only the missing ones when partially covered", () => {
    const grant: ToolGrant = { builtins: { read: ["Read"] } };
    const gap = skillNeedsGrant(["Read", "Git(write)", "mcp:sec-kit"], grant);
    expect(gap).not.toBeNull();
    expect(gap?.missingRead).toHaveLength(0);
    expect(gap?.missingWrite).toContain("Git");
    expect(gap?.missingMcp).toContain("sec-kit");
  });
});
