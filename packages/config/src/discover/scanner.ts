import * as nodePath from "node:path";
import type { FsReader } from "../loader.js";
import type { DiscoveredItem } from "./types.js";
import type { McpInventory } from "./mcp.js";
import { parseDiscoveredFile } from "./sources.js";
import { readMcpInventory } from "./mcp.js";
import { dedupeDiscoveredAgents } from "./dedupe.js";
import type { SourceKind } from "./types.js";

/**
 * FsScanner is FsReader with symlink-safe directory listings.
 * The node-backed FsReader already satisfies this (listDirs skips symlinks).
 * A fake FsScanner in tests can omit symlinked entries from listDirs return values.
 */
export type FsScanner = FsReader;

export interface DiscoverResult {
  items: DiscoveredItem[];
  mcp: McpInventory;
  skipped: string[];
}

/**
 * Walk a bounded allowlist of directories under root and parse every
 * agent/role/skill/instructions file into DiscoveredItems.
 *
 * Never throws. Unreadable files are pushed to skipped.
 * listDirs is expected to exclude symlinked directories (symlink-safe contract).
 */
export async function discoverWorkspace(root: string, fs: FsScanner): Promise<DiscoverResult> {
  const items: DiscoveredItem[] = [];
  const skipped: string[] = [];

  async function readItem(filePath: string, kind: SourceKind): Promise<void> {
    try {
      const text = await fs.readFile(filePath);
      items.push(parseDiscoveredFile(kind, text, filePath));
    } catch {
      skipped.push(filePath);
    }
  }

  // --- .github/agents/*.agent.md -> copilot-agent ---
  await scanDir(
    nodePath.join(root, ".github", "agents"),
    ".agent.md",
    "copilot-agent",
  );

  // --- .github/chatmodes/*.chatmode.md -> copilot-chatmode ---
  await scanDir(
    nodePath.join(root, ".github", "chatmodes"),
    ".chatmode.md",
    "copilot-chatmode",
  );

  // --- .claude/agents/*.md -> claude-agent ---
  await scanDir(
    nodePath.join(root, ".claude", "agents"),
    ".md",
    "claude-agent",
  );

  // --- .claude/skills/<subdir>/SKILL.md -> claude-skill ---
  await scanSkillDirs(nodePath.join(root, ".claude", "skills"));

  // --- .hallucinate/roles/*.yaml -> hallucinate-role ---
  await scanDir(
    nodePath.join(root, ".hallucinate", "roles"),
    ".yaml",
    "hallucinate-role",
  );

  // --- .continue/agents/*.yaml -> continue-agent ---
  await scanDir(
    nodePath.join(root, ".continue", "agents"),
    ".yaml",
    "continue-agent",
  );

  // --- .cursor/rules/*.mdc -> cursor-rule ---
  await scanDir(
    nodePath.join(root, ".cursor", "rules"),
    ".mdc",
    "cursor-rule",
  );

  // --- root-level instruction files ---
  for (const name of ["AGENTS.md", "CLAUDE.md", "GEMINI.md"]) {
    const filePath = nodePath.join(root, name);
    try {
      if (await fs.exists(filePath)) {
        await readItem(filePath, "instructions");
      }
    } catch {
      skipped.push(filePath);
    }
  }

  // --- .github/copilot-instructions.md ---
  const copilotInstructionsPath = nodePath.join(root, ".github", "copilot-instructions.md");
  try {
    if (await fs.exists(copilotInstructionsPath)) {
      await readItem(copilotInstructionsPath, "instructions");
    }
  } catch {
    skipped.push(copilotInstructionsPath);
  }

  // --- root-level *.prompt.md (shallow scan of root only) ---
  await scanDir(root, ".prompt.md", "prompt");

  // --- MCP inventory (never throws) ---
  const mcp = await readMcpInventory(root, fs).catch(() => ({ servers: [] }));

  // Dedup agents as the LAST step before returning. The same logical agent can
  // exist as both a canonical .hallucinate/roles/*.yaml role and a
  // .github/agents/*.agent.md Copilot mirror that Hallucinate itself writes, so
  // without this collapse the same agent would appear twice in the Discover view.
  // Only items are deduped; mcp and skipped are returned untouched.
  return { items: dedupeDiscoveredAgents(items), mcp, skipped };

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  async function scanDir(dir: string, ext: string, kind: SourceKind): Promise<void> {
    let names: string[];
    try {
      names = await fs.listFiles(dir, ext);
    } catch {
      // Directory does not exist or is unreadable: skip silently.
      return;
    }
    for (const name of names) {
      await readItem(nodePath.join(dir, name), kind);
    }
  }

  async function scanSkillDirs(skillsRoot: string): Promise<void> {
    let subdirs: string[];
    try {
      subdirs = await fs.listDirs(skillsRoot);
    } catch {
      return;
    }
    for (const sub of subdirs) {
      const skillFile = nodePath.join(skillsRoot, sub, "SKILL.md");
      await readItem(skillFile, "claude-skill");
    }
  }
}
