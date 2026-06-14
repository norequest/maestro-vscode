import { describe, expect, it } from "vitest";
import { nodeGitRunner, nodeShellRunner, SHELL_RUNNER_ALLOWLIST } from "../src/git-runner.js";
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

// Issue 31 (S5): nodeShellRunner must not spawn an arbitrary args[0]; only
// allowlisted binaries (today just "gh") may be spawned.
describe("nodeShellRunner allowlist", () => {
  it("rejects a non-allowlisted binary instead of spawning it", async () => {
    await expect(nodeShellRunner(["rm", "-rf", "/"])).rejects.toThrow(/non-allowlisted/);
  });

  it("only allows gh", () => {
    expect(SHELL_RUNNER_ALLOWLIST).toEqual(["gh"]);
    expect(SHELL_RUNNER_ALLOWLIST.includes("gh")).toBe(true);
  });
});
