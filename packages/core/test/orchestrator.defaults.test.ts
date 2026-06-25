import { describe, expect, it, vi } from "vitest";
import { Orchestrator } from "../src/orchestrator.js";
import { FakeEngineAdapter } from "../src/fake-adapter.js";
import { FakeWorkspaceProvider } from "../src/workspace.js";
import type { PreambleResolver, Role, Team } from "../src/types.js";

function role(name: string, engineId = name): Role {
  // One adapter per engine id; give each role its own engine so each team member
  // resolves to a distinct adapter we can inspect via its lastRole.
  return { name, instructions: `do ${name}`, engine: { id: engineId }, autonomy: "manual" };
}

/** Parks the session on an approval so the agent settles in a slot-holding state. */
function pendingAdapter(engineId: string): FakeEngineAdapter {
  return new FakeEngineAdapter({
    id: engineId,
    script: [{ kind: "approval", id: `ap-${engineId}`, detail: null }],
  });
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

describe("Orchestrator default layer (setDefaults)", () => {
  it("composes general defaults (instructions + skills) into a plain dispatch", async () => {
    const adapter = pendingAdapter("fake");
    const orch = new Orchestrator({ maxParallelAgents: 1 }, new FakeWorkspaceProvider());
    orch.registerAdapter(adapter);
    orch.registerRole(role("R", "fake"));
    orch.setDefaults({ instructions: "HOUSE", skills: ["s1"] });

    const agent = orch.spawn("R", "my task");
    await waitForState(orch, agent.id, "awaiting-approval");

    // The effective role the adapter received carries the general defaults.
    const startedRole = adapter.lastRole!;
    // HOUSE leads the role's own instructions.
    expect(startedRole.instructions.startsWith("HOUSE")).toBe(true);
    expect(startedRole.instructions).toContain("do R");
    // The default skill merged onto role.skills (resolver resolves merged names).
    expect(startedRole.skills).toEqual(["s1"]);
  });

  it("passes the merged skill names to the preamble resolver", async () => {
    const resolver = vi.fn<PreambleResolver>(async () => ({
      skills: [{ name: "s1", content: "## s1\nbody" }],
    }));
    const adapter = pendingAdapter("fake");
    const orch = new Orchestrator({ maxParallelAgents: 1 }, new FakeWorkspaceProvider());
    orch.registerAdapter(adapter);
    orch.registerRole(role("R", "fake"));
    orch.setDefaults({ instructions: "HOUSE", skills: ["s1"] });
    orch.setPreambleResolver(resolver);

    const agent = orch.spawn("R", "my task");
    await waitForState(orch, agent.id, "awaiting-approval");

    // The resolver (which maps skill NAMES to bodies) sees the merged default skill.
    expect(resolver).toHaveBeenCalledWith(expect.objectContaining({ skills: ["s1"] }));
  });

  it("with no setDefaults call, spawn behavior is unchanged", async () => {
    const adapter = pendingAdapter("fake");
    const orch = new Orchestrator({ maxParallelAgents: 1 }, new FakeWorkspaceProvider());
    orch.registerAdapter(adapter);
    orch.registerRole(role("R", "fake"));

    const agent = orch.spawn("R", "my task");
    await waitForState(orch, agent.id, "awaiting-approval");

    const startedRole = adapter.lastRole!;
    expect(startedRole.instructions).toBe("do R");
    expect(startedRole.skills).toBeUndefined();
  });

  it("de-dupes a default skill that the role also lists", async () => {
    const adapter = pendingAdapter("fake");
    const orch = new Orchestrator({ maxParallelAgents: 1 }, new FakeWorkspaceProvider());
    orch.registerAdapter(adapter);
    orch.registerRole({ ...role("R", "fake"), skills: ["s1", "roleOwn"] });
    orch.setDefaults({ skills: ["s1"] });

    const agent = orch.spawn("R", "my task");
    await waitForState(orch, agent.id, "awaiting-approval");

    // s1 appears once (default first occurrence), then the role's own skills.
    expect(adapter.lastRole!.skills).toEqual(["s1", "roleOwn"]);
  });

  describe("leadSkills (lead only)", () => {
    const team: Team = { name: "t", roles: [role("lead"), role("coder")] };

    it("applies leadSkills to the lead but not to a teammate", async () => {
      const leadAdapter = new FakeEngineAdapter({
        id: "lead",
        // The lead emits a delegate block, then parks on an approval.
        script: [
          { kind: "output", text: "```delegate\nrole: coder\ntask: build it\n```" },
          { kind: "approval", id: "ap-lead", detail: null },
        ],
      });
      const coderAdapter = pendingAdapter("coder");
      const orch = new Orchestrator({ maxParallelAgents: 3 }, new FakeWorkspaceProvider());
      orch.registerAdapter(leadAdapter);
      orch.registerAdapter(coderAdapter);
      orch.setDefaults({ instructions: "HOUSE", skills: ["s1"], leadSkills: ["lead-only"] });

      const [lead] = orch.launchTeam(team, "ship it");
      await waitForState(orch, lead!.id, "awaiting-approval");

      // The lead carries general defaults + leadSkills.
      expect(leadAdapter.lastRole!.skills).toEqual(["s1", "lead-only"]);
      // General instructions ride the lead too, ahead of the lead brief.
      expect(leadAdapter.lastRole!.instructions.startsWith("HOUSE")).toBe(true);
      expect(leadAdapter.lastRole!.instructions).toContain("You are the default agent.");

      // The lead's delegation surfaced as a proposal; approve it to spawn the teammate.
      const proposal = orch.getDelegations()[0]!;
      const child = orch.approveDelegation(proposal.id);
      await waitForState(orch, child.id, "awaiting-approval");

      // The teammate gets the GENERAL defaults but NOT leadSkills.
      expect(coderAdapter.lastRole!.skills).toEqual(["s1"]);
      expect(coderAdapter.lastRole!.instructions.startsWith("HOUSE")).toBe(true);
    });

    it("does not apply leadSkills to a plain non-team dispatch", async () => {
      const adapter = pendingAdapter("fake");
      const orch = new Orchestrator({ maxParallelAgents: 1 }, new FakeWorkspaceProvider());
      orch.registerAdapter(adapter);
      orch.registerRole(role("R", "fake"));
      orch.setDefaults({ skills: ["s1"], leadSkills: ["lead-only"] });

      const agent = orch.spawn("R", "my task");
      await waitForState(orch, agent.id, "awaiting-approval");

      // Only general defaults; leadSkills is for roster holders.
      expect(adapter.lastRole!.skills).toEqual(["s1"]);
    });
  });
});
