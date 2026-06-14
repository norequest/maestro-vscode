import { describe, expect, it } from "vitest";
import {
  FakeWorkspaceManager,
  FakeWorkspaceProvider,
  isWorkspaceManager,
} from "../src/index.js";

describe("isWorkspaceManager", () => {
  it("is false for a plain WorkspaceProvider", () => {
    expect(isWorkspaceManager(new FakeWorkspaceProvider())).toBe(false);
  });
  it("is true for a WorkspaceManager", () => {
    expect(isWorkspaceManager(new FakeWorkspaceManager())).toBe(true);
  });
});

describe("FakeWorkspaceManager", () => {
  it("records diff/merge/discard/cleanup and returns scripted results", async () => {
    const m = new FakeWorkspaceManager();
    m.setDiff("a1", { files: ["x.ts"], patch: "p" });
    expect(await m.diff("a1")).toEqual({ files: ["x.ts"], patch: "p" });

    m.setMergeResult("a1", { status: "conflict", files: ["x.ts"] });
    expect(await m.merge("a1")).toEqual({ status: "conflict", files: ["x.ts"] });

    await m.discard("a1");
    expect(m.discarded).toContain("a1");
    await m.cleanup("a1");
    expect(m.cleaned).toContain("a1");
  });
});
