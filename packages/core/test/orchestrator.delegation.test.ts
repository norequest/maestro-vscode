import { describe, expect, it } from "vitest";
import { Orchestrator } from "../src/orchestrator.js";
import { FakeEngineAdapter } from "../src/fake-adapter.js";
import { FakeWorkspaceProvider } from "../src/workspace.js";
import type { AgentEvent, DelegationProposal, OrchestratorEvent, Role, Team } from "../src/types.js";

function role(name: string): Role {
  return { name, instructions: `do ${name}`, engine: { id: name }, autonomy: "manual" };
}

/** A lead adapter that emits the given output then parks on an approval. */
function leadAdapter(engineId: string, output: string): FakeEngineAdapter {
  const script: AgentEvent[] = [
    { kind: "output", text: output },
    { kind: "approval", id: `ap-${engineId}`, detail: null },
  ];
  return new FakeEngineAdapter({ id: engineId, script });
}

function pendingAdapter(engineId: string): FakeEngineAdapter {
  return new FakeEngineAdapter({ id: engineId, script: [{ kind: "approval", id: `ap-${engineId}`, detail: null }] });
}

/** Resolve once a delegation-proposed event has been observed. */
function waitForProposal(orch: Orchestrator): Promise<DelegationProposal> {
  return new Promise((resolve) => {
    orch.on((e: OrchestratorEvent) => {
      if (e.kind === "delegation-proposed") resolve(e.proposal);
    });
  });
}

const delegateBlock = (role: string, task: string): string =>
  ["I'll bring someone in.", "```delegate", `role: ${role}`, `task: ${task}`, "```"].join("\n");

