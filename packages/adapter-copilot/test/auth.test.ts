import { describe, expect, it } from "vitest";
import { resolveAuth } from "../src/auth.js";

describe("resolveAuth", () => {
  it("is ok when COPILOT_GITHUB_TOKEN is set", () => {
    expect(resolveAuth({ COPILOT_GITHUB_TOKEN: "ghp_x" })).toEqual({ ok: true });
  });

  it("is ok when GH_TOKEN or GITHUB_TOKEN is set", () => {
    expect(resolveAuth({ GH_TOKEN: "x" }).ok).toBe(true);
    expect(resolveAuth({ GITHUB_TOKEN: "x" }).ok).toBe(true);
  });

  it("is not ok with no token and points at gh auth", () => {
    const status = resolveAuth({});
    expect(status.ok).toBe(false);
    expect(status.detail).toContain("gh auth login");
  });
});
