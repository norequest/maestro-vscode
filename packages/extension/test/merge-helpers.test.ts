import { describe, expect, it, vi } from "vitest";
import type { Agent } from "@hallucinate/core";
import { buildConflictResolveMessage, buildPrTitle, buildPrBody, conflictFileBase, markPrCreatedAfterPush } from "../src/merge-helpers.js";

describe("conflictFileBase (Issue 6)", () => {
  it("returns the agent's worktree path so files open with their conflict markers", () => {
    const agent = { workspace: { agentId: "a1", path: "/wt/a1", branch: "agent/a1" } } as Pick<Agent, "workspace">;
    expect(conflictFileBase(agent)).toBe("/wt/a1");
  });
  it("returns undefined when the worktree is unavailable (caller skips/warns)", () => {
    expect(conflictFileBase({})).toBeUndefined();
  });
});

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
    expect(body).toContain("Hallucinate");
  });
  it("handles undefined summary", () => {
    expect(buildPrBody(undefined, [])).toContain("No summary provided");
  });
});

describe("markPrCreatedAfterPush", () => {
  it("calls markPrCreated with the agent id so the card becomes terminal", async () => {
    const markPrCreated = vi.fn(async () => {});
    await markPrCreatedAfterPush({ markPrCreated }, "a1");
    expect(markPrCreated).toHaveBeenCalledTimes(1);
    expect(markPrCreated).toHaveBeenCalledWith("a1");
  });

  it("awaits the orchestrator transition (propagates rejection to the caller)", async () => {
    const markPrCreated = vi.fn(async () => {
      throw new Error("not done");
    });
    await expect(markPrCreatedAfterPush({ markPrCreated }, "a1")).rejects.toThrow("not done");
  });
});
