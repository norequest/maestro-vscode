import type { AgentSession, ApprovalDecision, EngineAdapter } from "./adapter.js";
import { Emitter } from "./emitter.js";
import { isTerminalState } from "./events.js";
import type {
  Agent,
  AgentEvent,
  AgentState,
  OrchestratorConfig,
  OrchestratorEvent,
  Role,
  Task,
} from "./types.js";
import type { WorkspaceProvider } from "./workspace.js";

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
    try {
      agent.workspace = await this.workspaces.create(agent.id);
    } catch (error) {
      this.fail(agent, `Workspace creation failed: ${errorMessage(error)}`);
      this.release();
      return;
    }
    this.update(agent, "working");
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
      case "approval":
        agent.pendingApprovalId = event.id;
        this.update(agent, "awaiting-approval");
        break;
      case "status":
        this.update(agent, event.state);
        break;
      case "done":
        agent.summary = event.summary;
        agent.diff = event.diff;
        this.update(agent, "done");
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

  approve(agentId: string, approvalId: string, decision: ApprovalDecision): void {
    const agent = this.requireAgent(agentId);
    if (agent.state !== "awaiting-approval") {
      throw new Error(`Agent ${agentId} is not awaiting approval`);
    }
    const session = this.sessions.get(agentId);
    if (!session) throw new Error(`No active session for ${agentId}`);
    session.respond(approvalId, decision);
    agent.pendingApprovalId = undefined;
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

  private requireAgent(agentId: string): Agent {
    const agent = this.agents.get(agentId);
    if (!agent) throw new Error(`Unknown agent: ${agentId}`);
    return agent;
  }
}
