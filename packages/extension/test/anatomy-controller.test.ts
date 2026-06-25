import { describe, expect, it, vi } from "vitest";
import { createAnatomyController, type AnatomyGateway } from "../src/anatomy-controller.js";
import { countGrants } from "@maestro/core";
import { skillNeedsGrant } from "@maestro/config";
import type { Role } from "@maestro/core";
import type { AnatomyVM } from "../src/anatomy-protocol.js";

// ─── Fake gateway ─────────────────────────────────────────────────────────────

type WrittenRole = Role;

function fakeGateway(
  initialRole?: Partial<Role>,
  overrides?: Partial<AnatomyGateway>
): AnatomyGateway & {
  writtenRoles: WrittenRole[];
  writtenSouls: Array<{ roleName: string; body: string }>;
  currentRole: Role;
} {
  const writtenRoles: WrittenRole[] = [];
  const writtenSouls: Array<{ roleName: string; body: string }> = [];

  let currentRole: Role = {
    name: "Tester",
    instructions: "Run all tests.",
    engine: { id: "copilot" },
    autonomy: "manual",
    ...initialRole,
  };

  const gw: AnatomyGateway = {
    loadRole: vi.fn(async (_roleName: string) => currentRole),
    loadSoulBody: vi.fn(async (_roleName: string) => ""),
    loadSkillRequirements: vi.fn(async () => [
      { name: "run-tests", allowedTools: ["Git(write)"] },
      { name: "read-docs", allowedTools: ["Read"] },
    ]),
    writeRole: vi.fn(async (role: Role) => {
      writtenRoles.push(role);
      currentRole = role;
    }),
    writeSoul: vi.fn(async (roleName: string, body: string) => {
      writtenSouls.push({ roleName, body });
      if (!currentRole.soul) {
        currentRole = { ...currentRole, soul: roleName };
      }
    }),
    isKnownEngineId: vi.fn((id: string) => id === "copilot" || id === "acp"),
    ...overrides,
  };

  (gw as unknown as Record<string, unknown>)["writtenRoles"] = writtenRoles;
  (gw as unknown as Record<string, unknown>)["writtenSouls"] = writtenSouls;
  Object.defineProperty(gw, "currentRole", { get: () => currentRole, enumerable: true, configurable: true });
  return gw as typeof gw & { writtenRoles: WrittenRole[]; writtenSouls: Array<{ roleName: string; body: string }>; readonly currentRole: Role };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("createAnatomyController", () => {
  // ─── open-anatomy ──────────────────────────────────────────────────────────

  it("open-anatomy pushes a snapshot with the role name", async () => {
    const snaps: AnatomyVM[] = [];
    const gw = fakeGateway();
    const ctrl = createAnatomyController(gw, (vm) => snaps.push(vm));
    await ctrl.handle({ type: "open-anatomy", roleName: "Tester" });
    expect(snaps.length).toBeGreaterThan(0);
    expect(snaps.at(-1)!.roleName).toBe("Tester");
  });

  it("open-anatomy snapshot toolsSummary matches countGrants(role.tools)", async () => {
    const snaps: AnatomyVM[] = [];
    const gw = fakeGateway({
      tools: { builtins: { read: ["Read"], write: ["Git"] } },
    });
    const ctrl = createAnatomyController(gw, (vm) => snaps.push(vm));
    await ctrl.handle({ type: "open-anatomy", roleName: "Tester" });
    const snap = snaps.at(-1)!;
    const expected = countGrants({ builtins: { read: ["Read"], write: ["Git"] } });
    expect(snap.toolsSummary).toEqual(expected);
  });

  // ─── role-set-tools ────────────────────────────────────────────────────────

  it("role-set-tools writes a role whose tools.builtins.write includes the granted tool", async () => {
    const snaps: AnatomyVM[] = [];
    const gw = fakeGateway();
    const ctrl = createAnatomyController(gw, (vm) => snaps.push(vm));
    await ctrl.handle({ type: "open-anatomy", roleName: "Tester" });
    await ctrl.handle({
      type: "role-set-tools",
      roleName: "Tester",
      tools: { builtins: { read: ["Read"], write: ["Git"] } },
    });
    const written = gw.writtenRoles.find((r) => r.tools?.builtins?.write?.includes("Git"));
    expect(written).toBeDefined();
  });

  // ─── role-set-soul ─────────────────────────────────────────────────────────

  it("role-set-soul writes the soul body", async () => {
    const snaps: AnatomyVM[] = [];
    const gw = fakeGateway();
    const ctrl = createAnatomyController(gw, (vm) => snaps.push(vm));
    await ctrl.handle({ type: "open-anatomy", roleName: "Tester" });
    await ctrl.handle({
      type: "role-set-soul",
      roleName: "Tester",
      soul: "You are careful.",
    });
    expect(gw.writeSoul).toHaveBeenCalledWith("Tester", "You are careful.");
  });

  it("role-set-soul on a previously soul-less role sets role.soul after the write", async () => {
    const snaps: AnatomyVM[] = [];
    const gw = fakeGateway({ soul: undefined }); // no soul to start
    const ctrl = createAnatomyController(gw, (vm) => snaps.push(vm));
    await ctrl.handle({ type: "open-anatomy", roleName: "Tester" });
    await ctrl.handle({
      type: "role-set-soul",
      roleName: "Tester",
      soul: "You are careful.",
    });
    // After writeSoul the fake sets currentRole.soul to the roleName
    expect(gw.currentRole.soul).toBe("Tester");
  });

  // ─── role-set-engine (known + unknown) ────────────────────────────────────

  it("role-set-engine with a known id writes the role", async () => {
    const snaps: AnatomyVM[] = [];
    const gw = fakeGateway();
    const ctrl = createAnatomyController(gw, (vm) => snaps.push(vm));
    await ctrl.handle({ type: "open-anatomy", roleName: "Tester" });
    const beforeCount = gw.writtenRoles.length;
    await ctrl.handle({ type: "role-set-engine", roleName: "Tester", engineId: "acp" });
    expect(gw.writtenRoles.length).toBeGreaterThan(beforeCount);
  });

  it("role-set-engine with an UNKNOWN id is refused (no writeRole call)", async () => {
    const snaps: AnatomyVM[] = [];
    const errors: string[] = [];
    const gw = fakeGateway();
    const ctrl = createAnatomyController(gw, (vm) => snaps.push(vm), (e) => errors.push(e));
    await ctrl.handle({ type: "open-anatomy", roleName: "Tester" });
    const beforeCount = gw.writtenRoles.length;
    await ctrl.handle({
      type: "role-set-engine",
      roleName: "Tester",
      engineId: "totally-unknown-engine",
    });
    // No additional write should have occurred
    expect(gw.writtenRoles.length).toBe(beforeCount);
    // An error should have been surfaced
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain("totally-unknown-engine");
  });

  // ─── grant-tool ───────────────────────────────────────────────────────────

  it("grant-tool with write:true adds the tool to the write list and persists", async () => {
    const snaps: AnatomyVM[] = [];
    const gw = fakeGateway();
    const ctrl = createAnatomyController(gw, (vm) => snaps.push(vm));
    await ctrl.handle({ type: "open-anatomy", roleName: "Tester" });
    await ctrl.handle({ type: "grant-tool", roleName: "Tester", tool: "Git", write: true });
    const written = gw.writtenRoles.at(-1);
    expect(written?.tools?.builtins?.write).toContain("Git");
  });

  it("grant-tool with write:false adds the tool to read only (never write)", async () => {
    const snaps: AnatomyVM[] = [];
    const gw = fakeGateway();
    const ctrl = createAnatomyController(gw, (vm) => snaps.push(vm));
    await ctrl.handle({ type: "open-anatomy", roleName: "Tester" });
    await ctrl.handle({ type: "grant-tool", roleName: "Tester", tool: "Read", write: false });
    const written = gw.writtenRoles.at(-1);
    expect(written?.tools?.builtins?.read).toContain("Read");
    // write list should NOT contain Read (or should be absent/empty)
    expect(written?.tools?.builtins?.write ?? []).not.toContain("Read");
  });

  it("grant-tool with write:false does NOT add to write list even if tool is a write-capable tool", async () => {
    const snaps: AnatomyVM[] = [];
    const gw = fakeGateway();
    const ctrl = createAnatomyController(gw, (vm) => snaps.push(vm));
    await ctrl.handle({ type: "open-anatomy", roleName: "Tester" });
    await ctrl.handle({ type: "grant-tool", roleName: "Tester", tool: "Git", write: false });
    const written = gw.writtenRoles.at(-1);
    // Git should be in read (granted without write)
    expect(written?.tools?.builtins?.read).toContain("Git");
    // Git should NOT be in write
    expect(written?.tools?.builtins?.write ?? []).not.toContain("Git");
  });

  // ─── toolsSummary matches countGrants ────────────────────────────────────

  it("the snapshot toolsSummary equals countGrants(role.tools)", async () => {
    const snaps: AnatomyVM[] = [];
    const gw = fakeGateway({ tools: { builtins: { write: ["Edit", "Run"] } } });
    const ctrl = createAnatomyController(gw, (vm) => snaps.push(vm));
    await ctrl.handle({ type: "open-anatomy", roleName: "Tester" });
    const snap = snaps.at(-1)!;
    const expected = countGrants({ builtins: { write: ["Edit", "Run"] } });
    expect(snap.toolsSummary).toEqual(expected);
  });

  // ─── skill gap data (grant-gate) ──────────────────────────────────────────

  it("a skill whose allowedTools is ['Git(write)'] against a read-only role yields non-null gap", async () => {
    const snaps: AnatomyVM[] = [];
    // Role has run-tests in skills, tools is read-only (no write)
    const gw = fakeGateway({
      skills: ["run-tests"],
      tools: { builtins: { read: ["Read"] } },
    });
    const ctrl = createAnatomyController(gw, (vm) => snaps.push(vm));
    await ctrl.handle({ type: "open-anatomy", roleName: "Tester" });
    const snap = snaps.at(-1)!;
    const runTestsSkill = snap.skills.find((s) => s.name === "run-tests");
    expect(runTestsSkill).toBeDefined();
    expect(runTestsSkill!.gap).not.toBeNull();
    expect(runTestsSkill!.gap?.missingWrite).toContain("Git");
  });

  it("attaching does NOT auto-grant: gap data present but no write added", async () => {
    const snaps: AnatomyVM[] = [];
    const gw = fakeGateway({
      skills: ["run-tests"],
      tools: { builtins: { read: ["Read"] } },
    });
    const ctrl = createAnatomyController(gw, (vm) => snaps.push(vm));
    await ctrl.handle({ type: "open-anatomy", roleName: "Tester" });
    const snap = snaps.at(-1)!;

    // Gap is surfaced in the VM but no write was auto-granted
    const runTestsSkill = snap.skills.find((s) => s.name === "run-tests");
    expect(runTestsSkill!.gap).not.toBeNull();

    // No writeRole was called (open-anatomy only reads)
    expect(gw.writtenRoles.length).toBe(0);
  });

  it("a skill fully covered by grants yields a null gap", async () => {
    const snaps: AnatomyVM[] = [];
    // run-tests needs Git(write); give the role that write grant
    const gw = fakeGateway({
      skills: ["run-tests"],
      tools: { builtins: { write: ["Git"] } },
    });
    const ctrl = createAnatomyController(gw, (vm) => snaps.push(vm));
    await ctrl.handle({ type: "open-anatomy", roleName: "Tester" });
    const snap = snaps.at(-1)!;
    const runTestsSkill = snap.skills.find((s) => s.name === "run-tests");
    expect(runTestsSkill!.gap).toBeNull();
  });

  // ─── role-set-autonomy ─────────────────────────────────────────────────────

  it("role-set-autonomy writes the updated autonomy and pushes snapshot", async () => {
    const snaps: AnatomyVM[] = [];
    const gw = fakeGateway();
    const ctrl = createAnatomyController(gw, (vm) => snaps.push(vm));
    await ctrl.handle({ type: "open-anatomy", roleName: "Tester" });
    await ctrl.handle({
      type: "role-set-autonomy",
      roleName: "Tester",
      autonomy: "auto-approve-safe",
    });
    const written = gw.writtenRoles.at(-1);
    expect(written?.autonomy).toBe("auto-approve-safe");
    expect(snaps.at(-1)!.autonomy).toBe("auto-approve-safe");
  });

  // ─── role-set-instructions ─────────────────────────────────────────────────

  it("role-set-instructions writes the updated instructions and pushes snapshot", async () => {
    const snaps: AnatomyVM[] = [];
    const gw = fakeGateway();
    const ctrl = createAnatomyController(gw, (vm) => snaps.push(vm));
    await ctrl.handle({ type: "open-anatomy", roleName: "Tester" });
    await ctrl.handle({
      type: "role-set-instructions",
      roleName: "Tester",
      instructions: "Always run tests before merging.",
    });
    const written = gw.writtenRoles.at(-1);
    expect(written?.instructions).toBe("Always run tests before merging.");
  });

  // ─── role-attach-skill / role-detach-skill ────────────────────────────────

  it("buildVM populates availableSkills with all known skills minus attached", async () => {
    const snaps: AnatomyVM[] = [];
    const gw = fakeGateway({ skills: ["run-tests"] });
    const ctrl = createAnatomyController(gw, (vm) => snaps.push(vm));
    await ctrl.handle({ type: "open-anatomy", roleName: "Tester" });
    const snap = snaps.at(-1)!;
    // run-tests is attached, so only read-docs is available.
    expect(snap.skills.map((s) => s.name)).toContain("run-tests");
    expect(snap.availableSkills.map((s) => s.name)).toEqual(["read-docs"]);
    expect(snap.availableSkills.map((s) => s.name)).not.toContain("run-tests");
  });

  it("role-attach-skill appends a skill: it shows in vm.skills and leaves vm.availableSkills", async () => {
    const snaps: AnatomyVM[] = [];
    const gw = fakeGateway(); // no skills attached
    const ctrl = createAnatomyController(gw, (vm) => snaps.push(vm));
    await ctrl.handle({ type: "open-anatomy", roleName: "Tester" });
    await ctrl.handle({ type: "role-attach-skill", roleName: "Tester", skillName: "read-docs" });
    const written = gw.writtenRoles.at(-1);
    expect(written?.skills).toContain("read-docs");
    const snap = snaps.at(-1)!;
    expect(snap.skills.map((s) => s.name)).toContain("read-docs");
    expect(snap.availableSkills.map((s) => s.name)).not.toContain("read-docs");
  });

  it("role-attach-skill is idempotent: attaching an already-attached skill does not duplicate", async () => {
    const snaps: AnatomyVM[] = [];
    const gw = fakeGateway({ skills: ["read-docs"] });
    const ctrl = createAnatomyController(gw, (vm) => snaps.push(vm));
    await ctrl.handle({ type: "open-anatomy", roleName: "Tester" });
    await ctrl.handle({ type: "role-attach-skill", roleName: "Tester", skillName: "read-docs" });
    const written = gw.writtenRoles.at(-1);
    const count = (written?.skills ?? []).filter((s) => s === "read-docs").length;
    expect(count).toBe(1);
    const snap = snaps.at(-1)!;
    expect(snap.skills.filter((s) => s.name === "read-docs").length).toBe(1);
  });

  it("role-detach-skill removes a skill: gone from vm.skills, back in vm.availableSkills", async () => {
    const snaps: AnatomyVM[] = [];
    const gw = fakeGateway({ skills: ["run-tests", "read-docs"] });
    const ctrl = createAnatomyController(gw, (vm) => snaps.push(vm));
    await ctrl.handle({ type: "open-anatomy", roleName: "Tester" });
    await ctrl.handle({ type: "role-detach-skill", roleName: "Tester", skillName: "read-docs" });
    const written = gw.writtenRoles.at(-1);
    expect(written?.skills).not.toContain("read-docs");
    expect(written?.skills).toContain("run-tests");
    const snap = snaps.at(-1)!;
    expect(snap.skills.map((s) => s.name)).not.toContain("read-docs");
    expect(snap.availableSkills.map((s) => s.name)).toContain("read-docs");
  });

  it("role-attach-skill on a non-existent role is a no-op (no writeRole, no throw)", async () => {
    const snaps: AnatomyVM[] = [];
    const gw = fakeGateway(undefined, { loadRole: vi.fn(async () => null) });
    const ctrl = createAnatomyController(gw, (vm) => snaps.push(vm));
    await ctrl.handle({ type: "role-attach-skill", roleName: "Ghost", skillName: "read-docs" });
    expect(gw.writtenRoles.length).toBe(0);
  });

  it("role-detach-skill on a non-existent role is a no-op (no writeRole, no throw)", async () => {
    const snaps: AnatomyVM[] = [];
    const gw = fakeGateway(undefined, { loadRole: vi.fn(async () => null) });
    const ctrl = createAnatomyController(gw, (vm) => snaps.push(vm));
    await ctrl.handle({ type: "role-detach-skill", roleName: "Ghost", skillName: "read-docs" });
    expect(gw.writtenRoles.length).toBe(0);
  });
});
