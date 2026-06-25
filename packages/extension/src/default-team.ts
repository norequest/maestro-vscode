import type { Role, Team } from "@maestro/core";

/**
 * Assemble a conductor-led team: the single conductor persona leading a roster
 * of specialist roles. Pure assembly, no registration and no launch.
 *
 * The conductor is ALWAYS the lead and is ALWAYS listed first. A team is just a
 * SCOPED ROSTER limiting which specialists the conductor may delegate to; a team
 * never promotes one of its own roles to lead. If a roster role happens to share
 * the conductor's name, the conductor wins: the duplicate is dropped so the lead
 * is listed exactly once (and the team object stays the authoritative conductor
 * definition, not the roster look-alike). The rest keep their input order.
 *
 * An empty roster is fine: the team is just `[conductor]`. The conductor still
 * runs, it simply has no specialists to delegate to.
 */
export function buildConductorTeam(name: string, roster: Role[], conductor: Role): Team {
  const rest = roster.filter((r) => r.name !== conductor.name);
  return {
    name,
    lead: conductor.name,
    roles: [conductor, ...rest],
  };
}

/** The injectable orchestrator seam a conductor-led team launch needs. */
export interface ConductorTeamDeps {
  /** Register a role with the orchestrator (idempotent: overwrites by name). */
  registerRole: (role: Role) => void;
  /** Launch the assembled conductor-led team with auto-approve on. */
  launchTeam: (team: Team, task: string, opts: { autoApprove: boolean }) => void;
}

/**
 * Launch a hand-built team as a CONDUCTOR-LED run: the conductor leads, the
 * team's roles become its scoped sub-agents, and the conductor auto-approves its
 * delegations to them. The team's OWN `lead` field is IGNORED entirely; a team
 * never promotes one of its roles to lead. Keeps `selectedTeam.name` so the run
 * is still recognizably "the Backend team", just conducted.
 *
 * Pure of vscode so it is unit-testable against a spy orchestrator; the extension
 * wires the real Orchestrator in.
 */
export function launchConductorTeam(
  selectedTeam: Team,
  task: string,
  conductor: Role,
  deps: ConductorTeamDeps,
): void {
  const conductorTeam = buildConductorTeam(selectedTeam.name, selectedTeam.roles, conductor);
  // Register every member (the conductor + each scoped specialist) so delegations
  // resolve by name. registerRole is idempotent.
  for (const role of conductorTeam.roles) deps.registerRole(role);
  deps.launchTeam(conductorTeam, task, { autoApprove: true });
}
