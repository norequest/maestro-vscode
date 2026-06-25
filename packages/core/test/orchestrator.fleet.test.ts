import { describe, expect, it } from "vitest";
import { Orchestrator } from "../src/orchestrator.js";
import { FakeEngineAdapter } from "../src/fake-adapter.js";
import { FakeWorkspaceManager, FakeWorkspaceProvider } from "../src/workspace.js";
import type { AgentEvent, Role } from "../src/types.js";

const role: Role = {
  name: "Lead",
  instructions: "lead a fleet",
  engine: { id: "fake" },
  autonomy: "manual",
};

/** Resolve once `pred` holds, checking both immediately and on every event. */
function waitFor(orch: Orchestrator, pred: () => boolean): Promise<void> {
  return new Promise((resolve) => {
    const unsub = orch.on(() => {
      if (pred()) {
        unsub();
        resolve();
      }
    });
    if (pred()) {
      unsub();
      resolve();
    }
  });
}

/** The fleet stream a lead's engine emits: two named sub-agents inside one session. */
const fleetScript: AgentEvent[] = [
  { kind: "subagent-started", callId: "call-alpha", name: "scribe-alpha", description: "draft the notes" },
  { kind: "subagent-output", callId: "call-alpha", text: "alpha is drafting" },
  { kind: "subagent-started", callId: "call-beta", name: "scribe-beta", description: "review the notes" },
  { kind: "subagent-output", callId: "call-beta", text: "beta is reviewing" },
  { kind: "subagent-done", callId: "call-alpha", summary: "draft complete" },
  { kind: "subagent-done", callId: "call-beta", summary: "review complete" },
  { kind: "done", summary: "fleet finished", diff: { files: ["notes.md"], patch: "diff" } },
];