describe("Orchestrator delegation flow", () => {
  it("turns a lead's delegate directive into a pending proposal", async () => {
    const orch = new Orchestrator({ maxParallelAgents: 3 }, new FakeWorkspaceProvider());
    const team: Team = { name: "t", roles: [role("lead"), role("coder")] };
    orch.registerAdapter(leadAdapter("lead", delegateBlock("coder", "build the parser")));
    orch.registerAdapter(pendingAdapter("coder"));

    const proposalP = waitForProposal(orch);
    orch.launchTeam(team, "ship it");
    const proposal = await proposalP;

    expect(proposal.roleName).toBe("coder");
    expect(proposal.task).toBe("build the parser");
    expect(proposal.state).toBe("pending");
    expect(orch.getDelegations()).toHaveLength(1);
    // No teammate spawned yet: only the lead exists.
    expect(orch.getAgents()).toHaveLength(1);
  });

  it("approve spawns the teammate as a child of the lead", async () => {
    const orch = new Orchestrator({ maxParallelAgents: 3 }, new FakeWorkspaceProvider());
    const team: Team = { name: "t", roles: [role("lead"), role("coder")] };
    orch.registerAdapter(leadAdapter("lead", delegateBlock("coder", "build the parser")));
    orch.registerAdapter(pendingAdapter("coder"));

    const proposalP = waitForProposal(orch);
    const [lead] = orch.launchTeam(team, "ship it");
    const proposal = await proposalP;

    const child = orch.approveDelegation(proposal.id);
    expect(child.role.name).toBe("coder");
    expect(child.task.description).toBe("build the parser");
    expect(child.parentId).toBe(lead!.id);
    expect(orch.getDelegations()[0]!.state).toBe("approved");
    expect(orch.getAgents()).toHaveLength(2);
  });

  it("deny spawns nothing and marks the proposal denied", async () => {
    const orch = new Orchestrator({ maxParallelAgents: 3 }, new FakeWorkspaceProvider());
    const team: Team = { name: "t", roles: [role("lead"), role("coder")] };
    orch.registerAdapter(leadAdapter("lead", delegateBlock("coder", "build the parser")));
    orch.registerAdapter(pendingAdapter("coder"));

    const proposalP = waitForProposal(orch);
    orch.launchTeam(team, "ship it");
    const proposal = await proposalP;

    orch.denyDelegation(proposal.id);
    expect(orch.getDelegations()[0]!.state).toBe("denied");
    expect(orch.getAgents()).toHaveLength(1);
  });

  it("approving twice throws (a resolved proposal is not re-approvable)", async () => {
    const orch = new Orchestrator({ maxParallelAgents: 3 }, new FakeWorkspaceProvider());
    const team: Team = { name: "t", roles: [role("lead"), role("coder")] };
    orch.registerAdapter(leadAdapter("lead", delegateBlock("coder", "x")));
    orch.registerAdapter(pendingAdapter("coder"));

    const proposalP = waitForProposal(orch);
    orch.launchTeam(team, "ship it");
    const proposal = await proposalP;

    orch.approveDelegation(proposal.id);
    expect(() => orch.approveDelegation(proposal.id)).toThrow(/already approved/);
    expect(() => orch.denyDelegation(proposal.id)).toThrow(/already approved/);
  });

  it("ignores a directive naming an unknown role", async () => {
    const orch = new Orchestrator({ maxParallelAgents: 3 }, new FakeWorkspaceProvider());
    const team: Team = { name: "t", roles: [role("lead"), role("coder")] };
    orch.registerAdapter(leadAdapter("lead", delegateBlock("ghost", "do something")));
    orch.registerAdapter(pendingAdapter("coder"));

    let proposed = 0;
    orch.on((e) => {
      if (e.kind === "delegation-proposed") proposed++;
    });
    orch.launchTeam(team, "ship it");
    await new Promise((r) => setTimeout(r, 10));

    expect(proposed).toBe(0);
    expect(orch.getDelegations()).toHaveLength(0);
  });

  it("ignores a directive naming the lead itself", async () => {
    const orch = new Orchestrator({ maxParallelAgents: 3 }, new FakeWorkspaceProvider());
    const team: Team = { name: "t", roles: [role("lead"), role("coder")] };
    orch.registerAdapter(leadAdapter("lead", delegateBlock("lead", "recurse")));
    orch.registerAdapter(pendingAdapter("coder"));

    let proposed = 0;
    orch.on((e) => {
      if (e.kind === "delegation-proposed") proposed++;
    });
    orch.launchTeam(team, "ship it");
    await new Promise((r) => setTimeout(r, 10));

    expect(proposed).toBe(0);
  });

  it("does not re-propose the same directive as the buffer grows", async () => {
    // Two output chunks: the second repeats the (already complete) first block,
    // then adds a genuinely new one. Only two DISTINCT proposals should result.
    const orch = new Orchestrator({ maxParallelAgents: 3 }, new FakeWorkspaceProvider());
    const team: Team = { name: "t", roles: [role("lead"), role("coder"), role("tester")] };
    const script: AgentEvent[] = [
      { kind: "output", text: delegateBlock("coder", "impl") + "\n" },
      { kind: "output", text: delegateBlock("tester", "tests") + "\n" },
      { kind: "approval", id: "ap-lead", detail: null },
    ];
    orch.registerAdapter(new FakeEngineAdapter({ id: "lead", script }));
    orch.registerAdapter(pendingAdapter("coder"));
    orch.registerAdapter(pendingAdapter("tester"));

    const proposals: DelegationProposal[] = [];
    orch.on((e) => {
      if (e.kind === "delegation-proposed") proposals.push(e.proposal);
    });
    orch.launchTeam(team, "ship it");
    await new Promise((r) => setTimeout(r, 10));

    expect(proposals.map((p) => p.roleName)).toEqual(["coder", "tester"]);
  });

  it("surfaces both blocks streamed as per-line output events each ending in a newline", async () => {
    // CONTRACT test: mimic the fixed Copilot adapter, which emits ONE output
    // event per complete line, each retaining its trailing "\n". The lead streams
    // two delegate blocks line by line; both directives must surface.
    const orch = new Orchestrator({ maxParallelAgents: 3 }, new FakeWorkspaceProvider());
    const team: Team = { name: "t", roles: [role("lead"), role("writer"), role("tester")] };
    const script: AgentEvent[] = [
      { kind: "output", text: "```delegate\n" },
      { kind: "output", text: "role: writer\n" },
      { kind: "output", text: "task: say hello world\n" },
      { kind: "output", text: "```\n" },
      { kind: "output", text: "```delegate\n" },
      { kind: "output", text: "role: tester\n" },
      { kind: "output", text: "task: write the tests\n" },
      { kind: "output", text: "```\n" },
      { kind: "approval", id: "ap-lead", detail: null },
    ];
    orch.registerAdapter(new FakeEngineAdapter({ id: "lead", script }));
    orch.registerAdapter(pendingAdapter("writer"));
    orch.registerAdapter(pendingAdapter("tester"));

    const proposals: DelegationProposal[] = [];
    orch.on((e) => {
      if (e.kind === "delegation-proposed") proposals.push(e.proposal);
    });
    orch.launchTeam(team, "ship it");
    await new Promise((r) => setTimeout(r, 10));

    expect(proposals.map((p) => p.roleName)).toEqual(["writer", "tester"]);
    expect(proposals.map((p) => p.task)).toEqual(["say hello world", "write the tests"]);
  });

  it("surfaces a delegate block whose closing fence arrives at stream end as the lead finishes", async () => {
    // SCAN-ON-DONE test (drives the fix): the lead streams an open delegate
    // block, then `done` is observed, and only AFTER it does the final flushed
    // line carrying the closing ``` arrive (the realistic stream-end race). The
    // complete block's closing fence is in the buffer but `done` arrived before
    // any post-fence output scan. Before the fix this directive was missed; the
    // teammate must still surface, and approving it must still spawn the teammate.
    const orch = new Orchestrator({ maxParallelAgents: 3 }, new FakeWorkspaceProvider());
    const team: Team = { name: "t", roles: [role("lead"), role("writer")] };
    const script: AgentEvent[] = [
      { kind: "output", text: "```delegate\n" },
      { kind: "output", text: "role: writer\n" },
      { kind: "output", text: "task: say hello world\n" },
      { kind: "done", summary: "all set" },
      { kind: "output", text: "```\n" },
    ];
    orch.registerAdapter(new FakeEngineAdapter({ id: "lead", script }));
    orch.registerAdapter(pendingAdapter("writer"));

    const proposals: DelegationProposal[] = [];
    orch.on((e) => {
      if (e.kind === "delegation-proposed") proposals.push(e.proposal);
    });
    const [lead] = orch.launchTeam(team, "ship it");
    await new Promise((r) => setTimeout(r, 10));

    expect(proposals).toHaveLength(1);
    expect(proposals[0]!.roleName).toBe("writer");
    expect(proposals[0]!.task).toBe("say hello world");
    // The teammate still spawns from the recovered proposal.
    const child = orch.approveDelegation(proposals[0]!.id);
    expect(child.role.name).toBe("writer");
    expect(child.parentId).toBe(lead!.id);
    expect(orch.getAgents()).toHaveLength(2);
  });
});

