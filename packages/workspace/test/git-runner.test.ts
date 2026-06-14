import { describe, expect, it } from "vitest";
import { nodeGitRunner } from "../src/git-runner.js";
import { makeFakeGitRunner, startsWith } from "./fake-git-runner.js";

describe("makeFakeGitRunner", () => {
  it("records calls and returns scripted results", async () => {
    const { runner, calls } = makeFakeGitRunner([
      { match: startsWith("rev-parse"), result: { stdout: "abc\n" } },
    ]);
    const r = await runner(["rev-parse", "HEAD"], { cwd: "/repo" });
    expect(r.stdout).toBe("abc\n");
    expect(calls[0]).toEqual({ args: ["rev-parse", "HEAD"], cwd: "/repo" });
  });
});

describe("nodeGitRunner", () => {
  it("runs real git --version (exit 0)", async () => {
    const r = await nodeGitRunner(["--version"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("git version");
  });
});