describe("Orchestrator fleet sub-agents", () => {
  it("surfaces fleet sub-agents as read-only virtual children sharing the lead's worktree", async () => {
    const workspaces = new FakeWorkspaceManager();
    const orch = new Orchestrator({ maxParallelAgents: 2 }, workspaces);
    orch.registerRole(role);
    orch.registerAdapter(new FakeEngineAdapter({ script: fleetScript }));

    const lead = orch.spawn("Lead", "produce release notes");
    await waitFor(orch, () => orch.getAgent(lead.id)?.state === "done");
    // The lead's own done diff was supplied, so wait until both children
    // have finished too (the lead terminal reconcile would also do this,
    // but here the subagent-done events arrive before the lead's done).
    await waitFor(
      orch,
      () => orch.getAgents().filter((a) => a.virtual).every((a) => a.state === "done"),
    );

    // Only the lead created a worktree: children spawn no process/worktree.
    expect(workspaces.created).toEqual([lead.id]);

    const children = orch.getAgents().filter((a) => a.virtual);
    expect(children).toHaveLength(2);

    const alpha = children.find((c) => c.role.name === "scribe-alpha")!;
    const beta = children.find((c) => c.role.name === "scribe-beta")!;
    expect(alpha).toBeDefined();
    expect(beta).toBeDefined();

    // Nested under the lead, sharing its workspace reference.
    expect(alpha.parentId).toBe(lead.id);
    expect(beta.parentId).toBe(lead.id);
    expect(alpha.workspace).toBe(orch.getAgent(lead.id)!.workspace);
    expect(beta.workspace).toBe(orch.getAgent(lead.id)!.workspace);

    // Each received its own output in its log.
    expect(alpha.log).toEqual([{ kind: "output", text: "alpha is drafting" }]);
    expect(beta.log).toEqual([{ kind: "output", text: "beta is reviewing" }]);

    // Both ended done with the closing summary.
    expect(alpha.state).toBe("done");
    expect(beta.state).toBe("done");
    expect(alpha.summary).toBe("draft complete");
    expect(beta.summary).toBe("review complete");

    // Read-only: no own engine session capabilities.
    expect(alpha.virtual).toBe(true);
    expect(beta.virtual).toBe(true);
    expect(alpha.engineCapabilities).toEqual({ approvals: false, steerable: false });
    expect(beta.engineCapabilities).toEqual({ approvals: false, steerable: false });

    // No diff was ever computed for a virtual child (it has no branch).
    expect(workspaces.diffed).not.toContain(alpha.id);
    expect(workspaces.diffed).not.toContain(beta.id);
  });

  it("rejects merge and approve on a virtual child with a clear error", async () => {
    const workspaces = new FakeWorkspaceManager();
    const orch = new Orchestrator({ maxParallelAgents: 2 }, workspaces);
    orch.registerRole(role);
    orch.registerAdapter(new FakeEngineAdapter({ script: fleetScript }));

    const lead = orch.spawn("Lead", "produce release notes");
    await waitFor(orch, () => orch.getAgents().some((a) => a.virtual));
    const child = orch.getAgents().find((a) => a.virtual)!;

    await expect(orch.merge(child.id)).rejects.toThrow(/merge is not available for a fleet sub-agent/i);
    expect(() => orch.approve(child.id, "any", "allow")).toThrow(
      /approve is not available for a fleet sub-agent/i,
    );

    // Let the lead finish so the run drains cleanly.
    await waitFor(orch, () => orch.getAgent(lead.id)?.state === "done");
  });

  it("rejects steer, sendBack, and discard on a virtual child too", async () => {
    const workspaces = new FakeWorkspaceManager();
    const orch = new Orchestrator({ maxParallelAgents: 2 }, workspaces);
    orch.registerRole(role);
    orch.registerAdapter(new FakeEngineAdapter({ script: fleetScript }));

    const lead = orch.spawn("Lead", "produce release notes");
    await waitFor(orch, () => orch.getAgents().some((a) => a.virtual));
    const child = orch.getAgents().find((a) => a.virtual)!;

    expect(() => orch.steer(child.id, "do more")).toThrow(/steer is not available for a fleet sub-agent/i);
    expect(() => orch.sendBack(child.id, "again")).toThrow(/send back is not available for a fleet sub-agent/i);
    await expect(orch.discard(child.id)).rejects.toThrow(/discard is not available for a fleet sub-agent/i);

    await waitFor(orch, () => orch.getAgent(lead.id)?.state === "done");
  });

  it("reconciles a still-working child to done when the lead finishes first", async () => {
    // The lead finishes WITHOUT a subagent-done for the started child: the
    // child must not hang as "working".
    const script: AgentEvent[] = [
      { kind: "subagent-started", callId: "call-x", name: "worker-x", description: "do x" },
      { kind: "subagent-output", callId: "call-x", text: "x is working" },
      { kind: "done", summary: "lead finished early" },
    ];
    const workspaces = new FakeWorkspaceManager();
    const orch = new Orchestrator({ maxParallelAgents: 2 }, workspaces);
    orch.registerRole(role);
    orch.registerAdapter(new FakeEngineAdapter({ script }));

    const lead = orch.spawn("Lead", "run a fleet");
    await waitFor(orch, () => orch.getAgent(lead.id)?.state === "done");

    const child = orch.getAgents().find((a) => a.virtual)!;
    expect(child).toBeDefined();
    expect(child.state).toBe("done");
  });

  it("synthesizes an ad-hoc role when the sub-agent name is not registered", async () => {
    const script: AgentEvent[] = [
      { kind: "subagent-started", callId: "call-1", name: "unregistered-helper" },
      { kind: "subagent-done", callId: "call-1" },
      { kind: "done", summary: "ok" },
    ];
    const workspaces = new FakeWorkspaceProvider();
    const orch = new Orchestrator({ maxParallelAgents: 2 }, workspaces);
    orch.registerRole(role);
    orch.registerAdapter(new FakeEngineAdapter({ script }));

    const lead = orch.spawn("Lead", "run a fleet");
    await waitFor(orch, () => orch.getAgent(lead.id)?.state === "done");

    const child = orch.getAgents().find((a) => a.virtual)!;
    expect(child.role.name).toBe("unregistered-helper");
    // Ad-hoc role inherits the lead's engine id and is description-defaulted to its name.
    expect(child.role.engine.id).toBe(role.engine.id);
    expect(child.task.description).toBe("unregistered-helper");
    expect(child.state).toBe("done");
  });

  it("ignores subagent-output/done for an unknown callId", async () => {
    const script: AgentEvent[] = [
      { kind: "subagent-output", callId: "ghost", text: "nobody listening" },
      { kind: "subagent-done", callId: "ghost" },
      { kind: "done", summary: "ok" },
    ];
    const workspaces = new FakeWorkspaceProvider();
    const orch = new Orchestrator({ maxParallelAgents: 2 }, workspaces);
    orch.registerRole(role);
    orch.registerAdapter(new FakeEngineAdapter({ script }));

    const lead = orch.spawn("Lead", "run a fleet");
    await waitFor(orch, () => orch.getAgent(lead.id)?.state === "done");

    // No virtual child was ever created; only the lead exists.
    expect(orch.getAgents()).toHaveLength(1);
    expect(orch.getAgent(lead.id)!.state).toBe("done");
  });

  it("does not rehydrate a virtual child as an independent agent", () => {
    const orch = new Orchestrator({ maxParallelAgents: 2 }, new FakeWorkspaceProvider());
    orch.hydrate([
      {
        agent: {
          id: "lead-1",
          task: { id: "t", description: "lead", roleName: "Lead" },
          role,
          state: "done",
          log: [],
        },
      },
      {
        agent: {
          id: "virtual-1",
          task: { id: "tv", description: "sub", roleName: "scribe-alpha" },
          role: { name: "scribe-alpha", instructions: "", engine: { id: "fake" }, autonomy: "manual" },
          state: "working",
          log: [],
          parentId: "lead-1",
          virtual: true,
        },
      },
    ]);

    expect(orch.getAgent("lead-1")).toBeDefined();
    expect(orch.getAgent("virtual-1")).toBeUndefined();
  });
});
