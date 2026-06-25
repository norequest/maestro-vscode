/**
 * Library controller: holds the current snapshot, handles inbound LibraryToHost
 * messages, routes every WRITE through an injected ConfigGateway (the seam over
 * @hallucinate/config + node fs), so it unit-tests against a FAKE gateway with zero
 * disk I/O. After every write it reloads, rebuilds the reverse index (used-by
 * counts), and pushes a fresh snapshot.
 *
 * NO node imports in this file.
 */

import type { LibrarySnapshot, LibraryTab, SkillCardVM, TeamEditVM } from "./library-protocol.js";
import type { LibraryToHost } from "./library-protocol.js";

/**
 * The shape the gateway needs to seed a brand-new role. Kept minimal (the four
 * fields a role file requires) so the controller never fabricates tool grants or
 * skills the user has not asked for. The real default values live in the gateway.
 */
export interface NewRoleSeed {
  name: string;
}

// ─── ConfigGateway seam ───────────────────────────────────────────────────────

/**
 * Injectable gateway interface over @hallucinate/config + node fs.
 * The REAL implementation is Task 13; here it is a pure interface with no node
 * imports so the controller unit-tests against a fake with zero disk I/O.
 */
export interface ConfigGateway {
  loadSkills(): Promise<{
    skills: {
      name: string;
      description: string;
      allowedTools?: string[];
      source?: "authored" | "plugin";
    }[];
  }>;
  loadRoles(): Promise<{ name: string; engineId: string; skills: string[] }[]>;
  loadTeams(): Promise<{ name: string; roleNames: string[] }[]>;
  saveSkill(
    manifest: { name: string; description: string; allowedTools?: string[] },
    body: string
  ): Promise<void>;
  deleteSkill(name: string): Promise<void>;
  setRoleSkills(roleName: string, skills: string[]): Promise<void>;
  /** Seed a default role file so subsequent anatomy edits have something to load. */
  seedRole(seed: NewRoleSeed): Promise<void>;
  /** Delete a role: remove the single .hallucinate/roles/<base>.yaml file. */
  deleteRole(name: string): Promise<void>;
  /** Write a team: serialize name + member role names to .hallucinate/teams/<base>.yaml. */
  writeTeam(team: { name: string; roleNames: string[] }): Promise<void>;
  /** Delete a team: remove the single .hallucinate/teams/<base>.yaml file. */
  deleteTeam(name: string): Promise<void>;
}

// ─── Internal state ───────────────────────────────────────────────────────────

interface LibraryState {
  tab: LibraryTab;
  skills: SkillCardVM[];
  roles: { name: string; engineId: string; skills: string[] }[];
  teams: { name: string; roleNames: string[] }[];
  editing?: SkillCardVM;
  editingTeam?: TeamEditVM;
  picker?: { roleName: string };
}

// ─── Library handle ───────────────────────────────────────────────────────────

