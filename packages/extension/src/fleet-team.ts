import type { AgentProfile, Role, SpawnOptions, Team } from "@maestro/core";
import { COPILOT_ENGINE_ID, FLEET_ENGINE_ID } from "@maestro/core";
import { buildConductorTeam } from "./default-team.js";

// COPILOT_ENGINE_ID and FLEET_ENGINE_ID are defined once in @maestro/core (the
// orchestrator owns the adapter-routing ids) and re-exported here for the
// existing importers (extension.ts, tests). FLEET_ENGINE_ID is INTERNAL: the
// conductor role's engine id is rewritten to it at launch (see toFleetConductor)
// so the orchestrator's adapter lookup (`adapters.get(role.engine.id)`) routes
// the conductor to the fleet adapter and everyone else to the plain "copilot"
// adapter. Nothing the user authors ever names it.
export { COPILOT_ENGINE_ID, FLEET_ENGINE_ID };

/** Cap a teammate's one-line description so the roster block stays readable. */
const DESCRIPTION_CAP = 120;

/**
 * True when a conductor leads a COPILOT team and so should run in fleet
 * single-session mode (one conductor process, sub-agents surfaced as virtual
 * children). ACP (and any non-Copilot lead) returns false: those keep the
 * delegate/spawn model, since only Copilot has `/fleet`.
 */
export function usesFleet(conductor: Role): boolean {
  return conductor.engine.id === COPILOT_ENGINE_ID;
}

/**
 * The conductor role rewritten to the FLEET engine id so the orchestrator routes
 * it to the fleet adapter. Everything else (name, instructions, autonomy, skills,
 * model) is preserved; only `engine.id` changes. Pure: never mutates the input.
 */
export function toFleetConductor(conductor: Role): Role {
  return { ...conductor, engine: { ...conductor.engine, id: FLEET_ENGINE_ID } };
}

/**
 * A one-line description for a roster teammate, derived from the FIRST line of
 * its instructions, trimmed and capped. Used to advertise each specialist in the
 * `/fleet` prompt so the conductor knows what each agent is for. Falls back to
 * the role name when there are no instructions. No em dashes; an over-long line
 * ends with a plain "..." marker.
 */
export function teammateDescription(role: Role): string {
  const firstLine = role.instructions.split(/\n/)[0]?.trim() ?? "";
  const text = firstLine || role.name;
  return text.length > DESCRIPTION_CAP ? `${text.slice(0, DESCRIPTION_CAP)}...` : text;
}

/**
 * Build the conductor's task description for a fleet run: the REQUIRED leading
 * "/fleet " trigger, the user's task text, a delegation nudge, then one roster
 * line per teammate ("- <slug>: <one-line description>"). The leading "/fleet "
 * is what makes Copilot enter its fleet orchestrator, so it must never be
 * dropped. Plain text only (no em dashes).
 *
 * @param slugFor - maps a role name to its Copilot agent slug (the same
 *   `slugForRole` the adapter uses to select `--agent <conductorSlug>`), so the
 *   advertised names match the materialized `.agent.md` files exactly.
 */
export function buildFleetPrompt(
  task: string,
  teammates: Role[],
  slugFor: (name: string) => string,
): string {
  const rosterLines = teammates
    .map((r) => `- ${slugFor(r.name)}: ${teammateDescription(r)}`)
    .join("\n");
  const body =
    `/fleet ${task}\n\n` +
    "Delegate independent work to your specialist agents and run independent items in parallel. " +
    "Available agents:\n" +
    rosterLines;
  return body;
}

/** The injectable seam a fleet team launch needs (kept vscode/fs-free for tests). */
export interface FleetTeamDeps {
  /**
   * Build a teammate's Copilot custom-agent profile (`.agent.md` text), to be
   * materialized into the CONDUCTOR'S worktree (via {@link SpawnOptions.agentProfiles}),
   * NOT the main repo and NEVER the global `~/.copilot/agents/`. Resolves the
   * role's persona (soul + skills) and renders the `.agent.md` body. Called once
   * per teammate (never the conductor: in fleet mode the built-in orchestrator
   * drives, so we do not advertise a "conductor" agent for it to dispatch to).
   * Returns `null` (or throws) on a read error: the teammate is then skipped,
   * best-effort, without blocking the launch.
   */
  buildTeammateProfile: (role: Role) => AgentProfile | null | Promise<AgentProfile | null>;
  /** Register a role with the orchestrator (idempotent: overwrites by name). */
  registerRole: (role: Role) => void;
  /** Map a role name to its Copilot agent slug (the adapter's `slugForRole`). */
  slugFor: (name: string) => string;
  /**
   * Spawn the SINGLE conductor process. NOT launchTeam: fleet runs one conductor
   * session whose stream surfaces the sub-agents as virtual children, so there is
   * no per-teammate process and no delegation proposals. The roleName is the
   * conductor's (unchanged) name; the description is the built `/fleet ...` text.
   * `opts` carries the teammate agent profiles to materialize into the conductor's
   * worktree so the fleet orchestrator (run with `-C <worktree>`) discovers them.
   */
  spawn: (roleName: string, description: string, opts?: SpawnOptions) => void;
}

