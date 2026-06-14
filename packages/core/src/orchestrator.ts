import type { AgentSession, ApprovalDecision, EngineAdapter } from "./adapter.js";
import { Emitter } from "./emitter.js";
import { isTerminalState } from "./events.js";
import type {
  Agent,
  AgentEvent,
  AgentState,
  MergeResult,
  OrchestratorConfig,
  OrchestratorEvent,
  PersistedAgentRecord,
  Role,
  Task,
} from "./types.js";
import { isWorkspaceManager, type WorkspaceProvider } from "./workspace.js";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class Orchestrator {
  private readonly agents = new Map<string, Agent>();
  private readonly sessions = new Map<string, AgentSession>();
  private readonly roles = new Map<string, Role>();
  private readonly adapters = new Map<string, EngineAdapter>();
  private readonly queue: string[] = [];
  private readonly stopping = new Set<string>();
  private readonly emitter = new Emitter<OrchestratorEvent>();
  private readonly idGen: () => string;
  private running = 0;
  // Merges serialize: each call chains onto this lock before touching the git index.
  private mergeLock: Promise<void> = Promise.resolve();

  constructor(
    private readonly config: OrchestratorConfig,
    private readonly workspaces: WorkspaceProvider,
    idGen?: () => string,
  ) {
    let n = 0;
    this.idGen = idGen ?? (() => `agent-${++n}`);
  }

  registerAdapter(adapter: EngineAdapter): void {
    this.adapters.set(adapter.id, adapter);
  }

  registerRole(role: Role): void {
    this.roles.set(role.name, role);
  }

  on(listener: (event: OrchestratorEvent) => void): () => void {
    return this.emitter.on(listener);
  }

  getAgents(): Agent[] {
    return [...this.agents.values()];
  }

  getAgent(id: string): Agent | undefined {
    return this.agents.get(id);
  }

  spawn(roleName: string, description: string): Agent {
    const role = this.roles.get(roleName);
    if (!role) throw new Error(`Unknown role: ${roleName}`);
    const id = this.idGen();
    const task: Task = { id: `task-${id}`, description, roleName };
    const agent: Agent = { id, task, role, state: "preparing", log: [] };
    this.agents.set(id, agent);
    this.emitter.emit({ kind: "agent-added", agent });
    this.tryStart(agent);
    return agent;
  }

  private tryStart(agent: Agent): void {
    if (this.running >= this.config.maxParallelAgents) {
      this.queue.push(agent.id);
      return;
    }
    this.running++;
    void this.launch(agent);
  }

  private async launch(agent: Agent): Promise<void> {
    const adapter = this.adapters.get(agent.role.engine.id);
    if (!adapter) {
      this.fail(agent, `No adapter for engine ${agent.role.engine.id}`);
      this.release();
      return;
    }
    if (!agent.workspace) {
      try {
        agent.workspace = await this.workspaces.create(agent.id);
      } catch (error) {
        this.fail(agent, `Workspace creation failed: ${errorMessage(error)}`);
        this.release();
        return;
      }
    }
    this.update(agent, "working");
    agent.engineCapabilities = {
      approvals: adapter.capabilities.approvals,
      steerable: adapter.capabilities.steerable,
    };
    let session: AgentSession;
    try {
      session = adapter.start(agent.task, agent.workspace, agent.role);
    } catch (error) {
      this.fail(agent, `Engine failed to start: ${errorMessage(error)}`);
      this.release();
      return;
    }
    this.sessions.set(agent.id, session);
    void this.consume(agent, session);
  }

  private async consume(agent: Agent, session: AgentSession): Promise<void> {
    try {
      for await (const event of session.events) {
        agent.log.push(event);
        this.emitter.emit({ kind: "agent-event", agentId: agent.id, event });
        this.applyEvent(agent, event);
      }
      if (agent.state === "working" || agent.state === "awaiting-approval") {
        if (this.stopping.has(agent.id)) {
          this.update(agent, "stopped");
        } else {
          this.fail(agent, "Engine stream ended without a terminal event");
        }
      }
    } catch (error) {
      this.fail(agent, `Session error: ${errorMessage(error)}`);
    } finally {
      this.stopping.delete(agent.id);
      this.sessions.delete(agent.id);
      this.release();
    }
  }

  private applyEvent(agent: Agent, event: AgentEvent): void {
    if (isTerminalState(agent.state)) return;
    switch (event.kind) {
      case "approval": {
        agent.pendingApprovalId = event.id;
        const d = event.detail;
        if (d !== null && typeof d === "object" && "tool" in d && "description" in d) {
          const rec = d as Record<string, unknown>;
          agent.approvalDetail = {
            tool: String(rec["tool"]),
            description: String(rec["description"]),
          };
        }
        this.update(agent, "awaiting-approval");
        break;
      }
      case "status":
        this.update(agent, event.state);
        break;
      case "done":
        agent.summary = event.summary;
        agent.diff = event.diff;
        this.update(agent, "done");
        if (event.diff === undefined) this.computeDiff(agent);
        break;
      case "error":
        this.fail(agent, event.message);
        break;
      case "output":
      case "action":
        break;
    }
  }

  private release(): void {
    this.running--;
    const nextId = this.queue.shift();
    if (nextId) {
      const agent = this.agents.get(nextId);
      if (agent) this.tryStart(agent);
    }
  }

  private update(agent: Agent, state: AgentState): void {
    agent.state = state;
    this.emitter.emit({ kind: "agent-updated", agent });
  }

  private fail(agent: Agent, message: string): void {
    agent.error = message;
    this.update(agent, "error");
  }

  private computeDiff(agent: Agent): void {
    if (!isWorkspaceManager(this.workspaces)) return; // plain provider -> no-op
    const ws = this.workspaces;
    void ws
      .diff(agent.id)
      .then((diff) => {
        if (agent.diff !== undefined) return; // adapter won the race
        agent.diff = diff;
        this.emitter.emit({ kind: "agent-updated", agent });
      })
      .catch((error) => {
        if (agent.diff !== undefined) return; // diff already populated; ignore late failure
        agent.diffError = errorMessage(error);
        this.emitter.emit({ kind: "agent-updated", agent });
      });
  }

  approve(agentId: string, approvalId: string, decision: ApprovalDecision): void {
    const agent = this.requireAgent(agentId);
    if (agent.state !== "awaiting-approval") {
      throw new Error(`Agent ${agentId} is not awaiting approval`);
    }
    const session = this.sessions.get(agentId);
    if (!session) throw new Error(`No active session for ${agentId}`);
    session.respond(approvalId, decision);
    agent.pendingApprovalId = undefined;
    agent.approvalDetail = undefined;
    this.update(agent, "working");
  }

  steer(agentId: string, input: string): void {
    const session = this.sessions.get(agentId);
    if (!session) throw new Error(`No active session for ${agentId}`);
    session.send(input);
  }

  stop(agentId: string): void {
    const session = this.sessions.get(agentId);
    if (!session) return;
    this.stopping.add(agentId);
    session.stop();
  }

  async merge(agentId: string): Promise<MergeResult> {
    const agent = this.requireAgent(agentId);
    if (agent.state !== "done" && agent.state !== "detached") {
      throw new Error(`Agent ${agentId} is not ready to merge (state: ${agent.state})`);
    }
    const ws = this.workspaces;
    if (!isWorkspaceManager(ws)) {
      throw new Error("Workspace provider does not support merge");
    }
    let releaseLock!: () => void;
    const acquired = new Promise<void>((r) => { releaseLock = r; });
    const prev = this.mergeLock;
    this.mergeLock = prev.then(() => acquired);
    await prev;
    try {
      const result = await ws.merge(agentId);
      if (result.status === "conflict") {
        agent.conflict = { files: result.files };
        this.update(agent, "conflict");
        return result;
      }
      // Clean merge: the code is landed. A cleanup failure must NOT hide the
      // successful merge; surface it as a distinct terminal state.
      try {
        await ws.cleanup(agentId);
        this.update(agent, "merged");
      } catch (cleanupError) {
        agent.error = `Merge succeeded but worktree cleanup failed: ${errorMessage(cleanupError)}`;
        this.update(agent, "merge-cleanup-failed");
      }
      return result;
    } finally {
      releaseLock();
    }
  }

  async retryCleanup(agentId: string): Promise<void> {
    const agent = this.requireAgent(agentId);
    if (agent.state !== "merge-cleanup-failed") {
      throw new Error(`Agent ${agentId} is not in merge-cleanup-failed state`);
    }
    const ws = this.workspaces;
    if (!isWorkspaceManager(ws)) {
      throw new Error("Workspace provider does not support cleanup");
    }
    await ws.cleanup(agentId);
    agent.error = undefined;
    this.update(agent, "merged");
  }

  /**
   * After an external conflict resolution (user fixed markers, resolveMerge
   * returned clean, cleanup ran), move the agent from conflict to merged.
   */
  finishConflictResolution(agentId: string): void {
    const agent = this.requireAgent(agentId);
    if (agent.state !== "conflict") {
      throw new Error(`Agent ${agentId} is not in conflict state (state: ${agent.state})`);
    }
    agent.conflict = undefined;
    this.update(agent, "merged");
  }

  async discard(agentId: string): Promise<void> {
    const agent = this.requireAgent(agentId);
    if (!this.canDiscard(agent.state)) {
      throw new Error(`Agent ${agentId} cannot be discarded (state: ${agent.state})`);
    }
    const ws = this.workspaces;
    if (isWorkspaceManager(ws)) {
      await ws.discard(agentId);
    } else {
      await ws.cleanup(agentId);
    }
    this.update(agent, "discarded");
  }

  /**
   * Restore agent records from a previous session WITHOUT re-spawning, creating
   * worktrees, or starting sessions. Emits agent-added (then replays the agent's
   * persisted log as agent-event so subscribers reconstruct scrollback). Agents
   * that were genuinely mid-run (working, awaiting-approval, preparing) are
   * transitioned to "detached" (process gone, worktree preserved on disk).
   * Conflict and terminal states are preserved as-is. Never touches the running
   * counter, the queue, or the sessions map.
   */
  hydrate(records: readonly PersistedAgentRecord[]): void {
    for (const record of records) {
      const agent: Agent = { ...record.agent };
      if (agent.workspace === undefined && record.workspacePath !== undefined) {
        agent.workspace = {
          agentId: agent.id,
          path: record.workspacePath,
          branch: record.workspaceBranch ?? "",
        };
      }
      this.agents.set(agent.id, agent);
      this.emitter.emit({ kind: "agent-added", agent });
      for (const event of agent.log) {
        this.emitter.emit({ kind: "agent-event", agentId: agent.id, event });
      }
      if (
        agent.state === "working" ||
        agent.state === "awaiting-approval" ||
        agent.state === "preparing"
      ) {
        agent.state = "detached";
        this.emitter.emit({ kind: "agent-updated", agent });
      }
    }
  }

  /**
   * Re-launch a done or conflict agent in its EXISTING worktree with feedback
   * appended to the task description. The previous session already ended; the
   * worktree is reused (launch() skips create when agent.workspace is set), so
   * partial work on disk is preserved. done|conflict -> preparing -> working.
   */
  sendBack(agentId: string, feedback: string): Agent {
    const agent = this.requireAgent(agentId);
    if (agent.state !== "done" && agent.state !== "conflict") {
      throw new Error(
        `Cannot send back agent ${agentId} (state: ${agent.state}); only done or conflict agents can be sent back`,
      );
    }
    agent.summary = undefined;
    agent.diff = undefined;
    agent.diffError = undefined;
    agent.conflict = undefined;
    agent.error = undefined;
    agent.pendingApprovalId = undefined;
    agent.approvalDetail = undefined;
    agent.log = [];
    agent.task = {
      ...agent.task,
      description: `${agent.task.description}\n\nConductor feedback: ${feedback}`,
    };
    this.update(agent, "preparing");
    this.tryStart(agent);
    return agent;
  }

  private canDiscard(state: AgentState): boolean {
    return (
      state === "done" ||
      state === "error" ||
      state === "stopped" ||
      state === "conflict" ||
      state === "detached" ||
      state === "merge-cleanup-failed"
    );
  }

  private requireAgent(agentId: string): Agent {
    const agent = this.agents.get(agentId);
    if (!agent) throw new Error(`Unknown agent: ${agentId}`);
    return agent;
  }
}
