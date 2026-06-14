import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FsPersistenceBackend } from "../src/persistence-fs.js";

/**
 * Direct tests for the production node:fs backend over a real temp dir.
 * FsPersistenceBackend imports only node:fs/promises + node:path (plus the pure
 * safe-id helpers), so it has no vscode dependency and is unit-testable here.
 */
describe("FsPersistenceBackend (real fs)", () => {
  let repoRoot: string;
  let backend: FsPersistenceBackend;
  // `.conductor/.runtime` is the on-disk layout the backend uses under repoRoot.
  const runtimeDir = (root: string): string => join(root, ".conductor", ".runtime");

  beforeEach(async () => {
    repoRoot = await mkdtemp(join(tmpdir(), "maestro-fs-persist-"));
    backend = new FsPersistenceBackend(repoRoot);
  });

  afterEach(async () => {
    await rm(repoRoot, { recursive: true, force: true });
  });

  describe("read", () => {
    it("returns '' when the file does not exist (ENOENT-safe)", async () => {
      expect(await backend.read("missing")).toBe("");
    });

    it("re-reads written content after append", async () => {
      await backend.append("a1", "line1\n");
      expect(await backend.read("a1")).toBe("line1\n");
    });
  });

  describe("append", () => {
    it("lazily creates the .conductor/.runtime dir and file on first write", async () => {
      // The runtime dir does not exist until the first append.
      await expect(readFile(join(runtimeDir(repoRoot), "a1.jsonl"), "utf8")).rejects.toMatchObject({
        code: "ENOENT",
      });
      await backend.append("a1", "first\n");
      expect(await readFile(join(runtimeDir(repoRoot), "a1.jsonl"), "utf8")).toBe("first\n");
    });

    it("round-trips a JSONL line and accumulates across appends", async () => {
      await backend.append("a1", '{"kind":"agent-event"}\n');
      expect(await backend.read("a1")).toBe('{"kind":"agent-event"}\n');
      await backend.append("a1", "second\n");
      await backend.append("a1", "third\n");
      expect(await backend.read("a1")).toBe('{"kind":"agent-event"}\nsecond\nthird\n');
    });
  });

  describe("listAgentIds", () => {
    it("returns [] when the runtime dir is missing", async () => {
      expect(await backend.listAgentIds()).toEqual([]);
    });

    it("returns the written ids after appends", async () => {
      await backend.append("a1", "x\n");
      await backend.append("a2", "y\n");
      expect((await backend.listAgentIds()).sort()).toEqual(["a1", "a2"]);
    });

    it("filters out unsafe/invalid on-disk filenames and non-jsonl files", async () => {
      await backend.append("good-1", "x\n");
      // Plant files an external process could have dropped: an unsafe traversal
      // name, a dotfile-only name, and a non-jsonl file. None must be returned.
      const dir = runtimeDir(repoRoot);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "...jsonl"), "junk\n", "utf8");
      await writeFile(join(dir, "notes.txt"), "junk\n", "utf8");
      const ids = await backend.listAgentIds();
      expect(ids).toEqual(["good-1"]);
    });
  });

  describe("remove", () => {
    it("deletes the file so a subsequent read returns ''", async () => {
      await backend.append("a1", "x\n");
      await backend.remove("a1");
      expect(await backend.read("a1")).toBe("");
      expect(await backend.listAgentIds()).toEqual([]);
    });

    it("is ENOENT-safe: removing a missing id does not throw", async () => {
      await expect(backend.remove("never-existed")).resolves.toBeUndefined();
    });
  });

  describe("filename safety", () => {
    it("rejects an id with a slash rather than escaping the dir", async () => {
      await expect(backend.append("a/b", "x\n")).rejects.toThrow();
      await expect(backend.read("a/b")).rejects.toThrow();
      await expect(backend.remove("a/b")).rejects.toThrow();
    });

    it("rejects a backslash id", async () => {
      await expect(backend.append("a\\b", "x\n")).rejects.toThrow();
    });

    it("rejects a traversal id (..) rather than escaping the dir", async () => {
      await expect(backend.append("..", "x\n")).rejects.toThrow();
      await expect(backend.append("../escape", "x\n")).rejects.toThrow();
    });
  });
});
