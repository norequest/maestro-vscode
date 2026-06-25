import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeConfigGateway } from "../src/config-gateway.js";

/**
 * R6 containment: the gateway must refuse skill/role names that are not a clean
 * single path segment, BEFORE building any filesystem path, so a write or remove
 * can never escape its home dir (.github/skills/ for skills, .conductor/ for
 * roles and teams). assertSafeSegment runs ahead of any fs access, so these
 * reject without touching disk.
 */
describe("config-gateway · path-segment containment (R6)", () => {
  const gw = makeConfigGateway("/tmp/maestro-test-repo");

  it("refuses a traversal skill name on save", async () => {
    await expect(gw.saveSkill({ name: "../../etc", description: "x" }, "body")).rejects.toThrow(
      /single path segment/,
    );
  });

  it("refuses a separator-bearing skill name on save", async () => {
    await expect(gw.saveSkill({ name: "a/b", description: "x" }, "body")).rejects.toThrow(
      /single path segment/,
    );
  });

  it("refuses a traversal skill name on delete", async () => {
    await expect(gw.deleteSkill("../../../etc")).rejects.toThrow(/single path segment/);
  });

  it('refuses "." and ".." skill names', async () => {
    await expect(gw.deleteSkill("..")).rejects.toThrow(/single path segment/);
    await expect(gw.deleteSkill(".")).rejects.toThrow(/single path segment/);
  });

  it("refuses a backslash-bearing skill name", async () => {
    await expect(gw.deleteSkill("a\\b")).rejects.toThrow(/single path segment/);
  });

  // ── Group 1: role file writes/removes are single-segment guarded ────────────

  it("refuses a traversal role name on seedRole", async () => {
    await expect(gw.seedRole({ name: "../../etc" })).rejects.toThrow(/single path segment/);
  });

  it("refuses a separator-bearing role name on deleteRole", async () => {
    await expect(gw.deleteRole("a/b")).rejects.toThrow(/single path segment/);
  });

  // ── Group 2: team file writes/removes are single-segment guarded ────────────

  it("refuses a traversal team name on writeTeam", async () => {
    await expect(gw.writeTeam({ name: "../evil", roleNames: [] })).rejects.toThrow(
      /single path segment/,
    );
  });

  it("refuses a separator-bearing team name on deleteTeam", async () => {
    await expect(gw.deleteTeam("a/b")).rejects.toThrow(/single path segment/);
  });
});

/**
 * End-to-end against a real OS temp dir, exercising makeNodeFsWriter + the new
 * removeFile primitive. Confirms seedRole/writeTeam land a YAML file and
 * deleteRole/deleteTeam remove it (including the no-op on a missing file).
 */
describe("config-gateway · role + team file writes (real fs)", () => {
  it("seedRole writes a role yaml; deleteRole removes it", async () => {
    const root = await mkdtemp(join(tmpdir(), "maestro-gw-"));
    try {
      const gw = makeConfigGateway(root);
      await gw.seedRole({ name: "Reviewer" });
      const rolePath = join(root, ".conductor", "roles", "reviewer.yaml");
      const text = await readFile(rolePath, "utf8");
      expect(text).toContain("name: Reviewer");
      expect(text).toContain("id: copilot");

      await gw.deleteRole("Reviewer");
      await expect(readFile(rolePath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("writeTeam stores roles as NAME strings; deleteTeam removes the file", async () => {
    const root = await mkdtemp(join(tmpdir(), "maestro-gw-"));
    try {
      const gw = makeConfigGateway(root);
      await gw.writeTeam({ name: "Checkout Squad", roleNames: ["Tester", "Reviewer"] });
      const teamPath = join(root, ".conductor", "teams", "checkout-squad.yaml");
      const text = await readFile(teamPath, "utf8");
      expect(text).toContain("name: Checkout Squad");
      // Role references are plain name strings, not nested role objects.
      expect(text).toContain("- Tester");
      expect(text).toContain("- Reviewer");

      await gw.deleteTeam("Checkout Squad");
      await expect(readFile(teamPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("deleteRole on a missing file is a no-op (does not throw)", async () => {
    const root = await mkdtemp(join(tmpdir(), "maestro-gw-"));
    try {
      // Create the .conductor dir so the containment guard is satisfied but the
      // file is absent.
      await mkdir(join(root, ".conductor", "roles"), { recursive: true });
      const gw = makeConfigGateway(root);
      await expect(gw.deleteRole("ghost")).resolves.toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

/**
 * Library "Skills" tab create/edit/delete must operate on .github/skills/, the
 * same home VS Code and Copilot read (not the legacy .conductor/skills/). These
 * pin the exact on-disk path a saveSkill lands and a deleteSkill removes.
 */
describe("config-gateway · skill file writes land under .github/skills (real fs)", () => {
  it("saveSkill writes .github/skills/<name>/SKILL.md; deleteSkill removes it", async () => {
    const root = await mkdtemp(join(tmpdir(), "maestro-gw-"));
    try {
      const gw = makeConfigGateway(root);
      await gw.saveSkill(
        { name: "run-tests", description: "Run the test suite before reporting done." },
        "# Run tests\n\nUse the project test runner.\n",
      );
      const skillPath = join(root, ".github", "skills", "run-tests", "SKILL.md");
      const text = await readFile(skillPath, "utf8");
      expect(text).toContain("name: run-tests");
      expect(text).toContain("Run the test suite before reporting done.");
      expect(text).toContain("Use the project test runner.");

      // It must NOT land in the legacy .conductor/skills/ location.
      const legacyPath = join(root, ".conductor", "skills", "run-tests", "SKILL.md");
      await expect(readFile(legacyPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });

      await gw.deleteSkill("run-tests");
      await expect(readFile(skillPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