describe("Orchestrator delegation auto-approve (launchTeam autoApprove)", () => {
  it("spawns the teammate immediately, leaving no pending proposal", async () => {
    const orch = new Orchestrator({ maxParallelAgents: 3 }, new FakeWorkspaceProvider());
    const team: Team = { name: "t", roles: [role("lead"), role("coder")] };
    orch.registerAdapter(leadAdapter("lead", delegateBlock("coder", "build the parser")));
    orch.registerAdapter(pendingAdapter("coder"));

    const resolved: DelegationProposal[] = [];
    orch.on((e) => {
      if (e.kind === "delegation-resolved") resolved.push(e.proposal);
    });

    const [lead] = orch.launchTeam(team, "ship it", { autoApprove: true });
    await new Promise((r) => setTimeout(r, 10));

    // The teammate spawned without any approveDelegation() call.
    const children = orch.getAgents().filter((a) => a.parentId === lead!.id);
    expect(children).toHaveLength(1);
    expect(children[0]!.role.name).toBe("coder");
    expect(children[0]!.task.description).toBe("build the parser");
    expect(orch.getAgents()).toHaveLength(2);

    // The proposal was recorded and resolved as approved, never left pending.
    expect(resolved.map((p) => p.state)).toEqual(["approved"]);
    const delegations = orch.getDelegations();
    expect(delegations).toHaveLength(1);
    expect(delegations[0]!.state).toBe("approved");
    expect(delegations.some((p) => p.state === "pending")).toBe(false);
  });

  it("emits proposed then resolved(approved) in order", async () => {
    const orch = new Orchestrator({ maxParallelAgents: 3 }, new FakeWorkspaceProvider());
    const team: Team = { name: "t", roles: [role("lead"), role("coder")] };
    orch.registerAdapter(leadAdapter("lead", delegateBlock("coder", "x")));
    orch.registerAdapter(pendingAdapter("coder"));

    const seq: string[] = [];
    orch.on((e) => {
      if (e.kind === "delegation-proposed") seq.push(`proposed:${e.proposal.state}`);
      if (e.kind === "delegation-resolved") seq.push(`resolved:${e.proposal.state}`);
    });

    orch.launchTeam(team, "ship it", { autoApprove: true });
    await new Promise((r) => setTimeout(r, 10));

    expect(seq).toEqual(["proposed:pending", "resolved:approved"]);
  });

  it("without autoApprove the proposal stays pending and nothing spawns until approveDelegation", async () => {
    const orch = new Orchestrator({ maxParallelAgents: 3 }, new FakeWorkspaceProvider());
    const team: Team = { name: "t", roles: [role("lead"), role("coder")] };
    orch.registerAdapter(leadAdapter("lead", delegateBlock("coder", "build the parser")));
    orch.registerAdapter(pendingAdapter("coder"));

    const proposalP = waitForProposal(orch);
    orch.launchTeam(team, "ship it");
    const proposal = await proposalP;

    // Default: pending, lead is the only agent.
    expect(proposal.state).toBe("pending");
    expect(orch.getDelegations()[0]!.state).toBe("pending");
    expect(orch.getAgents()).toHaveLength(1);

    // Manual approval still spawns the teammate.
    const child = orch.approveDelegation(proposal.id);
    expect(child.role.name).toBe("coder");
    expect(orch.getAgents()).toHaveLength(2);
  });

  it("ignores a non-teammate directive even under autoApprove (no spawn)", async () => {
    const orch = new Orchestrator({ maxParallelAgents: 3 }, new FakeWorkspaceProvider());
    const team: Team = { name: "t", roles: [role("lead"), role("coder")] };
    orch.registerAdapter(leadAdapter("lead", delegateBlock("ghost", "do something")));
    orch.registerAdapter(pendingAdapter("coder"));

    let proposed = 0;
    let resolved = 0;
    orch.on((e) => {
      if (e.kind === "delegation-proposed") proposed++;
      if (e.kind === "delegation-resolved") resolved++;
    });

    orch.launchTeam(team, "ship it", { autoApprove: true });
    await new Promise((r) => setTimeout(r, 10));

    expect(proposed).toBe(0);
    expect(resolved).toBe(0);
    expect(orch.getDelegations()).toHaveLength(0);
    expect(orch.getAgents()).toHaveLength(1); // only the lead
  });

  it("honors maxParallelAgents: an over-cap auto-approved teammate queues", async () => {
    // Cap of 1: the lead occupies the only running slot (parked on an approval),
    // so the auto-approved teammate must queue (state "preparing", no workspace
    // created yet) rather than start, exactly like a human-approved delegation.
    const workspaces = new FakeWorkspaceProvider();
    const orch = new Orchestrator({ maxParallelAgents: 1 }, workspaces);
    const team: Team = { name: "t", roles: [role("lead"), role("coder")] };
    orch.registerAdapter(leadAdapter("lead", delegateBlock("coder", "build")));
    orch.registerAdapter(pendingAdapter("coder"));

    const [lead] = orch.launchTeam(team, "ship it", { autoApprove: true });
    await new Promise((r) => setTimeout(r, 10));

    const child = orch.getAgents().find((a) => a.parentId === lead!.id);
    expect(child).toBeDefined();
    // Spawned (parented) but queued behind the lead, which holds the only slot.
    expect(child!.state).toBe("preparing");
    // Only the lead's workspace was created; the queued teammate has none yet.
    expect(workspaces.created).toEqual([lead!.id]);
  });
});

