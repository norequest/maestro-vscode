import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeRepoAgentFile } from "../src/agent-profile.js";

describe("writeRepoAgentFile", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "maestro-repo-agent-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("creates .github/agents/<slug>.agent.md and reports created", () => {
    const res = writeRepoAgentFile(root, "python-reviewer", "---\nname: python-reviewer\n---\nbody");
    expect(res.created).toBe(true);
    const file = join(root, ".github", "agents", "python-reviewer.agent.md");
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, "utf8")).toContain("name: python-reviewer");
  });

  it("overwrites an existing file and reports created=false", () => {
    writeRepoAgentFile(root, "reviewer", "v1");
    const res = writeRepoAgentFile(root, "reviewer", "v2");
    expect(res.created).toBe(false);
    expect(readFileSync(join(root, ".github", "agents", "reviewer.agent.md"), "utf8")).toBe("v2");
  });
});
