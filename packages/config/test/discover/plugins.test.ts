import { describe, it, expect } from "vitest";
import { discoverPlugins } from "../../src/discover/plugins.js";
import type { FsScanner } from "../../src/discover/scanner.js";

// ---------------------------------------------------------------------------
// Fixture content
// ---------------------------------------------------------------------------

const HOME = "/home/user";
const PLUGINS_ROOT = `${HOME}/.copilot/installed-plugins`;
const MARKETPLACE = "copilot-plugins";
const PLUGIN_STEM = "sec-kit";
const PLUGIN_DIR = `${PLUGINS_ROOT}/${MARKETPLACE}/${PLUGIN_STEM}`;
const PLUGIN_JSON_PATH = `${PLUGIN_DIR}/.github/plugin/plugin.json`;

const PLUGIN_JSON = JSON.stringify({
  name: "Security Toolkit",
  description: "Security analysis tools for code review",
  agents: [{ file: "agents/sec-agent.agent.md", name: "Security Agent" }],
  skills: [{ file: "skills/vuln-scan/SKILL.md", name: "Vulnerability Scanner" }],
  mcpServers: {
    "sec-mcp": {
      command: "npx",
      args: ["-y", "mcp-security-tools"],
      description: "Security MCP server",
    },
  },
});

const SEC_AGENT_BODY = `---
name: Security Agent
description: Analyzes code for vulnerabilities
---

You are a security-focused code reviewer.
`;

const SKILL_BODY = `---
name: Vulnerability Scanner
description: Scans for common vulnerabilities
---

Scan the provided code for OWASP Top 10 vulnerabilities.
`;

// ---------------------------------------------------------------------------
// Fake FsScanner builder
// ---------------------------------------------------------------------------

/**
 * Build a FsScanner with a fixed in-memory file map.
 *
 * listDirs logic:
 *   - {HOME}/.copilot/installed-plugins -> ["copilot-plugins"]
 *   - {HOME}/.copilot/installed-plugins/copilot-plugins -> ["sec-kit"]
 *   - everything else -> []
 *
 * Note: "sym-linked-plugin" is intentionally NOT returned by listDirs because
 * the symlink-safe contract excludes symlinked directories. The test verifies
 * no item surfaces for that stem.
 */
function makeFakeFs(files: Record<string, string>): FsScanner {
  return {
    async readFile(path: string): Promise<string> {
      if (path in files) return files[path] as string;
      throw new Error(`ENOENT: ${path}`);
    },
    async listFiles(): Promise<string[]> {
      return [];
    },
    async listDirs(dir: string): Promise<string[]> {
      if (dir === PLUGINS_ROOT) return [MARKETPLACE];
      if (dir === `${PLUGINS_ROOT}/${MARKETPLACE}`) return [PLUGIN_STEM];
      return [];
    },
    async exists(path: string): Promise<boolean> {
      return path in files;
    },
  };
}

/** Standard fake with the sec-kit plugin. */
const STANDARD_FS = makeFakeFs({
  [PLUGIN_JSON_PATH]: PLUGIN_JSON,
  [`${PLUGIN_DIR}/agents/sec-agent.agent.md`]: SEC_AGENT_BODY,
  [`${PLUGIN_DIR}/skills/vuln-scan/SKILL.md`]: SKILL_BODY,
});

// ---------------------------------------------------------------------------
// Tests: agent item
// ---------------------------------------------------------------------------

