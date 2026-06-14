import { describe, expect, it } from "vitest";
import { buildConflictResolveMessage, buildPrTitle, buildPrBody } from "../src/merge-helpers.js";

describe("buildConflictResolveMessage", () => {
  it("lists conflicted files and the finish-merge instruction", () => {
    const msg = buildConflictResolveMessage(["a.ts", "b.ts"]);
    expect(msg).toContain("a.ts");
    expect(msg).toContain("b.ts");
    expect(msg).toContain("Finish Merge");
  });
});
describe("buildPrTitle", () => {
  it("includes role name and (truncated) description", () => {
    expect(buildPrTitle("Implementer", "Add a --version flag to the CLI")).toContain("Implementer");
    const long = buildPrTitle("R", "x".repeat(80));
    expect(long.length).toBeLessThan(100);
    expect(long).toContain("...");
  });
});
describe("buildPrBody", () => {
  it("includes summary and file list", () => {
    const body = buildPrBody("All good.", ["a.ts"]);
    expect(body).toContain("All good.");
    expect(body).toContain("a.ts");
    expect(body).toContain("Maestro");
  });
  it("handles undefined summary", () => {
    expect(buildPrBody(undefined, [])).toContain("No summary provided");
  });
});
