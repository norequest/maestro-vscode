import type { AgentState } from "@maestro/core";
import type { CardVM } from "@maestro/cockpit";

/** A VS Code-free descriptor of one roster row (pure, testable). */
export interface RosterItem {
  id: string;
  label: string;
  description: string;
  icon: string;
  tooltip: string;
  attention: boolean;
}

/** Codicon id per agent state (must be distinct so the roster reads at a glance). */
export function cardIcon(state: AgentState): string {
  switch (state) {
    case "preparing": return "clock";
    case "working": return "loading~spin";
    case "awaiting-approval": return "question";
    case "done": return "pass-filled";
    case "error": return "error";
    case "conflict": return "warning";
    case "merged": return "git-merge";
    case "discarded": return "trash";
    case "stopped": return "circle-slash";
    case "detached": return "debug-disconnect";
    case "merge-cleanup-failed": return "warning";
    case "pr-created": return "git-pull-request";
  }
}

export function cardToRosterItem(card: CardVM): RosterItem {
  return {
    id: card.id,
    label: card.roleName,
    description: `${card.engineId} · ${card.state}`,
    icon: cardIcon(card.state),
    tooltip: `${card.roleName} (${card.engineId}): ${card.state}`,
    attention: card.attention,
  };
}