export interface LibraryHandle {
  handle(msg: LibraryToHost): Promise<void>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build the usedBy reverse index from roles: for each skill name, which roles
 * (name + engineId) include it in their skills list.
 */
function buildUsedBy(
  skillName: string,
  roles: { name: string; engineId: string; skills: string[] }[]
): { roleName: string; engineId: string }[] {
  return roles
    .filter((r) => r.skills.includes(skillName))
    .map((r) => ({ roleName: r.name, engineId: r.engineId }));
}

/**
 * Load all data from the gateway and build a fresh LibrarySnapshot.
 */
async function loadSnapshot(gw: ConfigGateway, tab: LibraryTab, extras?: {
  editing?: SkillCardVM;
  editingTeam?: TeamEditVM;
  picker?: { roleName: string };
}): Promise<LibraryState> {
  const [skillsResult, roles, teams] = await Promise.all([
    gw.loadSkills(),
    gw.loadRoles(),
    gw.loadTeams(),
  ]);

  const skills: SkillCardVM[] = skillsResult.skills.map((s) => ({
    name: s.name,
    description: s.description,
    allowedTools: s.allowedTools,
    source: s.source ?? "authored",
    usedBy: buildUsedBy(s.name, roles),
  }));

  return {
    tab,
    skills,
    roles,
    teams,
    editing: extras?.editing,
    editingTeam: extras?.editingTeam,
    picker: extras?.picker,
  };
}

function toSnapshot(state: LibraryState): LibrarySnapshot {
  return {
    tab: state.tab,
    skills: state.skills,
    roles: state.roles,
    teams: state.teams,
    editing: state.editing,
    editingTeam: state.editingTeam,
    picker: state.picker,
  };
}

// ─── createLibrary ────────────────────────────────────────────────────────────

/**
 * Create the Library controller. Holds the current snapshot in memory; each
 * `handle()` call mutates that state and calls `onSnapshot` with the new value.
 *
 * @param gw - The config gateway (real or fake).
 * @param onSnapshot - Called with the new snapshot after every state change.
 */
export function createLibrary(
  gw: ConfigGateway,
  onSnapshot: (snap: LibrarySnapshot) => void
): LibraryHandle {
  let state: LibraryState = {
    tab: "agents",
    skills: [],
    roles: [],
    teams: [],
  };

  async function reload(tab?: LibraryTab, extras?: { editing?: SkillCardVM; editingTeam?: TeamEditVM; picker?: { roleName: string } }): Promise<void> {
    state = await loadSnapshot(gw, tab ?? state.tab, extras);
    onSnapshot(toSnapshot(state));
  }

  async function handle(msg: LibraryToHost): Promise<void> {
    switch (msg.type) {
      case "open-library": {
        await reload("agents");
        return;
      }

      case "switch-library-tab": {
        state = { ...state, tab: msg.tab, editing: undefined, editingTeam: undefined, picker: undefined };
        onSnapshot(toSnapshot(state));
        return;
      }

      case "skill-create": {
        const emptyCard: SkillCardVM = {
          name: "",
          description: "",
          source: "authored",
          usedBy: [],
        };
        state = { ...state, editing: emptyCard, picker: undefined };
        onSnapshot(toSnapshot(state));
        return;
      }

      case "skill-save": {
        const manifest: { name: string; description: string; allowedTools?: string[] } = {
          name: msg.name,
          description: msg.description,
        };
        if (msg.allowedTools !== undefined) {
          manifest.allowedTools = msg.allowedTools;
        }
        await gw.saveSkill(manifest, msg.body);
        await reload(state.tab, { editing: undefined, picker: undefined });
        return;
      }

      case "skill-delete": {
        await gw.deleteSkill(msg.name);
        await reload(state.tab, { editing: undefined, picker: undefined });
        return;
      }

      // ── Group 1: Agents tab ──────────────────────────────────────────────
      case "new-role": {
        // name is collected by the host (native input box) and re-sent here with
        // a value; a name-less new-role never reaches the controller, but guard
        // anyway so an empty request is a no-op rather than seeding "undefined".
        if (!msg.name) return;
        // Seed a default role file so the host's follow-up open-anatomy has a
        // role to load. The host opens the anatomy editor after this resolves.
        await gw.seedRole({ name: msg.name });
        await reload("agents", { editing: undefined, editingTeam: undefined, picker: undefined });
        return;
      }

      case "delete-role": {
        await gw.deleteRole(msg.name);
        await reload("agents", { editing: undefined, editingTeam: undefined, picker: undefined });
        return;
      }

      // ── Group 2: Teams tab ───────────────────────────────────────────────
      case "team-create": {
        const emptyTeam: TeamEditVM = { name: "", roleNames: [] };
        state = { ...state, tab: "teams", editing: undefined, editingTeam: emptyTeam, picker: undefined };
        onSnapshot(toSnapshot(state));
        return;
      }

      case "team-save": {
        await gw.writeTeam({ name: msg.name, roleNames: msg.roleNames });
        await reload("teams", { editing: undefined, editingTeam: undefined, picker: undefined });
        return;
      }

      case "team-delete": {
        await gw.deleteTeam(msg.name);
        await reload("teams", { editing: undefined, editingTeam: undefined, picker: undefined });
        return;
      }

      // launch-team is intercepted by the EXTENSION host (it needs the
      // orchestrator, which the controller has no access to). Reaching the
      // controller is a no-op; the host-side onLibrary wiring handles it first.
      case "launch-team":
        return;

      case "attach-skill": {
        const role = state.roles.find((r) => r.name === msg.roleName);
        const current = role?.skills ?? [];
        // Dedup: only append if not already present
        const next = current.includes(msg.skillName) ? current : [...current, msg.skillName];
        await gw.setRoleSkills(msg.roleName, next);
        await reload(state.tab, { editing: state.editing, picker: state.picker });
        return;
      }

      case "detach-skill": {
        const role = state.roles.find((r) => r.name === msg.roleName);
        const current = role?.skills ?? [];
        const next = current.filter((s) => s !== msg.skillName);
        await gw.setRoleSkills(msg.roleName, next);
        await reload(state.tab, { editing: state.editing, picker: state.picker });
        return;
      }

      // Discover/adopt messages are handled by DiscoverController (P5), not here.
      case "scan-repo":
      case "scan-plugins":
      case "adopt-agent":
      case "adopt-skill":
      case "browse-source":
        return;

      default: {
        // Exhaustiveness guard: a new LibraryToHost variant is a loud compile error here.
        const _exhaustive: never = msg;
        void _exhaustive;
        return;
      }
    }
  }

  return { handle };
}
