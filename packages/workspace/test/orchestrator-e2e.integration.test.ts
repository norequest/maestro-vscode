import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Orchestrator } from "@maestro/core";
import type { EngineAdapter, AgentSession, Task, Workspace, Role } from "@maestro/core";
import { GitWorkspaceManager } from "../src/index.js";

// An adapter that writes a file into the agent's real worktree, then emits done.
class WritingAdapter implements EngineAdapter {
  readonly id = "writer";
  readonly capabilities = { streaming: true, structuredEvents: false, approvals: false, steerable: false };
  health() { return Promise.resolve({ ok: true as const }); }
  start(_task: Task, workspace: Workspace, _role: Role): AgentSession {
    writeFileSync(join(workspace.path, "agent.txt"), "agent was here\n");
    async function* events() {
      yield { kind: "output" as const, text: "wrote a file" };
      yield { kind: "done" as const, summary: "done" };
    }
    return { events: events(), send() {}, respond() {}, stop() {} };
  }
}

const role: Role = { name: "Writer", instructions: "", engine: { id: "writer" }, autonomy: "yolo" };
function waitFor(o: Orchestrator, pred: () => boolean) {
  return new Promise<void>((res) => {
    const unsub = o.on(() => { if (pred()) { unsub(); res(); } });
    if (pred()) { unsub(); res(); }
  });
}

let repo: string;
beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "maestro-e2e-"));
  const g = (...a: string[]) => execFileSync("git", a, { cwd: repo });
  g("init", "-q", "-b", "main"); g("config", "user.email", "t@t.com"); g("config", "user.name", "T");
  writeFileSync(join(repo, "seed.txt"), "seed\n"); g("add", "."); g("commit", "-q", "-m", "init");
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe("Orchestrator + GitWorkspaceManager e2e", () => {
  it("runs an agent in a real worktree, computes the diff, merges it in", async () => {
    const manager = new GitWorkspaceManager({ repoRoot: repo });
    const orch = new Orchestrator({ maxParallelAgents: 1 }, manager);
    orch.registerRole(role);
    orch.registerAdapter(new WritingAdapter());

    const agent = orch.spawn("Writer", "write a file");
    await waitFor(orch, () => orch.getAgent(agent.id)?.diff !== undefined);

    const final = orch.getAgent(agent.id)!;
    expect(final.state).toBe("done");
    expect(final.diff!.files).toContain("agent.txt");

    const result = await orch.merge(agent.id);
    expect(result).toEqual({ status: "clean" });
    expect(orch.getAgent(agent.id)!.state).toBe("merged");
    expect(existsSync(join(repo, "agent.txt"))).toBe(true);
  });
});
