import type { Agent, AgentState, OrchestratorEvent } from "@maestro/core";
import type { CardVM } from "./protocol.js";

/** Max accumulated output chars kept per agent (keeps state snapshots bounded). */
export const OUTPUT_CAP = 16_000;

/** Authoritative internal state. `selectState` derives the ordered CockpitState from it. */
export interface CockpitModel {
  cards: Map<string, CardVM>;
  focusedId?: string;
}

export function initialModel(): CockpitModel {
  return { cards: new Map() };
}

function needsAttention(state: AgentState): boolean {
  return (
    state === "awaiting-approval" || state === "done" || state === "error" || state === "conflict"
  );
}

function cardFromAgent(agent: Agent, prevOutput: string): CardVM {
  return {
    id: agent.id,
    roleName: agent.role.name,
    engineId: agent.role.engine.id,
    state: agent.state,
    output: prevOutput,
    summary: agent.summary,
    diff: agent.diff,
    diffError: agent.diffError,
    conflictFiles: agent.conflict?.files,
    error: agent.error,
    pendingApprovalId: agent.pendingApprovalId,
    approvalDetail: agent.approvalDetail,
    engineCapabilities: agent.engineCapabilities,
    attention: needsAttention(agent.state),
  };
}

function appendOutput(prev: string, text: string): string {
  const next = prev + text;
  return next.length > OUTPUT_CAP ? next.slice(next.length - OUTPUT_CAP) : next;
}

/** Pure: fold one orchestrator event into a new model (never mutates the input). */
export function reduce(model: CockpitModel, event: OrchestratorEvent): CockpitModel {
  const cards = new Map(model.cards);
  switch (event.kind) {
    case "agent-added":
      cards.set(event.agent.id, cardFromAgent(event.agent, ""));
      break;
    case "agent-updated": {
      // agent-added always precedes agent-updated per the orchestrator contract.
      const prev = cards.get(event.agent.id);
      cards.set(event.agent.id, cardFromAgent(event.agent, prev?.output ?? ""));
      break;
    }
    case "agent-event": {
      const prev = cards.get(event.agentId);
      if (prev && event.event.kind === "output") {
        cards.set(event.agentId, { ...prev, output: appendOutput(prev.output, event.event.text) });
      }
      break;
    }
  }
  return { ...model, cards };
}

/** Pure: set the focused agent. */
export function setFocus(model: CockpitModel, agentId: string): CockpitModel {
  return { ...model, focusedId: agentId };
}
