import { describe, it, expect } from "vitest";
import { readMcpInventory } from "../../src/discover/mcp.js";
import type { FsReader } from "../../src/loader.js";

// ---------------------------------------------------------------------------
// Fixture content (mirroring test/discover/fixtures/repo/)
// ---------------------------------------------------------------------------

const DOT_MCP_JSON = JSON.stringify({
  mcpServers: {
    filesystem: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
      description: "Read-only filesystem access",
    },
    "code-search": {
      command: "npx",
      args: ["-y", "mcp-server-search"],
      description: "Search codebase",
    },
  },
});

const VSCODE_MCP_JSON = JSON.stringify({
  servers: [
    {
      name: "file-writer",
      description: "Write files to disk",
      command: "npx",
      args: ["-y", "mcp-file-writer"],
    },
    {
      name: "code-search",
      description: "Search codebase (vscode override)",
    },
  ],
});

// ---------------------------------------------------------------------------
// Fake FsReader helpers
// ---------------------------------------------------------------------------

/**
 * Build a FsReader that serves a fixed set of path-to-content mappings.
 * Any path not in the map behaves as "does not exist".
 */
function makeFakeFs(files: Record<string, string>): FsReader {
  return {
    async readFile(path: string): Promise<string> {
      if (path in files) return files[path] as string;
      throw new Error(`ENOENT: ${path}`);
    },
    async listFiles(): Promise<string[]> {
      return [];
    },
    async listDirs(): Promise<string[]> {
      return [];
    },
    async exists(path: string): Promise<boolean> {
      return path in files;
    },
  };
}

const REPO_ROOT = "/workspace/repo";
const DOT_MCP_PATH = `${REPO_ROOT}/.mcp.json`;
const VSCODE_MCP_PATH = `${REPO_ROOT}/.vscode/mcp.json`;

/** A fake FsReader serving both fixture files. */
const BOTH_FILES_FS = makeFakeFs({
  [DOT_MCP_PATH]: DOT_MCP_JSON,
  [VSCODE_MCP_PATH]: VSCODE_MCP_JSON,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("readMcpInventory: reads from .mcp.json", () => {
  it("includes servers declared in .mcp.json", async () => {
    const fs = makeFakeFs({ [DOT_MCP_PATH]: DOT_MCP_JSON });
    const inv = await readMcpInventory(REPO_ROOT, fs);
    const names = inv.servers.map((s) => s.name);
    expect(names).toContain("filesystem");
    expect(names).toContain("code-search");
  });
});

describe("readMcpInventory: reads from .vscode/mcp.json", () => {
  it("includes servers declared in .vscode/mcp.json", async () => {
    const fs = makeFakeFs({ [VSCODE_MCP_PATH]: VSCODE_MCP_JSON });
    const inv = await readMcpInventory(REPO_ROOT, fs);
    const names = inv.servers.map((s) => s.name);
    expect(names).toContain("file-writer");
    expect(names).toContain("code-search");
  });
});

describe("readMcpInventory: union by name", () => {
  it("merges both sources into a unique-name list", async () => {
    const inv = await readMcpInventory(REPO_ROOT, BOTH_FILES_FS);
    const names = inv.servers.map((s) => s.name).sort();
    expect(names).toEqual(["code-search", "file-writer", "filesystem"]);
  });

  it("first occurrence wins: code-search keeps .mcp.json description", async () => {
    const inv = await readMcpInventory(REPO_ROOT, BOTH_FILES_FS);
    const cs = inv.servers.find((s) => s.name === "code-search");
    expect(cs?.description).toBe("Search codebase");
  });
});

describe("readMcpInventory: descriptions", () => {
  it("filesystem carries its description", async () => {
    const inv = await readMcpInventory(REPO_ROOT, BOTH_FILES_FS);
    const fs_ = inv.servers.find((s) => s.name === "filesystem");
    expect(fs_?.description).toBe("Read-only filesystem access");
  });
});

describe("readMcpInventory: writeCapable heuristic", () => {
  it("filesystem is writeCapable (name contains 'fs')", async () => {
    const inv = await readMcpInventory(REPO_ROOT, BOTH_FILES_FS);
    const server = inv.servers.find((s) => s.name === "filesystem");
    expect(server?.writeCapable).toBe(true);
  });

  it("file-writer is writeCapable (name contains 'write')", async () => {
    const inv = await readMcpInventory(REPO_ROOT, BOTH_FILES_FS);
    const server = inv.servers.find((s) => s.name === "file-writer");
    expect(server?.writeCapable).toBe(true);
  });

  it("code-search is NOT writeCapable (no write/edit/fs signal)", async () => {
    const inv = await readMcpInventory(REPO_ROOT, BOTH_FILES_FS);
    const server = inv.servers.find((s) => s.name === "code-search");
    expect(server?.writeCapable).toBe(false);
  });
});

describe("readMcpInventory: resilience", () => {
  it("does not throw when .vscode/mcp.json is malformed JSON", async () => {
    const fs = makeFakeFs({
      [DOT_MCP_PATH]: DOT_MCP_JSON,
      [VSCODE_MCP_PATH]: "{ bad json",
    });
    await expect(readMcpInventory(REPO_ROOT, fs)).resolves.toBeDefined();
  });

  it("malformed .vscode/mcp.json contributes no servers from that file", async () => {
    const fs = makeFakeFs({
      [DOT_MCP_PATH]: DOT_MCP_JSON,
      [VSCODE_MCP_PATH]: "{ bad json",
    });
    const inv = await readMcpInventory(REPO_ROOT, fs);
    // Only .mcp.json servers should appear (file-writer is from vscode only)
    const names = inv.servers.map((s) => s.name);
    expect(names).toContain("filesystem");
    expect(names).toContain("code-search");
    expect(names).not.toContain("file-writer");
  });

  it("does not throw when both files are missing", async () => {
    const fs = makeFakeFs({});
    await expect(readMcpInventory(REPO_ROOT, fs)).resolves.toBeDefined();
  });

  it("returns empty servers when both files are missing", async () => {
    const fs = makeFakeFs({});
    const inv = await readMcpInventory(REPO_ROOT, fs);
    expect(inv.servers).toHaveLength(0);
  });
});
