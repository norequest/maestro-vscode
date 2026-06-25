import type { Role, Team } from "@hallucinate/core";

/**
 * Assemble a team with a designated lead: the single lead persona heading a
 * roster of specialist roles. Pure assembly, no registration and no launch.
 *
 * The lead is ALWAYS first and ALWAYS the team's lead. A team is just a SCOPED
 * ROSTER limiting which specialists the lead may delegate to; a team never
 * promotes one of its own roles to lead. If a roster role happens to share the
 * lead's name, the lead wins: the duplicate is dropped so the lead is listed
 * exactly once (and the team object stays the authoritative lead definition, not
 * the roster look-alike). The rest keep their input order.
 *
 * An empty roster is fine: the team is just `[leadRole]`. The lead still runs, it
 * simply has no specialists to delegate to.
 */
export function buildLeadTeam(name: string, roster: Role[], leadRole: Role): Team {
  const rest = roster.filter((r) => r.name !== leadRole.name);
  return {
    name,
    lead: leadRole.name,
    roles: [leadRole, ...rest],
  };
}

/** The injectable orchestrator seam a lead-headed team launch needs. */
export interface LeadTeamDeps {
  /** Register a role with the orchestrator (idempotent: overwrites by name). */
  registerRole: (role: Role) => void;
  /** Launch the assembled team (lead first) with auto-approve on. */
  launchTeam: (team: Team, task: string, opts: { autoApprove: boolean }) => void;
}

/**
 * Launch a hand-built team as a LEAD-HEADED run: the lead heads the team, the
 * team's roles become its scoped sub-agents, and the lead auto-approves its
 * delegations to them. The team's OWN `lead` field is IGNORED entirely; a team
 * never promotes one of its roles to lead. Keeps `selectedTeam.name` so the run
 * is still recognizably "the Backend team", just run by the designated lead.
 *
 * Pure of vscode so it is unit-testable against a spy orchestrator; the extension
 * wires the real Orchestrator in.
 */
export function launchLeadTeam(
  selectedTeam: Team,
  task: string,
  leadRole: Role,
  deps: LeadTeamDeps,
): void {
  const leadTeam = buildLeadTeam(selectedTeam.name, selectedTeam.roles, leadRole);
  // Register every member (the lead + each scoped specialist) so delegations
  // resolve by name. registerRole is idempotent.
  for (const role of leadTeam.roles) deps.registerRole(role);
  deps.launchTeam(leadTeam, task, { autoApprove: true });
}
