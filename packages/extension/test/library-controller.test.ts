import { describe, expect, it, vi } from "vitest";
import { createLibrary, type ConfigGateway } from "../src/library-controller.js";
import type { LibrarySnapshot } from "../src/library-protocol.js";

// ─── Fake gateway ─────────────────────────────────────────────────────────────

function fakeGateway(overrides?: Partial<ConfigGateway>): ConfigGateway & {
  savedSkills: Array<{ manifest: { name: string; description: string; allowedTools?: string[] }; body: string }>;
  deletedSkills: string[];
  roleSkillsCalls: Array<{ roleName: string; skills: string[] }>;
  seededRoles: string[];
  deletedRoles: string[];
  writtenTeams: Array<{ name: string; roleNames: string[] }>;
  deletedTeams: string[];
} {
  const savedSkills: Array<{
    manifest: { name: string; description: string; allowedTools?: string[] };
    body: string;
  }> = [];
  const deletedSkills: string[] = [];
  const roleSkillsCalls: Array<{ roleName: string; skills: string[] }> = [];
  const seededRoles: string[] = [];
  const deletedRoles: string[] = [];
  const writtenTeams: Array<{ name: string; roleNames: string[] }> = [];
  const deletedTeams: string[] = [];

  const gw: ConfigGateway = {
    loadSkills: vi.fn(async () => ({
      skills: [
        { name: "run-tests", description: "Runs the test suite", allowedTools: ["Bash"], source: "authored" as const },
      ],
    })),
    loadRoles: vi.fn(async () => [
      { name: "Tester", engineId: "copilot", skills: ["run-tests"] },
    ]),
    loadTeams: vi.fn(async () => [
      { name: "QA Team", roleNames: ["Tester"] },
    ]),
    saveSkill: vi.fn(async (manifest, body) => {
      savedSkills.push({ manifest, body });
    }),
    deleteSkill: vi.fn(async (name) => {
      deletedSkills.push(name);
    }),
    setRoleSkills: vi.fn(async (roleName, skills) => {
      roleSkillsCalls.push({ roleName, skills });
    }),
    seedRole: vi.fn(async (seed) => {
      seededRoles.push(seed.name);
    }),
    deleteRole: vi.fn(async (name) => {
      deletedRoles.push(name);
    }),
    writeTeam: vi.fn(async (team) => {
      writtenTeams.push(team);
    }),
    deleteTeam: vi.fn(async (name) => {
      deletedTeams.push(name);
    }),
    ...overrides,
  };

  return Object.assign(gw, {
    savedSkills,
    deletedSkills,
    roleSkillsCalls,
    seededRoles,
    deletedRoles,
    writtenTeams,
    deletedTeams,
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function openLibrary(
  gw: ConfigGateway,
  snapshots: LibrarySnapshot[]
): Promise<ReturnType<typeof createLibrary>> {
  const lib = createLibrary(gw, (snap) => snapshots.push(snap));
  await lib.handle({ type: "open-library" });
  return lib;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("createLibrary", () => {
  it("open-library pushes an initial snapshot", async () => {
    const snaps: LibrarySnapshot[] = [];
    const gw = fakeGateway();
    await openLibrary(gw, snaps);
    expect(snaps.length).toBeGreaterThan(0);
    expect(snaps.at(-1)!.skills.length).toBeGreaterThan(0);
  });

  it("the open snapshot has tab 'agents' by default", async () => {
    const snaps: LibrarySnapshot[] = [];
    const gw = fakeGateway();
    await openLibrary(gw, snaps);
    expect(snaps.at(-1)!.tab).toBe("agents");
  });

  it("switch-library-tab pushes a snapshot with the new tab", async () => {
    const snaps: LibrarySnapshot[] = [];
    const gw = fakeGateway();
    const lib = await openLibrary(gw, snaps);
    await lib.handle({ type: "switch-library-tab", tab: "agents" });
    expect(snaps.at(-1)!.tab).toBe("agents");
  });

  it("the open snapshot's run-tests skill carries usedBy from roles", async () => {
    const snaps: LibrarySnapshot[] = [];
    const gw = fakeGateway();
    await openLibrary(gw, snaps);
    const snap = snaps.at(-1)!;
    const runTests = snap.skills.find((s) => s.name === "run-tests");
    expect(runTests).toBeDefined();
    expect(runTests!.usedBy).toEqual([{ roleName: "Tester", engineId: "copilot" }]);
  });

  it("skill-save calls gw.saveSkill then pushes a fresh snapshot", async () => {
    const snaps: LibrarySnapshot[] = [];
    const gw = fakeGateway();
    const lib = await openLibrary(gw, snaps);
    const beforeCount = snaps.length;
    await lib.handle({
      type: "skill-save",
      name: "run-tests",
      description: "Runs the test suite",
      body: "pnpm test",
    });
    expect(gw.saveSkill).toHaveBeenCalledWith(
      expect.objectContaining({ name: "run-tests" }),
      "pnpm test"
    );
    expect(snaps.length).toBeGreaterThan(beforeCount);
  });

  it("skill-save passes allowedTools to gw.saveSkill when provided", async () => {
    const snaps: LibrarySnapshot[] = [];
    const gw = fakeGateway();
    const lib = await openLibrary(gw, snaps);
    await lib.handle({
      type: "skill-save",
      name: "run-tests",
      description: "Runs the test suite",
      body: "pnpm test",
      allowedTools: ["Bash", "Read"],
    });
    expect(gw.saveSkill).toHaveBeenCalledWith(
      expect.objectContaining({ name: "run-tests", allowedTools: ["Bash", "Read"] }),
      "pnpm test"
    );
  });

  it("attach-skill appends a new skill to the role", async () => {
    const snaps: LibrarySnapshot[] = [];
    const gw = fakeGateway();
    const lib = await openLibrary(gw, snaps);
    await lib.handle({ type: "attach-skill", roleName: "Tester", skillName: "openapi" });
    expect(gw.setRoleSkills).toHaveBeenCalledWith("Tester", ["run-tests", "openapi"]);
  });

  it("attach-skill is idempotent: attaching an already-present name produces no duplicate", async () => {
    const snaps: LibrarySnapshot[] = [];
    const gw = fakeGateway();
    const lib = await openLibrary(gw, snaps);
    // "run-tests" is already in Tester's skills
    await lib.handle({ type: "attach-skill", roleName: "Tester", skillName: "run-tests" });
    expect(gw.setRoleSkills).toHaveBeenCalledWith("Tester", ["run-tests"]);
  });

  it("detach-skill removes the skill from the role", async () => {
    const snaps: LibrarySnapshot[] = [];
    const gw = fakeGateway();
    const lib = await openLibrary(gw, snaps);
    await lib.handle({ type: "detach-skill", roleName: "Tester", skillName: "run-tests" });
    expect(gw.setRoleSkills).toHaveBeenCalledWith("Tester", []);
  });

  it("skill-delete calls gw.deleteSkill then pushes a fresh snapshot", async () => {
    const snaps: LibrarySnapshot[] = [];
    const gw = fakeGateway();
    const lib = await openLibrary(gw, snaps);
    const beforeCount = snaps.length;
    await lib.handle({ type: "skill-delete", name: "run-tests" });
    expect(gw.deleteSkill).toHaveBeenCalledWith("run-tests");
    expect(snaps.length).toBeGreaterThan(beforeCount);
  });

  it("skill-create opens the editor in create mode (editing.name === '')", async () => {
    const snaps: LibrarySnapshot[] = [];
    const gw = fakeGateway();
    const lib = await openLibrary(gw, snaps);
    await lib.handle({ type: "skill-create" });
    const snap = snaps.at(-1)!;
    expect(snap.editing).toBeDefined();
    expect(snap.editing!.name).toBe("");
  });

  it("the open snapshot's roles list is populated from loadRoles", async () => {
    const snaps: LibrarySnapshot[] = [];
    const gw = fakeGateway();
    await openLibrary(gw, snaps);
    const snap = snaps.at(-1)!;
    expect(snap.roles.length).toBeGreaterThan(0);
    expect(snap.roles[0]!.name).toBe("Tester");
  });

  it("the open snapshot's teams list is populated from loadTeams", async () => {
    const snaps: LibrarySnapshot[] = [];
    const gw = fakeGateway();
    await openLibrary(gw, snaps);
    const snap = snaps.at(-1)!;
    expect(snap.teams.length).toBeGreaterThan(0);
    expect(snap.teams[0]!.name).toBe("QA Team");
  });

  it("attach-skill then reload recomputes usedBy for the attached skill", async () => {
    const snaps: LibrarySnapshot[] = [];
    // Set up gateway so reload after attach returns the new state
    let rolesData = [{ name: "Tester", engineId: "copilot", skills: ["run-tests"] }];
    const gw = fakeGateway({
      loadRoles: vi.fn(async () => rolesData),
      setRoleSkills: vi.fn(async (roleName, skills) => {
        rolesData = rolesData.map((r) =>
          r.name === roleName ? { ...r, skills } : r
        );
      }),
    });
    const lib = await openLibrary(gw, snaps);
    await lib.handle({ type: "attach-skill", roleName: "Tester", skillName: "openapi" });
    const snap = snaps.at(-1)!;
    // After attach, roles should show the new skill list
    const tester = snap.roles.find((r) => r.name === "Tester");
    expect(tester!.skills).toContain("openapi");
  });

  // ── Group 1: Agents tab New / Delete ────────────────────────────────────────

  it("new-role seeds a default role then pushes a fresh snapshot on the agents tab", async () => {
    const snaps: LibrarySnapshot[] = [];
    const gw = fakeGateway();
    const lib = await openLibrary(gw, snaps);
    await lib.handle({ type: "new-role", name: "Reviewer" });
    expect(gw.seedRole).toHaveBeenCalledWith({ name: "Reviewer" });
    expect(gw.seededRoles).toEqual(["Reviewer"]);
    expect(snaps.at(-1)!.tab).toBe("agents");
  });

  it("delete-role calls gw.deleteRole then reloads on the agents tab", async () => {
    const snaps: LibrarySnapshot[] = [];
    const gw = fakeGateway();
    const lib = await openLibrary(gw, snaps);
    const before = snaps.length;
    await lib.handle({ type: "delete-role", name: "Tester" });
    expect(gw.deleteRole).toHaveBeenCalledWith("Tester");
    expect(snaps.length).toBeGreaterThan(before);
    expect(snaps.at(-1)!.tab).toBe("agents");
  });

  // ── Group 2: Teams tab Create / Save / Delete ───────────────────────────────

  it("team-create opens a blank team editor (editingTeam.name === '') on the teams tab", async () => {
    const snaps: LibrarySnapshot[] = [];
    const gw = fakeGateway();
    const lib = await openLibrary(gw, snaps);
    await lib.handle({ type: "team-create" });
    const snap = snaps.at(-1)!;
    expect(snap.editingTeam).toBeDefined();
    expect(snap.editingTeam!.name).toBe("");
    expect(snap.editingTeam!.roleNames).toEqual([]);
    expect(snap.tab).toBe("teams");
  });

  it("team-save calls gw.writeTeam with name + roleNames then clears the editor", async () => {
    const snaps: LibrarySnapshot[] = [];
    const gw = fakeGateway();
    const lib = await openLibrary(gw, snaps);
    await lib.handle({ type: "team-create" });
    await lib.handle({ type: "team-save", name: "Squad", roleNames: ["Tester"] });
    expect(gw.writeTeam).toHaveBeenCalledWith({ name: "Squad", roleNames: ["Tester"] });
    const snap = snaps.at(-1)!;
    expect(snap.editingTeam).toBeUndefined();
    expect(snap.tab).toBe("teams");
  });

  it("team-delete calls gw.deleteTeam then reloads on the teams tab", async () => {
    const snaps: LibrarySnapshot[] = [];
    const gw = fakeGateway();
    const lib = await openLibrary(gw, snaps);
    await lib.handle({ type: "team-delete", name: "QA Team" });
    expect(gw.deleteTeam).toHaveBeenCalledWith("QA Team");
    expect(snaps.at(-1)!.tab).toBe("teams");
  });

  it("switch-library-tab clears an open team editor", async () => {
    const snaps: LibrarySnapshot[] = [];
    const gw = fakeGateway();
    const lib = await openLibrary(gw, snaps);
    await lib.handle({ type: "team-create" });
    expect(snaps.at(-1)!.editingTeam).toBeDefined();
    await lib.handle({ type: "switch-library-tab", tab: "skills" });
    expect(snaps.at(-1)!.editingTeam).toBeUndefined();
  });

  // ── Group 3: launch-team is a no-op in the controller (host intercepts) ──────

  it("launch-team is a no-op in the controller (no gateway calls, host owns it)", async () => {
    const snaps: LibrarySnapshot[] = [];
    const gw = fakeGateway();
    const lib = await openLibrary(gw, snaps);
    const before = snaps.length;
    await lib.handle({ type: "launch-team", name: "QA Team" });
    // No write, no reload: the host intercepts this message before the controller.
    expect(gw.writeTeam).not.toHaveBeenCalled();
    expect(gw.deleteTeam).not.toHaveBeenCalled();
    expect(snaps.length).toBe(before);
  });
});