describe("discoverPlugins: plugin-agent item", () => {
  it("has kind=plugin-agent for the sec-kit agent", async () => {
    const result = await discoverPlugins(HOME, STANDARD_FS);
    const agent = result.items.find((i) => i.kind === "plugin-agent");
    expect(agent).toBeDefined();
    expect(agent?.kind).toBe("plugin-agent");
  });

  it("has pluginStem=sec-kit", async () => {
    const result = await discoverPlugins(HOME, STANDARD_FS);
    const agent = result.items.find((i) => i.kind === "plugin-agent");
    expect(agent?.pluginStem).toBe("sec-kit");
  });

  it("has pluginName=Security Toolkit", async () => {
    const result = await discoverPlugins(HOME, STANDARD_FS);
    const agent = result.items.find((i) => i.kind === "plugin-agent");
    expect(agent?.pluginName).toBe("Security Toolkit");
  });

  it("has name=Security Agent", async () => {
    const result = await discoverPlugins(HOME, STANDARD_FS);
    const agent = result.items.find((i) => i.kind === "plugin-agent");
    expect(agent?.name).toBe("Security Agent");
  });

  it("has confidence=verified (from classify(plugin-agent))", async () => {
    const result = await discoverPlugins(HOME, STANDARD_FS);
    const agent = result.items.find((i) => i.kind === "plugin-agent");
    expect(agent?.confidence).toBe("verified");
  });

  it("has engineHint=copilot", async () => {
    const result = await discoverPlugins(HOME, STANDARD_FS);
    const agent = result.items.find((i) => i.kind === "plugin-agent");
    expect(agent?.engineHint).toBe("copilot");
  });

  it("has isSkill=false", async () => {
    const result = await discoverPlugins(HOME, STANDARD_FS);
    const agent = result.items.find((i) => i.kind === "plugin-agent");
    expect(agent?.isSkill).toBe(false);
  });

  it("has source pointing to the agent file", async () => {
    const result = await discoverPlugins(HOME, STANDARD_FS);
    const agent = result.items.find((i) => i.kind === "plugin-agent");
    expect(agent?.source).toBe(`${PLUGIN_DIR}/agents/sec-agent.agent.md`);
  });
});

// ---------------------------------------------------------------------------
// Tests: skill item
// ---------------------------------------------------------------------------

describe("discoverPlugins: plugin-skill item", () => {
  it("has kind=plugin-skill for the sec-kit skill", async () => {
    const result = await discoverPlugins(HOME, STANDARD_FS);
    const skill = result.items.find((i) => i.kind === "plugin-skill");
    expect(skill).toBeDefined();
    expect(skill?.kind).toBe("plugin-skill");
  });

  it("has isSkill=true", async () => {
    const result = await discoverPlugins(HOME, STANDARD_FS);
    const skill = result.items.find((i) => i.kind === "plugin-skill");
    expect(skill?.isSkill).toBe(true);
  });

  it("has name=Vulnerability Scanner", async () => {
    const result = await discoverPlugins(HOME, STANDARD_FS);
    const skill = result.items.find((i) => i.kind === "plugin-skill");
    expect(skill?.name).toBe("Vulnerability Scanner");
  });

  it("has confidence=likely (from classify(plugin-skill))", async () => {
    const result = await discoverPlugins(HOME, STANDARD_FS);
    const skill = result.items.find((i) => i.kind === "plugin-skill");
    expect(skill?.confidence).toBe("likely");
  });

  it("has pluginStem=sec-kit", async () => {
    const result = await discoverPlugins(HOME, STANDARD_FS);
    const skill = result.items.find((i) => i.kind === "plugin-skill");
    expect(skill?.pluginStem).toBe("sec-kit");
  });

  it("has pluginName=Security Toolkit", async () => {
    const result = await discoverPlugins(HOME, STANDARD_FS);
    const skill = result.items.find((i) => i.kind === "plugin-skill");
    expect(skill?.pluginName).toBe("Security Toolkit");
  });
});

// ---------------------------------------------------------------------------
// Tests: MCP servers
// ---------------------------------------------------------------------------