describe("Orchestrator lead-driven model (team is a scoped roster of sub-agents)", () => {
  it("lead-driven: the lead is the injected default agent, team roles are its loadable sub-agents", async () => {
    // A team is a SCOPED ROSTER: the lead (the default agent) is always the
    // one launched, and the team's specialist roles are the only sub-agents it
    // may load. The lead is NOT one of the specialist task-doers, and it is never
    // itself spawned as a teammate / sub-agent of itself.
    const orch = new Orchestrator({ maxParallelAgents: 3 }, new FakeWorkspaceProvider());
    const leadRole = role("Lead");
    const roleA = role("roleA");
    const roleB = role("roleB");
    const team: Team = {
      name: "Backend",
      lead: "Lead",
      roles: [leadRole, roleA, roleB],
    };
    // The lead loads roleA as a sub-agent, and also emits a block for a role
    // NOT in the team (roleZ), which must be ignored. The block naming roleB is
    // omitted on purpose, to keep the assertion about a single spawned sub-agent.
    const leadOutput = [
      delegateBlock("roleA", "own the API layer"),
      delegateBlock("roleZ", "this role is not on the team"),
    ].join("\n");
    orch.registerAdapter(leadAdapter("Lead", leadOutput));
    orch.registerAdapter(pendingAdapter("roleA"));
    orch.registerAdapter(pendingAdapter("roleB"));

    const proposed: DelegationProposal[] = [];
    orch.on((e) => {
      if (e.kind === "delegation-proposed") proposed.push(e.proposal);
    });

    // launchTeam spawns ONLY the Lead, not the whole roster.
    const agents = orch.launchTeam(team, "do X", { autoApprove: true });
    expect(agents).toHaveLength(1);
    const lead = agents[0]!;
    expect(lead.role.name).toBe("Lead");
    expect(orch.getAgents()).toHaveLength(1);

    await new Promise((r) => setTimeout(r, 10));

    // Exactly one valid sub-agent surfaced and spawned: roleA. roleZ (off-team)
    // was ignored, never proposed.
    expect(proposed.map((p) => p.roleName)).toEqual(["roleA"]);

    const subAgents = orch.getAgents().filter((a) => a.id !== lead.id);
    expect(subAgents).toHaveLength(1);
    const roleAAgent = subAgents[0]!;
    expect(roleAAgent.role.name).toBe("roleA");
    // It spawned as a child of the Lead, exactly like a CLI main agent
    // loading a sub-agent.
    expect(roleAAgent.parentId).toBe(lead.id);
    expect(roleAAgent.task.description).toBe("own the API layer");

    // Auto-approved: the roleA delegation resolved, no pending proposal remains.
    const delegations = orch.getDelegations();
    expect(delegations).toHaveLength(1);
    expect(delegations[0]!.state).toBe("approved");
    expect(delegations.some((p) => p.state === "pending")).toBe(false);

    // The Lead is never itself spawned as a teammate / sub-agent of itself.
    expect(orch.getAgents().filter((a) => a.role.name === "Lead")).toHaveLength(1);
    expect(orch.getAgents().every((a) => a.parentId !== lead.id || a.id !== lead.id)).toBe(true);
    expect(orch.getAgents().some((a) => a.role.name === "Lead" && a.parentId !== undefined)).toBe(false);
  });
});
