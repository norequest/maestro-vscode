import type { FsScanner } from "./scanner.js";
import type { DiscoveredItem } from "./types.js";
import type { McpServerInfo } from "./mcp.js";
import { classify } from "./classifier.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface PluginDiscoverResult {
  items: DiscoveredItem[];
  mcpServers: McpServerInfo[];
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Extracts the file stem (basename without extension). */
function fileStem(filePath: string): string {
  const base = filePath.split("/").pop() ?? filePath;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

/** Write-signal heuristic: name or args mention write/edit/fs/file. */
const WRITE_SIGNAL = /write|edit|fs\b|file/i;

function inferWriteCapable(name: string, args: string[]): boolean {
  if (WRITE_SIGNAL.test(name)) return true;
  return args.some((a) => WRITE_SIGNAL.test(a));
}

// ---------------------------------------------------------------------------
// plugin.json schema types (all fields optional/nullable)
// ---------------------------------------------------------------------------

interface PluginAgentEntry {
  file?: string;
  name?: string;
}

interface PluginSkillEntry {
  file?: string;
  name?: string;
}

interface PluginMcpServerEntry {
  command?: string;
  args?: string[];
  description?: string;
}

interface PluginJson {
  name?: string;
  description?: string;
  agents?: PluginAgentEntry[];
  skills?: PluginSkillEntry[];
  mcpServers?: Record<string, PluginMcpServerEntry>;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Discovers agents, skills, and MCP servers from Copilot installed plugins.
 *
 * Walk path:
 *   {home}/.copilot/installed-plugins/{marketplace}/{plugin}/.github/plugin/plugin.json
 *
 * Never throws. Silently skips missing or malformed plugin.json files.
 * listDirs is expected to exclude symlinked directories (symlink-safe contract).
 */
export async function discoverPlugins(home: string, fs: FsScanner): Promise<PluginDiscoverResult> {
  const items: DiscoveredItem[] = [];
  const mcpServers: McpServerInfo[] = [];

  const pluginsRoot = `${home}/.copilot/installed-plugins`;

  let marketplaceDirs: string[];
  try {
    marketplaceDirs = await fs.listDirs(pluginsRoot);
  } catch {
    return { items, mcpServers };
  }

  for (const marketplace of marketplaceDirs) {
    const marketplaceDir = `${pluginsRoot}/${marketplace}`;

    let pluginDirs: string[];
    try {
      pluginDirs = await fs.listDirs(marketplaceDir);
    } catch {
      continue;
    }

    for (const plugin of pluginDirs) {
      const pluginDir = `${marketplaceDir}/${plugin}`;
      const pluginJsonPath = `${pluginDir}/.github/plugin/plugin.json`;

      let pluginJson: PluginJson;
      try {
        const exists = await fs.exists(pluginJsonPath);
        if (!exists) continue;
        const text = await fs.readFile(pluginJsonPath);
        const parsed = JSON.parse(text) as unknown;
        if (typeof parsed !== "object" || parsed === null) continue;
        pluginJson = parsed as PluginJson;
      } catch {
        // Malformed or unreadable plugin.json: skip silently.
        continue;
      }

      const pluginStem = plugin;
      const pluginName = typeof pluginJson.name === "string" ? pluginJson.name : undefined;
      const pluginDescription = typeof pluginJson.description === "string" ? pluginJson.description : "";

      // Process agents.
      if (Array.isArray(pluginJson.agents)) {
        for (const entry of pluginJson.agents) {
          if (typeof entry !== "object" || entry === null) continue;
          const fileRel = typeof entry.file === "string" ? entry.file : "";
          if (!fileRel) continue;
          const source = `${pluginDir}/${fileRel}`;
          const name =
            typeof entry.name === "string" && entry.name.trim() !== ""
              ? entry.name
              : fileStem(fileRel);
          const item: DiscoveredItem = {
            kind: "plugin-agent",
            confidence: classify("plugin-agent"),
            name,
            description: pluginDescription,
            body: "",
            declaredTools: [],
            engineHint: "copilot",
            source,
            pluginStem,
            pluginName,
            isSkill: false,
          };
          items.push(item);
        }
      }

      // Process skills.
      if (Array.isArray(pluginJson.skills)) {
        for (const entry of pluginJson.skills) {
          if (typeof entry !== "object" || entry === null) continue;
          const fileRel = typeof entry.file === "string" ? entry.file : "";
          if (!fileRel) continue;
          const source = `${pluginDir}/${fileRel}`;
          const name =
            typeof entry.name === "string" && entry.name.trim() !== ""
              ? entry.name
              : fileStem(fileRel);
          const item: DiscoveredItem = {
            kind: "plugin-skill",
            confidence: classify("plugin-skill"),
            name,
            description: pluginDescription,
            body: "",
            declaredTools: [],
            source,
            pluginStem,
            pluginName,
            isSkill: true,
          };
          items.push(item);
        }
      }

      // Process mcpServers.
      if (
        typeof pluginJson.mcpServers === "object" &&
        pluginJson.mcpServers !== null
      ) {
        for (const [serverName, serverEntry] of Object.entries(pluginJson.mcpServers)) {
          const entry =
            typeof serverEntry === "object" && serverEntry !== null
              ? (serverEntry as PluginMcpServerEntry)
              : {};
          const description =
            typeof entry.description === "string" ? entry.description : undefined;
          const rawArgs = Array.isArray(entry.args) ? entry.args : [];
          const args = rawArgs.filter((a): a is string => typeof a === "string");
          mcpServers.push({
            name: serverName,
            description,
            writeCapable: inferWriteCapable(serverName, args),
          });
        }
      }
    }
  }

  return { items, mcpServers };
}