/**
 * Launch a COPILOT conducting run in FLEET single-session mode.
 *
 * Unlike {@link launchConductorTeam} (the delegate/spawn model kept for ACP and
 * any non-Copilot lead), this:
 *   - spawns ONLY the conductor (one `copilot` process), never a process per
 *     teammate; the conductor's `/fleet` run dispatches the teammates as
 *     in-session sub-agents that the orchestrator surfaces as read-only virtual
 *     child cards,
 *   - rewrites the conductor's engine id to {@link FLEET_ENGINE_ID} so the
 *     orchestrator routes it to the fleet adapter (single-agent dispatch, still
 *     on plain "copilot", is untouched),
 *   - materializes each TEAMMATE's `.agent.md` into the CONDUCTOR'S worktree (via
 *     {@link SpawnOptions.agentProfiles}), so Copilot's built-in `/fleet`
 *     orchestrator (which runs with `-C <worktree>`) discovers the specialists by
 *     name WITHOUT touching the main repo or the global `~/.copilot/agents/`. The
 *     conductor itself is NOT advertised as an agent: the built-in orchestrator
 *     drives, and we do not want it dispatching to "conductor",
 *   - sets the conductor's task to the `/fleet ...` prompt that lists the roster.
 *
 * Pure of vscode/fs (deps inject the real writers/orchestrator) so it is
 * unit-testable against spies. Returns nothing; the orchestrator emits the
 * conductor (and later the virtual children) as events.
 */
export async function launchFleetTeam(
  selectedTeam: Team,
  task: string,
  conductor: Role,
  deps: FleetTeamDeps,
): Promise<void> {
  // Assemble the conductor-led team the same way the delegate path does (conductor
  // first + lead, then the scoped roster, deduped). The teammates are everyone but
  // the conductor.
  const conductorTeam = buildConductorTeam(selectedTeam.name, selectedTeam.roles, conductor);
  const teammates = conductorTeam.roles.filter((r) => r.name !== conductor.name);

  // The conductor runs on the FLEET adapter; the teammates keep their own engine
  // ids (they are never spawned as processes here, only advertised so the fleet
  // orchestrator can name them).
  const fleetConductor = toFleetConductor(conductor);

  // Build each TEAMMATE's `.agent.md` profile so it can be materialized into the
  // conductor's worktree (see spawn below). The profile's slug name uses the SAME
  // slug helper the prompt roster uses, so the advertised names match the
  // materialized filenames. The conductor is NOT advertised: the built-in fleet
  // orchestrator drives, and we do not want it dispatching to "conductor".
  // Best-effort per role: a read error skips just that one profile.
  const profiles: AgentProfile[] = [];
  for (const role of teammates) {
    try {
      const profile = await deps.buildTeammateProfile(role);
      if (profile) profiles.push(profile);
    } catch {
      // A failed profile build must not block the launch; Copilot will simply not
      // see that one specialist.
    }
  }

  // Register the conductor (on the fleet engine) and every teammate so any later
  // name resolution finds them. registerRole is idempotent.
  deps.registerRole(fleetConductor);
  for (const role of teammates) deps.registerRole(role);

  // Spawn ONLY the conductor, with the `/fleet ...` prompt as its task and the
  // teammate profiles in `agentProfiles` so the orchestrator materializes them
  // into the conductor's worktree. The teammate roster is advertised in the prompt
  // (by slug) so the built-in `/fleet` orchestrator can dispatch them in-session.
  const description = buildFleetPrompt(task, teammates, deps.slugFor);
  deps.spawn(fleetConductor.name, description, { agentProfiles: profiles });
}
