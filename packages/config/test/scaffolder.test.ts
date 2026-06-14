import { describe, it, expect } from "vitest";
import { scaffoldIfMissing, STARTER_ROLE } from "../src/scaffolder.js";
import type { FsWriter } from "../src/scaffolder.js";
import { parseRoleYaml } from "../src/parser.js";

function makeFakeWriter(): { writer: FsWriter; written: Map<string, string>; dirs: Set<string> } {
  const written = new Map<string, string>();
  const dirs = new Set<string>();
  const existingDirs = new Set<string>();

  const writer: FsWriter = {
    async writeFile(p: string, content: string): Promise<void> {
      written.set(p, content);
    },
    async exists(p: string): Promise<boolean> {
      if (existingDirs.has(p)) return true;
      for (const k of written.keys()) {
        if (k === p || k.startsWith(p + "/")) return true;
      }
      return false;
    },
    async mkdir(p: string): Promise<void> {
      dirs.add(p);
    },
  };

  return { writer, written, dirs };
}

const ROOT = "/repo";

describe("scaffoldIfMissing", () => {
  it("writes a starter implementer role and config when .conductor/ is absent", async () => {
    const { writer, written } = makeFakeWriter();
    const scaffolded = await scaffoldIfMissing(ROOT, writer);

    expect(scaffolded).toBe(true);
    expect([...written.keys()].some((k) => k.includes("roles/implementer.yaml"))).toBe(true);
    expect([...written.keys()].some((k) => k.includes("config.yaml"))).toBe(true);
  });

  it("the written role YAML parses back to STARTER_ROLE", async () => {
    const { writer, written } = makeFakeWriter();
    await scaffoldIfMissing(ROOT, writer);

    const roleEntry = [...written.entries()].find(([k]) => k.includes("implementer.yaml"));
    expect(roleEntry).toBeDefined();
    const [, yaml] = roleEntry!;
    const parsed = parseRoleYaml(yaml, "test");
    expect(parsed.role.ok).toBe(true);
    if (parsed.role.ok) {
      expect(parsed.role.value.name).toBe(STARTER_ROLE.name);
      expect(parsed.role.value.autonomy).toBe(STARTER_ROLE.autonomy);
    }
  });

  it("returns false and writes nothing when .conductor/ already exists", async () => {
    const { writer, written } = makeFakeWriter();
    // Pre-seed a file so .conductor/ appears to exist.
    written.set(`${ROOT}/.conductor/roles/existing.yaml`, "name: Existing\n");

    const scaffolded = await scaffoldIfMissing(ROOT, writer);
    expect(scaffolded).toBe(false);
    // No new files added.
    expect(written.size).toBe(1);
  });

  it("creates the roles and teams subdirectories", async () => {
    const { writer, dirs } = makeFakeWriter();
    await scaffoldIfMissing(ROOT, writer);

    expect([...dirs].some((d) => d.includes("roles"))).toBe(true);
    expect([...dirs].some((d) => d.includes("teams"))).toBe(true);
  });
});
