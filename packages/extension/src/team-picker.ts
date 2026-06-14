/** Pure helper for the "Maestro: Launch Team" command. No vscode import, so unit-testable under Vitest. */

import type { Team } from "@maestro/core";

/** A QuickPick row for one team. `team` is carried so the caller can dispatch the picked one. */
export interface TeamQuickPickItem {
  label: string;
  description: string;
  team: Team;
}

/**
 * Format teams into QuickPick rows: the label is the team name and the
 * description summarizes the roster (role count plus the role names). Plain
 * QuickPick data, so no HTML escaping is needed. An empty team list yields an
 * empty array (the caller surfaces a "no teams" message instead of an empty
 * picker).
 */
export function teamQuickPickItems(teams: readonly Team[]): TeamQuickPickItem[] {
  return teams.map((team) => {
    const names = team.roles.map((r) => r.name);
    const count = names.length;
    const roleWord = count === 1 ? "role" : "roles";
    const namesPart = count > 0 ? `: ${names.join(", ")}` : "";
    return {
      label: team.name,
      description: `${count} ${roleWord}${namesPart}`,
      team,
    };
  });
}
