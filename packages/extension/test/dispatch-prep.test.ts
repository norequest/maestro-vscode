import { describe, expect, it } from "vitest";
import type { Role } from "@maestro/core";
import { prepareSavedRoleDispatch } from "../src/dispatch-prep.js";

const role = (name: string): Role => ({
  name,
  instructions: "x",
  engine: { id: "copilot" },
  autonomy: "auto-approve-safe",
});

describe("prepareSavedRoleDispatch", () => {
  it("registers the saved role whose name matches the dispatch", async () => {
    const registered: Role[] = [];
    await prepareSavedRoleDispatch(
      { roleName: "Reviewer" },
      {
        loadRoles: async () => [role("Reviewer"), role("Builder")],
        registerRole: (r) => registered.push(r),
      },
    );
    expect(registered.map((r) => r.name)).toEqual(["Reviewer"]);
  });

  it("is a no-op for an ad-hoc dispatch (no roleName)", async () => {
    const registered: Role[] = [];
    await prepareSavedRoleDispatch(
      {},
      { loadRoles: async () => [role("Reviewer")], registerRole: (r) => registered.push(r) },
    );
    expect(registered).toHaveLength(0);
  });

  it("is a no-op when the named role is not found", async () => {
    const registered: Role[] = [];
    await prepareSavedRoleDispatch(
      { roleName: "Ghost" },
      { loadRoles: async () => [role("Reviewer")], registerRole: (r) => registered.push(r) },
    );
    expect(registered).toHaveLength(0);
  });

  it("swallows a load failure (degrades to existing dispatch behavior)", async () => {
    const registered: Role[] = [];
    await prepareSavedRoleDispatch(
      { roleName: "Reviewer" },
      {
        loadRoles: async () => {
          throw new Error("fs error");
        },
        registerRole: (r) => registered.push(r),
      },
    );
    expect(registered).toHaveLength(0);
  });
});
