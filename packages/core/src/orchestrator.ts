import type { AgentSession, ApprovalDecision, EngineAdapter } from "./adapter.js";
import { buildLeadBrief, parseDelegateDirectives } from "./delegation.js";
import { Emitter } from "./emitter.js";
import { isDiscardableState, isTerminalState } from "./events.js";
import type {
  Agent,
  AgentDefaults,
  AgentEvent,
  AgentState,
  DelegationProposal,
  DispatchSpec,
  MergeResult,
  OrchestratorConfig,
  OrchestratorEvent,
  PersistedAgentRecord,
  PreambleResolver,
  Role,
  SpawnOptions,
  Task,
  Team,
} from "./types.js";
import { isWorkspaceManager, type WorkspaceManager, type WorkspaceProvider } from "./workspace.js";

/** Per-lead bookkeeping for parsing delegation directives out of the stream. */
interface LeadContext {
  team: Team;
  leadRoleName: string;
  /** Accumulated lead output, scanned for complete ```delegate blocks. */
  buffer: string;
  /** role+task keys already turned into proposals, so a growing buffer never re-proposes. */
  seen: Set<string>;
  /**
   * When true, a valid teammate delegation is approved the instant it is parsed
   * (reusing the human-approval spawn path, so maxParallelAgents still applies),
   * instead of waiting as a pending proposal. Default false: behavior unchanged.
   */
  autoApprove: boolean;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** De-duplicate a list of names, preserving the FIRST occurrence of each. */
function dedupe(names: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of names) {
    if (seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

export class Orchestrator {
  private readonly agents = new Map<string, Agent>();
  private readonly sessions = new Map<string, AgentSession>();
  private readonly roles = new Map<string, Role>();
  private readonly adapters = new Map<string, EngineAdapter>();
  private readonly queue: string[] = [];
  private readonly stopping = new Set<string>();
  // Per-agent run generation, bumped on each launch and sendBack. An async
  // diff-on-done captures the generation at kickoff and bails if it changed, so
  // a late diff cannot land on a now-relaunched agent.
  private readonly generations = new Map<string, number>();
  private readonly emitter = new Emitter<OrchestratorEvent>();
  private readonly idGen: () => string;
  // Lead agents whose output is scanned for delegation directives, keyed by agent id.
  private readonly leads = new Map<string, LeadContext>();
  // Fleet sub-agents: maps a lead's engine toolCallId to the virtual child's
  // agent id. Keyed by `${leadId}::${callId}` so two leads that reuse
  // the same callId never collide.
  private readonly subAgentByCall = new Map<string, string>();
  // Delegation proposals awaiting (or past) the lead's approval, keyed by id.
  private readonly delegations = new Map<string, DelegationProposal>();
  private delegationSeq = 0;
  private running = 0;
  // Merges serialize: each call chains onto this lock before touching the git index.
  private mergeLock: Promise<void> = Promise.resolve();
  private preambleResolver?: PreambleResolver;
  // Config-driven DEFAULT layer composed into every spawn's effective role.
  // Empty by default, so without a setDefaults call spawn behavior is unchanged.
  private defaults: AgentDefaults = {};

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

  setPreambleResolver(fn: PreambleResolver): void {
    this.preambleResolver = fn;
  }

  /**
   * Set the config-driven DEFAULT layer composed into every agent's preamble.
   * General `instructions`/`skills` apply to all agents; `leadSkills` only to the
   * lead. Optional and back-compatible: not calling this leaves spawn unchanged.
   */
  setDefaults(d: AgentDefaults): void {
    this.defaults = d;
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

  spawn(roleName: string, description: string, opts: SpawnOptions = {}): Agent {
    const base = this.roles.get(roleName);
    if (!base) throw new Error(`Unknown role: ${roleName}`);
    const role = this.effectiveRole(base, opts);
    const id = this.idGen();
    const task: Task = {
      id: `task-${id}`,
      description,
      roleName,
      ...(opts.goal !== undefined ? { goal: opts.goal } : {}),
      ...(opts.agentProfiles !== undefined ? { agentProfiles: opts.agentProfiles } : {}),
    };
    const agent: Agent = {
      id,
      task,
      role,
      state: "preparing",
      log: [],
      ...(opts.parentId !== undefined ? { parentId: opts.parentId } : {}),
    };
    this.agents.set(id, agent);
    this.emitter.emit({ kind: "agent-added", agent });
    this.tryStart(agent);
    return agent;
  }

  /**
   * Build the EFFECTIVE role for one spawn: the registered role with the
   * config-driven DEFAULT layer and any per-dispatch overrides folded in, WITHOUT
   * mutating the registered role.
   *
   * Instructions order (general layer applies to ALL agents): defaults.instructions
   * first, then the per-agent prefix (e.g. the lead brief), then the role's own
   * instructions. Each segment is omitted when empty, so a role with no defaults and
   * no prefix is returned untouched.
   *
   * Skills: defaults.skills (all agents), then defaults.leadSkills (lead only),
   * then the role's own skills, de-duplicated by name preserving first occurrence.
   * The injected preamble resolver resolves these merged names, so the default
   * skills ride in on role.skills for free with no resolver change.
   */
  private effectiveRole(base: Role, opts: SpawnOptions): Role {
    const instructions = [
      this.defaults.instructions?.trim() ? this.defaults.instructions : undefined,
      opts.instructionsPrefix,
      base.instructions,
    ]
      .filter((s): s is string => s !== undefined && s !== "")
      .join("\n\n");

    const mergedSkills = dedupe([
      ...(this.defaults.skills ?? []),
      ...(opts.isLead ? (this.defaults.leadSkills ?? []) : []),
      ...(base.skills ?? []),
    ]);

    const engineChanged = opts.engineId !== undefined || opts.model !== undefined;
    const instructionsChanged = instructions !== base.instructions;
    const skillsChanged = mergedSkills.length !== (base.skills?.length ?? 0);
    // Nothing to fold in: return the registered role untouched (cheap, and keeps
    // identity-equality for callers that compare against the registered role).
    if (!engineChanged && !instructionsChanged && !skillsChanged) return base;

    return {
      ...base,
      engine: {
        id: opts.engineId ?? base.engine.id,
        ...((opts.model ?? base.engine.model) !== undefined
          ? { model: opts.model ?? base.engine.model }
          : {}),
      },
      instructions,
      ...(mergedSkills.length > 0 ? { skills: mergedSkills } : {}),
    };
  }

  dispatch(spec: DispatchSpec): Agent {
    if (spec.roleName) {
      return this.spawn(spec.roleName, spec.description, {
        ...(spec.goal !== undefined ? { goal: spec.goal } : {}),
        ...(spec.engineId !== undefined ? { engineId: spec.engineId } : {}),
        ...(spec.model !== undefined ? { model: spec.model } : {}),
      });
    }
    if (spec.newRoleName) {
      const role: Role = {
        name: spec.newRoleName,
        instructions: `Ad-hoc role dispatched from the Board. ${spec.description}`,
        engine: {
          id: spec.engineId ?? "copilot",
          ...(spec.model !== undefined ? { model: spec.model } : {}),
        },
        autonomy: "auto-approve-safe",
      };
      this.registerRole(role);
      return this.spawn(role.name, spec.description, spec.goal !== undefined ? { goal: spec.goal } : {});
    }
    throw new Error("dispatch requires either roleName or newRoleName");
  }

  /**
   * Dispatch a team lead-first. Every role is registered (so a later delegation
   * resolves it by name), then ONLY the lead is spawned, with a brief that names
   * its teammates and teaches the delegation format. The lead does small work
   * itself and delegates the rest; each delegation becomes a proposal the
   * lead approves (see approveDelegation). Returns the single lead agent in
   * a one-element array, or [] for an empty team.
   *
   * The lead is `team.lead` when set (and present in `roles`), else the first
   * role. The lead inherits the concurrency queue exactly as spawn() does.
   *
   * With `opts.autoApprove`, the lead's delegations to VALID teammates spawn
   * immediately (no pending human approval), reusing the same approve+spawn path
   * so maxParallelAgents is still respected. Unknown/self roles are never
   * auto-approved. Without it, behavior is unchanged.
   */
  launchTeam(team: Team, description: string, opts: { autoApprove?: boolean } = {}): Agent[] {
    for (const role of team.roles) this.registerRole(role);
    const lead =
      (team.lead !== undefined ? team.roles.find((r) => r.name === team.lead) : undefined) ??
      team.roles[0];
    if (!lead) return [];
    const agent = this.spawn(lead.name, description, {
      instructionsPrefix: buildLeadBrief(team, lead),
      // The lead holds the team roster, so the lead-only default skills apply.
      isLead: true,
    });
    this.leads.set(agent.id, {
      team,
      leadRoleName: lead.name,
      buffer: "",
      seen: new Set(),
      autoApprove: opts.autoApprove ?? false,
    });
    return [agent];
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
    // Bump the run generation so any in-flight diff-on-done from a previous run
    // can detect it is stale and bail.
    this.generations.set(agent.id, (this.generations.get(agent.id) ?? 0) + 1);
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
    // A stop() that arrived while the workspace was being created leaves the
    // agent preparing with no session. Honor that intent now: do NOT start the
    // engine, finish in "stopped", and release the slot this launch consumed.
    if (this.stopping.has(agent.id)) {
      this.stopping.delete(agent.id);
      this.update(agent, "stopped");
      this.release();
      return;
    }
    if (this.preambleResolver) {
      try {
        const resolved = await this.preambleResolver(agent.role);
        if (resolved.soulDoc !== undefined) agent.task = { ...agent.task, soulDoc: resolved.soulDoc };
        if (resolved.skills !== undefined) agent.task = { ...agent.task, skills: resolved.skills };
      } catch {
        // resolver failure is non-fatal; continue without soul/skills
      }
    }
    // Materialize the task's skills into the worktree so the engine can discover
    // and load them on demand (skills are advertised by name in the preamble, not
    // inlined). Guarded: only when the provider is a manager that supports
    // writeSkills and the task actually carries skills; otherwise a no-op.
    if (
      typeof (this.workspaces as Partial<WorkspaceManager>).writeSkills === "function" &&
      agent.task.skills &&
      agent.task.skills.length > 0
    ) {
      try {
        await (this.workspaces as WorkspaceManager).writeSkills!(agent.id, agent.task.skills);
      } catch {
        // materialization failure is non-fatal; the engine just lacks the files
      }
    }
    // Materialize the task's agent profiles into the worktree at
    // .github/agents/<name>.agent.md so the engine discovers them as worktree-local
    // custom agents instead of the user's global ~/.copilot/agents. Guarded: only
    // when the provider is a manager that supports writeAgentProfiles and the task
    // actually carries profiles; otherwise a no-op.
    if (
      typeof (this.workspaces as Partial<WorkspaceManager>).writeAgentProfiles === "function" &&
      agent.task.agentProfiles &&
      agent.task.agentProfiles.length > 0
    ) {
      try {
        await (this.workspaces as WorkspaceManager).writeAgentProfiles!(agent.id, agent.task.agentProfiles);
      } catch {
        // materialization failure is non-fatal; the engine just lacks the files
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
    if (isTerminalState(agent.state)) {
      // A lead can finish (done) and still flush a final output line carrying the
      // closing ``` of a delegate block. That trailing output lands AFTER the
      // terminal event, so the normal output handler below never runs for it.
      // Keep accumulating and scanning a finished lead's output so a block that
      // only closes at stream end is still surfaced. Dedupe (lead.seen) makes
      // this idempotent, so already-proposed directives are never double-proposed.
      if (event.kind === "output") {
        const lead = this.leads.get(agent.id);
        if (lead) this.scanDelegations(agent, lead, event.text);
      }
      return;
    }
    // A stop() in flight wins over a late terminal event from the dying engine.
    // A killed CLI can still flush a final `done` (exit 0) or `error`; without
    // this, that event would mark the agent done/error and the user's Stop would
    // be silently ignored (the agent would look finished, even mergeable).
    if (this.stopping.has(agent.id) && (event.kind === "done" || event.kind === "error")) {
      this.update(agent, "stopped");
      return;
    }
    switch (event.kind) {
      case "approval": {
        agent.pendingApprovalId = event.id;
        const d = event.detail;
        if (d !== null && typeof d === "object" && "tool" in d && "description" in d) {
          const rec = d as Record<string, unknown>;
          // `in` only proves the key exists, not that it is a string. Only set
          // approvalDetail when BOTH are actually strings; never String()-coerce
          // a non-string into "[object Object]". The agent still parks in
          // awaiting-approval, the panel just shows no specific detail.
          if (typeof rec["tool"] === "string" && typeof rec["description"] === "string") {
            agent.approvalDetail = {
              tool: rec["tool"],
              description: rec["description"],
            };
          }
        }
        this.update(agent, "awaiting-approval");
        break;
      }
      case "status":
        this.update(agent, event.state);
        break;
      case "done": {
        agent.summary = event.summary;
        agent.diff = event.diff;
        // The `done` event carries summary/diff, not output text. If a complete
        // ```delegate block is sitting in the lead's buffer exactly when
        // completion arrives (the block closed at stream end), no further output
        // event will trigger a scan. Do one final defensive scan of the existing
        // buffer (text "") before marking terminal. scanDelegations reuses the
        // lead's `seen` set, so already-proposed directives are not re-proposed.
        const lead = this.leads.get(agent.id);
        if (lead) this.scanDelegations(agent, lead, "");
        this.update(agent, "done");
        if (event.diff === undefined) this.computeDiff(agent);
        break;
      }
      case "error":
        this.fail(agent, event.message);
        break;
      case "output": {
        const lead = this.leads.get(agent.id);
        if (lead) this.scanDelegations(agent, lead, event.text);
        break;
      }
      case "action":
        break;
      case "subagent-started":
        // Only a real lead (a live, non-virtual agent) materializes a child.
        // A virtual agent has no session of its own, so it never sees these.
        if (!agent.virtual) this.startSubAgent(agent, event.callId, event.name, event.description);
        break;
      case "subagent-output":
        if (!agent.virtual) this.outputSubAgent(agent, event.callId, event.text);
        break;
      case "subagent-done":
        if (!agent.virtual) this.doneSubAgent(agent, event.callId, event.summary);
        break;
    }
  }

  /** Compose the map key that scopes a sub-agent callId to its lead. */
  private subAgentKey(leadId: string, callId: string): string {
    return `${leadId}::${callId}`;
  }

  /**
   * Surface a fleet sub-agent reported on a lead's stream as a READ-ONLY
   * virtual child. No process and no worktree is created: it shares the
   * lead's workspace reference, has no engine session of its own, and the
   * lead remains the single reviewable/mergeable unit. The role is resolved
   * by name from the registry when present, else synthesized ad-hoc.
   */
  private startSubAgent(
    lead: Agent,
    callId: string,
    name: string,
    description?: string,
  ): void {
    const role: Role = this.roles.get(name) ?? {
      name,
      instructions: "",
      engine: { id: lead.role.engine.id },
      autonomy: "manual",
    };
    const id = this.idGen();
    const task: Task = {
      id: `task-${id}`,
      description: description ?? name,
      roleName: name,
    };
    const child: Agent = {
      id,
      task,
      role,
      state: "working",
      log: [],
      parentId: lead.id,
      // Shared reference to the lead's workspace; may be undefined if the
      // lead has none yet, which is fine (a virtual child never merges).
      workspace: lead.workspace,
      engineCapabilities: { approvals: false, steerable: false },
      virtual: true,
    };
    this.agents.set(id, child);
    this.subAgentByCall.set(this.subAgentKey(lead.id, callId), id);
    this.emitter.emit({ kind: "agent-added", agent: child });
  }

  /** Route a sub-agent's output into its virtual child's log; ignore if unknown. */
  private outputSubAgent(lead: Agent, callId: string, text: string): void {
    const childId = this.subAgentByCall.get(this.subAgentKey(lead.id, callId));
    if (childId === undefined) return; // unknown callId: ignore silently
    const child = this.agents.get(childId);
    if (!child) return;
    const event: AgentEvent = { kind: "output", text };
    child.log.push(event);
    this.emitter.emit({ kind: "agent-event", agentId: child.id, event });
  }

  /** Finish a virtual child in "done"; never computes a diff (it has no branch). */
  private doneSubAgent(lead: Agent, callId: string, summary?: string): void {
    const childId = this.subAgentByCall.get(this.subAgentKey(lead.id, callId));
    if (childId === undefined) return; // unknown callId: ignore silently
    const child = this.agents.get(childId);
    if (!child || isTerminalState(child.state)) return;
    if (summary !== undefined) child.summary = summary;
    this.update(child, "done");
  }

  /**
   * When a lead reaches a terminal state, move any of its still-non-terminal
   * virtual children to "done" so they do not hang as "working" forever (e.g. a
   * sub-agent whose subagent-done never arrived because the session ended).
   */
  private reconcileVirtualChildren(leadId: string): void {
    for (const agent of this.agents.values()) {
      if (agent.virtual && agent.parentId === leadId && !isTerminalState(agent.state)) {
        this.update(agent, "done");
      }
    }
  }

  /**
   * Accumulate a lead's output and turn each new complete ```delegate block into
   * a pending DelegationProposal. Deduped by role+task so a growing buffer never
   * re-proposes an earlier block. A block naming an unknown role or the lead
   * itself is recorded as seen (so it is not re-evaluated) and otherwise ignored.
   */
  private scanDelegations(agent: Agent, lead: LeadContext, text: string): void {
    lead.buffer += text;
    for (const directive of parseDelegateDirectives(lead.buffer)) {
      const key = `${directive.role} ${directive.task}`;
      if (lead.seen.has(key)) continue;
      lead.seen.add(key);
      const isTeammate =
        directive.role !== lead.leadRoleName &&
        lead.team.roles.some((r) => r.name === directive.role);
      if (!isTeammate) continue; // unknown or self target: ignore
      const proposal: DelegationProposal = {
        id: `delegation-${++this.delegationSeq}`,
        leadAgentId: agent.id,
        roleName: directive.role,
        task: directive.task,
        state: "pending",
      };
      this.delegations.set(proposal.id, proposal);
      this.emitter.emit({ kind: "delegation-proposed", proposal });
      // Auto-approve path (default-lead launch): a vetted teammate spawns at once
      // through the SAME approval+spawn helper a human click would use, so the
      // audit log records proposed -> resolved(approved) and over-cap spawns queue
      // exactly as a hand-approved delegation would. Without autoApprove the
      // proposal stays pending until approveDelegation() is called.
      if (lead.autoApprove) this.resolveApproval(proposal);
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
    // A lead reaching a terminal state reconciles its virtual children so
    // none hang as "working" after the session that fed them ended. Guarded to
    // a non-virtual agent so a child's own done transition never recurses.
    if (!agent.virtual && isTerminalState(state)) {
      this.reconcileVirtualChildren(agent.id);
    }
  }

  private fail(agent: Agent, message: string): void {
    agent.error = message;
    this.update(agent, "error");
  }

  private computeDiff(agent: Agent): void {
    if (!isWorkspaceManager(this.workspaces)) return; // plain provider -> no-op
    const ws = this.workspaces;
    // Capture the run generation at kickoff. If sendBack() (or a relaunch) bumps
    // it before diff() resolves, this result is stale and must NOT land on the
    // now-running agent. Also require the agent to still be "done": once it has
    // moved on, applying a diff is meaningless.
    const generation = this.generations.get(agent.id) ?? 0;
    const isStale = (): boolean =>
      agent.state !== "done" || (this.generations.get(agent.id) ?? 0) !== generation;
    void ws
      .diff(agent.id)
      .then((diff) => {
        if (isStale()) return; // a relaunch happened; drop the late diff
        if (agent.diff !== undefined) return; // adapter won the race
        agent.diff = diff;
        this.emitter.emit({ kind: "agent-updated", agent });
      })
      .catch((error) => {
        if (isStale()) return; // a relaunch happened; drop the late failure
        if (agent.diff !== undefined) return; // diff already populated; ignore late failure
        agent.diffError = errorMessage(error);
        this.emitter.emit({ kind: "agent-updated", agent });
      });
  }

  approve(agentId: string, approvalId: string, decision: ApprovalDecision): void {
    const agent = this.requireAgent(agentId);
    if (agent.virtual) throw new Error("approve is not available for a fleet sub-agent");
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
    const agent = this.agents.get(agentId);
    if (agent?.virtual) throw new Error("steer is not available for a fleet sub-agent");
    const session = this.sessions.get(agentId);
    if (!session) throw new Error(`No active session for ${agentId}`);
    session.send(input);
  }

  /** All delegation proposals (pending and resolved), newest last. */
  getDelegations(): DelegationProposal[] {
    return [...this.delegations.values()];
  }

  /**
   * Approve a pending delegation: spawn the teammate on its subtask as a child of
   * the lead. The teammate is a normal agent (own worktree, own diff, own review)
   * and inherits the concurrency queue. Independent of the lead's session, so it
   * works even after the lead has finished.
   */
  approveDelegation(proposalId: string): Agent {
    const proposal = this.delegations.get(proposalId);
    if (!proposal) throw new Error(`Unknown delegation: ${proposalId}`);
    if (proposal.state !== "pending") {
      throw new Error(`Delegation ${proposalId} is already ${proposal.state}`);
    }
    return this.resolveApproval(proposal);
  }

  /**
   * The single approve+spawn path shared by the human gate (approveDelegation)
   * and the auto-approve route (scanDelegations under autoApprove). Marks the
   * proposal approved, emits delegation-resolved, and spawns the teammate as a
   * child of the lead. The teammate is a normal agent (own worktree, own diff,
   * own review) and inherits the concurrency queue via spawn() -> tryStart(), so
   * over-cap spawns queue exactly like any other agent.
   */
  private resolveApproval(proposal: DelegationProposal): Agent {
    proposal.state = "approved";
    this.emitter.emit({ kind: "delegation-resolved", proposal });
    return this.spawn(proposal.roleName, proposal.task, { parentId: proposal.leadAgentId });
  }

  /** Deny a pending delegation: nothing spawns; the proposal becomes "denied". */
  denyDelegation(proposalId: string): void {
    const proposal = this.delegations.get(proposalId);
    if (!proposal) throw new Error(`Unknown delegation: ${proposalId}`);
    if (proposal.state !== "pending") {
      throw new Error(`Delegation ${proposalId} is already ${proposal.state}`);
    }
    proposal.state = "denied";
    this.emitter.emit({ kind: "delegation-resolved", proposal });
  }

  stop(agentId: string): void {
    // A virtual fleet sub-agent has no session, slot, or queue entry: stopping it
    // is meaningless, so no-op (least surprising; keeps the lead the unit a
    // user actually stops).
    if (this.agents.get(agentId)?.virtual) return;
    const session = this.sessions.get(agentId);
    if (session) {
      // Live session: signal the engine and let consume() finish the agent in
      // "stopped" rather than "error" on stream end.
      this.stopping.add(agentId);
      session.stop();
      return;
    }
    const agent = this.agents.get(agentId);
    if (!agent) return;
    // Queued: never launched, never consumed a running slot. Drop it from the
    // queue and stop it directly. Do NOT release (it never incremented running).
    const queueIndex = this.queue.indexOf(agentId);
    if (queueIndex !== -1) {
      this.queue.splice(queueIndex, 1);
      this.update(agent, "stopped");
      return;
    }
    // Preparing with no session yet (workspace creation in flight): record the
    // stop intent so launch() aborts after create() resolves, releasing the
    // slot it consumed without starting the engine.
    if (agent.state === "preparing") {
      this.stopping.add(agentId);
    }
  }

  async merge(agentId: string): Promise<MergeResult> {
    const agent = this.requireAgent(agentId);
    if (agent.virtual) throw new Error("merge is not available for a fleet sub-agent");
    if (agent.state !== "done" && agent.state !== "detached") {
      throw new Error(`Agent ${agentId} is not ready to merge (state: ${agent.state})`);
    }
    const ws = this.workspaces;
    if (!isWorkspaceManager(ws)) {
      throw new Error("Workspace provider does not support merge");
    }
    // Acquire the serialization lock. `release` is guaranteed to run on EVERY
    // path (including an early throw or a rejected predecessor), so a failed
    // merge can never deadlock every later merge.
    const { predecessor, release } = this.acquireMergeLock();
    try {
      // Tolerate a rejected predecessor: a failed merge still releases its lock,
      // but if it rejected we must not let that rejection propagate here.
      await predecessor.catch(() => undefined);
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
      release();
    }
  }

  /**
   * After a pull request has been opened for a done agent's branch, move it to
   * the terminal "pr-created" state. The worktree is released (removed) but the
   * branch is KEPT so the PR keeps its commits. Like merge(), only a done agent
   * is eligible; by the time an agent is done its session already ended, so the
   * running slot was released in consume()'s finally and there is no slot to
   * touch here (mirroring how merge() leaves the concurrency counter alone).
   */
  async markPrCreated(agentId: string): Promise<void> {
    const agent = this.requireAgent(agentId);
    if (agent.virtual) throw new Error("create PR is not available for a fleet sub-agent");
    if (agent.state !== "done") {
      throw new Error(`Agent ${agentId} is not ready for a PR (state: ${agent.state})`);
    }
    // releaseWorktree lives on WorkspaceManager and is itself optional there;
    // feature-detect the manager (like merge() does), then guard the optional
    // call so an impl predating releaseWorktree is tolerated. A plain provider
    // has no worktree to release, so this is a no-op for it.
    const ws = this.workspaces;
    if (isWorkspaceManager(ws)) {
      await ws.releaseWorktree?.(agentId);
    }
    this.update(agent, "pr-created");
  }

  /**
   * Chain a new link onto the merge serialization queue. Returns the previous
   * link (which the caller awaits before entering the critical section) and the
   * release function for THIS link. The caller awaits `predecessor` inside a try
   * whose finally calls `release`. Because release is unconditional, a throw
   * anywhere in the critical section still resolves the link for the next
   * waiter, so the lock cannot deadlock.
   */
  private acquireMergeLock(): { predecessor: Promise<void>; release: () => void } {
    const predecessor = this.mergeLock;
    let release!: () => void;
    this.mergeLock = new Promise<void>((r) => {
      release = r;
    });
    return { predecessor, release };
  }

  async retryCleanup(agentId: string): Promise<void> {
    const agent = this.requireAgent(agentId);
    if (agent.virtual) throw new Error("retry cleanup is not available for a fleet sub-agent");
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
    if (agent.virtual) throw new Error("finish conflict resolution is not available for a fleet sub-agent");
    if (agent.state !== "conflict") {
      throw new Error(`Agent ${agentId} is not in conflict state (state: ${agent.state})`);
    }
    agent.conflict = undefined;
    this.update(agent, "merged");
  }

  async discard(agentId: string): Promise<void> {
    const agent = this.requireAgent(agentId);
    if (agent.virtual) throw new Error("discard is not available for a fleet sub-agent");
    if (!isDiscardableState(agent.state)) {
      throw new Error(`Agent ${agentId} cannot be discarded (state: ${agent.state})`);
    }
    const ws = this.workspaces;
    if (isWorkspaceManager(ws)) {
      // discard() removes/prunes the worktree in the repo root, touching the
      // same shared index merge() does, so it serializes through the same lock
      // to avoid interleaving with an in-flight merge and corrupting the index.
      const { predecessor, release } = this.acquireMergeLock();
      try {
        await predecessor.catch(() => undefined);
        await ws.discard(agentId);
      } finally {
        release();
      }
    } else {
      // Non-WorkspaceManager (Fake provider) touches no shared index; stays
      // synchronous and unserialized.
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
      // A virtual fleet sub-agent is derived from a live lead stream and has
      // no workspace or session of its own. There is no stream to rehydrate it
      // from after a reload, so it is never restored as an independent agent.
      if (record.agent.virtual) continue;
      // Copy the mutable log array so later consume() pushes don't mutate the
      // caller's snapshot, and so hydrating the same records twice yields
      // independent log arrays rather than one aliased array shared across agents.
      const agent: Agent = {
        ...record.agent,
        log: Array.isArray(record.agent.log) ? [...record.agent.log] : [],
      };
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
   * Re-launch a done, conflict, or stopped agent in its EXISTING worktree. The
   * previous session already ended; the worktree is reused (launch() skips create
   * when agent.workspace is set), so partial work on disk is preserved. With
   * feedback it is "send back" (done|conflict); with empty feedback it is "resume"
   * (the natural action for a stopped agent). done|conflict|stopped -> preparing.
   */
  sendBack(agentId: string, feedback: string): Agent {
    const agent = this.requireAgent(agentId);
    if (agent.virtual) throw new Error("send back is not available for a fleet sub-agent");
    if (agent.state !== "done" && agent.state !== "conflict" && agent.state !== "stopped") {
      throw new Error(
        `Cannot resume agent ${agentId} (state: ${agent.state}); only done, conflict, or stopped agents can be resumed`,
      );
    }
    // Bump the run generation now (not just at relaunch): if a diff-on-done from
    // the previous run is still in flight, this immediately marks it stale so its
    // late resolution can't clear/overwrite this now-relaunched agent's diff.
    this.generations.set(agent.id, (this.generations.get(agent.id) ?? 0) + 1);
    agent.summary = undefined;
    agent.diff = undefined;
    agent.diffError = undefined;
    agent.conflict = undefined;
    agent.error = undefined;
    agent.pendingApprovalId = undefined;
    agent.approvalDetail = undefined;
    agent.log = [];
    // Only append feedback when there is some: a bare resume keeps the task intact.
    const trimmed = feedback.trim();
    if (trimmed.length > 0) {
      agent.task = {
        ...agent.task,
        description: `${agent.task.description}\n\nLead feedback: ${trimmed}`,
      };
    }
    this.update(agent, "preparing");
    this.tryStart(agent);
    return agent;
  }

  private requireAgent(agentId: string): Agent {
    const agent = this.agents.get(agentId);
    if (!agent) throw new Error(`Unknown agent: ${agentId}`);
    return agent;
  }
}