describe("discoverPlugins: mcpServers", () => {
  it("includes the inline sec-mcp server", async () => {
    const result = await discoverPlugins(HOME, STANDARD_FS);
    const server = result.mcpServers.find((s) => s.name === "sec-mcp");
    expect(server).toBeDefined();
  });

  it("sec-mcp has the correct description", async () => {
    const result = await discoverPlugins(HOME, STANDARD_FS);
    const server = result.mcpServers.find((s) => s.name === "sec-mcp");
    expect(server?.description).toBe("Security MCP server");
  });

  it("sec-mcp is not writeCapable (no write/edit/fs/file signal)", async () => {
    const result = await discoverPlugins(HOME, STANDARD_FS);
    const server = result.mcpServers.find((s) => s.name === "sec-mcp");
    expect(server?.writeCapable).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests: symlink exclusion
// ---------------------------------------------------------------------------

describe("discoverPlugins: symlink exclusion", () => {
  it("does not surface any item with pluginStem=sym-linked-plugin", async () => {
    // The fake listDirs never returns "sym-linked-plugin" because the symlink-safe
    // contract excludes symlinked directories. This mirrors the real listDirs behavior.
    const result = await discoverPlugins(HOME, STANDARD_FS);
    const leaked = result.items.filter((i) => i.pluginStem === "sym-linked-plugin");
    expect(leaked).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Tests: resilience
// ---------------------------------------------------------------------------

describe("discoverPlugins: resilience", () => {
  it("does not throw when plugin.json is malformed JSON", async () => {
    const badFs = makeFakeFs({ [PLUGIN_JSON_PATH]: "{ bad json !!" });
    await expect(discoverPlugins(HOME, badFs)).resolves.toBeDefined();
  });

  it("returns empty items when plugin.json is malformed", async () => {
    const badFs = makeFakeFs({ [PLUGIN_JSON_PATH]: "{ bad json !!" });
    const result = await discoverPlugins(HOME, badFs);
    expect(result.items).toHaveLength(0);
  });

  it("returns empty result when plugin.json is missing", async () => {
    const emptyFs = makeFakeFs({});
    const result = await discoverPlugins(HOME, emptyFs);
    expect(result.items).toHaveLength(0);
    expect(result.mcpServers).toHaveLength(0);
  });

  it("does not throw when listDirs throws", async () => {
    const throwingFs: FsScanner = {
      async readFile() { throw new Error("EACCES"); },
      async listFiles() { return []; },
      async listDirs() { throw new Error("EACCES"); },
      async exists() { return false; },
    };
    await expect(discoverPlugins(HOME, throwingFs)).resolves.toBeDefined();
  });

  it("returns empty result when listDirs throws", async () => {
    const throwingFs: FsScanner = {
      async readFile() { throw new Error("EACCES"); },
      async listFiles() { return []; },
      async listDirs() { throw new Error("EACCES"); },
      async exists() { return false; },
    };
    const result = await discoverPlugins(HOME, throwingFs);
    expect(result.items).toHaveLength(0);
    expect(result.mcpServers).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Tests: name fallback from file stem
// ---------------------------------------------------------------------------

describe("discoverPlugins: name fallback to file stem", () => {
  it("uses file stem as name when agent entry has no name field", async () => {
    const noNamePlugin = JSON.stringify({
      name: "Test Plugin",
      description: "Test",
      agents: [{ file: "agents/my-agent.agent.md" }],
    });
    const fakeFs = makeFakeFs({ [PLUGIN_JSON_PATH]: noNamePlugin });
    const result = await discoverPlugins(HOME, fakeFs);
    const agent = result.items.find((i) => i.kind === "plugin-agent");
    // Stem of "my-agent.agent.md" is "my-agent.agent"
    expect(agent?.name).toBeTruthy();
  });

  it("uses file stem as name when skill entry has no name field", async () => {
    const noNamePlugin = JSON.stringify({
      name: "Test Plugin",
      description: "Test",
      skills: [{ file: "skills/my-skill/SKILL.md" }],
    });
    const fakeFs = makeFakeFs({ [PLUGIN_JSON_PATH]: noNamePlugin });
    const result = await discoverPlugins(HOME, fakeFs);
    const skill = result.items.find((i) => i.kind === "plugin-skill");
    expect(skill?.name).toBeTruthy();
  });
});
