import { describe, it, expect, vi } from "vitest";
import { Orchestrator } from "../src/orchestrator.js";
import { FakeEngineAdapter } from "../src/fake-adapter.js";
import { FakeWorkspaceProvider, FakeWorkspaceManager } from "../src/workspace.js";
import type { PreambleResolver, Role, SkillRef, Team } from "../src/types.js";

function role(name: string, engineId = name): Role {
  return { name, instructions: `do ${name}`, engine: { id: engineId }, autonomy: "manual" };
}

function waitForState(orch: Orchestrator, agentId: string, target: string): Promise<void> {
  return new Promise((resolve) => {
    let unsub: (() => void) | undefined;
    const check = (): void => {
      if (orch.getAgent(agentId)?.state === target) {
        unsub?.();
        resolve();
      }
    };
    unsub = orch.on(check);
    check();
  });
}

describe("Orchestrator skill materialization (writeSkills)", () => {
  it("materializes the resolved skills into the agent's worktree before the engine starts", async () => {
    const skill: SkillRef = { name: "skill-a", description: "Do A.", content: "## skill-a\nbody A" };
    const resolver: PreambleResolver = vi.fn(async () => ({ skills: [skill] }));

    const adapter = new FakeEngineAdapter({ script: [{ kind: "done", summary: "ok" }] });
    const manager = new FakeWorkspaceManager();
    const orch = new Orchestrator({ maxParallelAgents: 1 }, manager);
    orch.registerAdapter(adapter);
    orch.registerRole({ name: "R", instructions: "do it", engine: { id: "fake" }, autonomy: "yolo" });
    orch.setPreambleResolver(resolver);

    const agent = orch.spawn("R", "my task");
    await waitForState(orch, agent.id, "done");

    expect(manager.wroteSkills).toHaveLength(1);
    expect(manager.wroteSkills[0]!.agentId).toBe(agent.id);
    expect(manager.wroteSkills[0]!.skills).toEqual([skill]);
    // The worktree is created before skills are written.
    expect(manager.created).toContain(agent.id);
  });

  it("skips materialization when the task carries no skills", async () => {
    const adapter = new FakeEngineAdapter({ script: [{ kind: "done", summary: "ok" }] });
    const manager = new FakeWorkspaceManager();
    const orch = new Orchestrator({ maxParallelAgents: 1 }, manager);
    orch.registerAdapter(adapter);
    orch.registerRole({ name: "R", instructions: "do it", engine: { id: "fake" }, autonomy: "yolo" });
    // No resolver, so the task never gets skills.

    const agent = orch.spawn("R", "my task");
    await waitForState(orch, agent.id, "done");

    expect(manager.wroteSkills).toHaveLength(0);
  });

  it("is a no-op (no crash) when the provider does not support writeSkills", async () => {
    const skill: SkillRef = { name: "skill-a", content: "## skill-a\nbody A" };
    const resolver: PreambleResolver = vi.fn(async () => ({ skills: [skill] }));

    const adapter = new FakeEngineAdapter({ script: [{ kind: "done", summary: "ok" }] });
    const orch = new Orchestrator({ maxParallelAgents: 1 }, new FakeWorkspaceProvider());
    orch.registerAdapter(adapter);
    orch.registerRole({ name: "R", instructions: "do it", engine: { id: "fake" }, autonomy: "yolo" });
    orch.setPreambleResolver(resolver);

    const agent = orch.spawn("R", "my task");
    await waitForState(orch, agent.id, "done");

    // No manager API to assert against; reaching "done" without throwing is the contract.
    expect(orch.getAgent(agent.id)?.state).toBe("done");
  });

  it("materializes skills for a delegated teammate spawn too", async () => {
    // The resolver maps role -> skills, so both lead and teammate get a skill.
    const resolver: PreambleResolver = vi.fn(async (r: Role) => ({
      skills: [{ name: `skill-${r.name}`, content: `## skill-${r.name}\nbody` }] as SkillRef[],
    }));

    const leadAdapter = new FakeEngineAdapter({
      id: "lead",
      script: [
        { kind: "output", text: "```delegate\nrole: coder\ntask: build it\n```" },
        { kind: "done", summary: "lead done" },
      ],
    });
    const coderAdapter = new FakeEngineAdapter({
      id: "coder",
      script: [{ kind: "done", summary: "coder done" }],
    });
    const manager = new FakeWorkspaceManager();
    const orch = new Orchestrator({ maxParallelAgents: 3 }, manager);
    orch.registerAdapter(leadAdapter);
    orch.registerAdapter(coderAdapter);
    orch.setPreambleResolver(resolver);

    const team: Team = { name: "t", roles: [role("lead"), role("coder")] };
    const [lead] = orch.launchTeam(team, "ship it");
    await waitForState(orch, lead!.id, "done");

    // The lead's delegation surfaced as a proposal; approve it to spawn the teammate.
    const proposal = orch.getDelegations()[0]!;
    const child = orch.approveDelegation(proposal.id);
    await waitForState(orch, child.id, "done");

    const leadWrite = manager.wroteSkills.find((w) => w.agentId === lead!.id);
    const childWrite = manager.wroteSkills.find((w) => w.agentId === child.id);
    expect(leadWrite?.skills).toEqual([{ name: "skill-lead", content: "## skill-lead\nbody" }]);
    expect(childWrite?.skills).toEqual([{ name: "skill-coder", content: "## skill-coder\nbody" }]);
  });
});
