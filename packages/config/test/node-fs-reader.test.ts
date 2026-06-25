import { describe, it, expect, afterEach } from "vitest";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as nodePath from "node:path";
import { makeNodeFsReader } from "../src/loader.js";

/**
 * Real-filesystem regression tests for Issue 27 (S8): a symlink inside
 * .hallucinate/ must not become an arbitrary file-read primitive. The node-backed
 * reader resolves realpaths and refuses targets that escape the .hallucinate
 * boundary, and it skips symlinked directory entries when listing.
 */

const tmpRoots: string[] = [];

async function makeTmpRepo(): Promise<{ repoRoot: string; rolesDir: string; outsideDir: string }> {
  const repoRoot = await fsp.mkdtemp(nodePath.join(os.tmpdir(), "hallucinate-config-"));
  tmpRoots.push(repoRoot);
  const rolesDir = nodePath.join(repoRoot, ".hallucinate", "roles");
  await fsp.mkdir(rolesDir, { recursive: true });
  // A sibling directory OUTSIDE .hallucinate that a malicious symlink may target.
  const outsideDir = nodePath.join(repoRoot, "secrets");
  await fsp.mkdir(outsideDir, { recursive: true });
  return { repoRoot, rolesDir, outsideDir };
}

afterEach(async () => {
  while (tmpRoots.length > 0) {
    const root = tmpRoots.pop();
    if (root) {
      await fsp.rm(root, { recursive: true, force: true });
    }
  }
});

describe("makeNodeFsReader symlink containment (Issue 27)", () => {
  it("reads a regular .yaml file inside .hallucinate", async () => {
    const { rolesDir } = await makeTmpRepo();
    const filePath = nodePath.join(rolesDir, "implementer.yaml");
    await fsp.writeFile(filePath, "name: Implementer\n", "utf-8");

    const reader = await makeNodeFsReader();
    const text = await reader.readFile(filePath);
    expect(text).toContain("Implementer");
  });

  it("refuses to read a symlink inside .hallucinate that points OUTSIDE the dir", async () => {
    const { rolesDir, outsideDir } = await makeTmpRepo();
    const secretPath = nodePath.join(outsideDir, "id_rsa");
    await fsp.writeFile(secretPath, "TOP-SECRET-KEY-MATERIAL", "utf-8");

    const linkPath = nodePath.join(rolesDir, "leak.yaml");
    await fsp.symlink(secretPath, linkPath);

    const reader = await makeNodeFsReader();
    let leaked = "";
    let threw = false;
    try {
      leaked = await reader.readFile(linkPath);
    } catch {
      threw = true;
    }
    // Either it throws or returns nothing, but the secret must NEVER surface.
    expect(threw).toBe(true);
    expect(leaked).not.toContain("TOP-SECRET-KEY-MATERIAL");
  });

  it("skips a symlinked directory entry when listing .yaml files", async () => {
    const { rolesDir, outsideDir } = await makeTmpRepo();
    // A real role file is listed.
    await fsp.writeFile(nodePath.join(rolesDir, "real.yaml"), "name: Real\n", "utf-8");
    // A symlinked .yaml pointing outside is NOT listed.
    const secretPath = nodePath.join(outsideDir, "passwd.yaml");
    await fsp.writeFile(secretPath, "name: Stolen\n", "utf-8");
    await fsp.symlink(secretPath, nodePath.join(rolesDir, "evil.yaml"));

    const reader = await makeNodeFsReader();
    const listed = await reader.listFiles(rolesDir, ".yaml");
    expect(listed).toContain("real.yaml");
    expect(listed).not.toContain("evil.yaml");
  });
});
