import { parse as parseYaml } from "yaml";
import type { DiscoveredItem, SourceKind } from "./types.js";
import { classify } from "./classifier.js";

/**
 * Split a markdown/text file into its YAML frontmatter and body.
 *
 * Rules:
 * - If the text starts with a `---` line: parse everything up to the next
 *   `---` line as YAML; body is everything after the closing fence.
 * - If there is no opening `---` fence: frontmatter is {}, body is the full text.
 * - If the YAML inside the fence is malformed: frontmatter is {}, body is
 *   everything after the closing fence (or the full text if no closing fence).
 *
 * NEVER throws.
 */
export function splitFrontmatter(text: string): { frontmatter: Record<string, unknown>; body: string } {
  // Strip UTF-8 BOM if present.
  const stripped = text.startsWith("﻿") ? text.slice(1) : text;

  // Check for opening fence on first line.
  if (!stripped.startsWith("---")) {
    return { frontmatter: {}, body: stripped };
  }

  // Find the closing fence after the opening one.
  // The opening fence is the first 3 chars ("---"), so look for the next
  // occurrence of \n--- (or --- at start of a subsequent line).
  const afterOpenFence = stripped.slice(3);
  const closeMatch = afterOpenFence.match(/\n---[ \t]*(?:\n|$)/);

  if (!closeMatch || closeMatch.index === undefined) {
    // No closing fence: return empty frontmatter and full body (minus the opening --- line).
    const bodyStart = afterOpenFence.indexOf("\n");
    const body = bodyStart >= 0 ? afterOpenFence.slice(bodyStart + 1) : "";
    return { frontmatter: {}, body };
  }

  const yamlText = afterOpenFence.slice(0, closeMatch.index);
  const body = afterOpenFence.slice(closeMatch.index + closeMatch[0].length);

  let parsed: unknown;
  try {
    parsed = parseYaml(yamlText);
  } catch {
    // Malformed YAML: return empty frontmatter, body after the fence.
    return { frontmatter: {}, body };
  }

  if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
    return { frontmatter: parsed as Record<string, unknown>, body };
  }

  // YAML parsed to something other than an object (e.g. null, array, scalar).
  return { frontmatter: {}, body };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function stemFromSource(source: string): string {
  const base = source.split("/").pop() ?? source;
  // Strip known compound extensions in order (longest first).
  for (const ext of [".agent.md", ".chatmode.md", ".prompt.md", ".mdc", ".yaml", ".md"]) {
    if (base.endsWith(ext)) {
      return base.slice(0, base.length - ext.length);
    }
  }
  const dot = base.lastIndexOf(".");
  return dot >= 0 ? base.slice(0, dot) : base;
}

function safeString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function safeArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}

/**
 * Map a Claude-family model identifier to an engine hint string.
 * Returns the model string itself when it starts with "claude"; returns undefined
 * for empty/missing values so callers can fall back.
 */
function claudeModelHint(model: string): string | undefined {
  if (model.startsWith("claude")) return model;
  return undefined;
}

// ---------------------------------------------------------------------------
// Per-source parsers
// Each returns a partial DiscoveredItem (all required fields filled).
// ---------------------------------------------------------------------------

/** Parser for .claude/agents/*.md */
function parseClaude(text: string, source: string): DiscoveredItem {
  const { frontmatter, body } = splitFrontmatter(text);
  const stem = stemFromSource(source);
  const name = safeString(frontmatter["name"]) || stem;
  const description = safeString(frontmatter["description"]);
  const declaredTools = safeArray(frontmatter["tools"]);
  const model = safeString(frontmatter["model"]);
  const engineHint = claudeModelHint(model) ?? "claude-sonnet-4-5";

  return {
    kind: "claude-agent",
    confidence: classify("claude-agent"),
    name,
    description,
    body,
    declaredTools,
    engineHint,
    source,
    isSkill: false,
  };
}

/** Parser for .hallucinate/roles/*.yaml (already-valid native role files) */
function parseHallucinateRole(text: string, source: string): DiscoveredItem {
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch {
    raw = {};
  }

  const rec: Record<string, unknown> = typeof raw === "object" && raw !== null && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};

  const stem = stemFromSource(source);
  const name = safeString(rec["name"]) || stem;
  const description = safeString(rec["instructions"]);
  const engineId = typeof rec["engine"] === "object" && rec["engine"] !== null
    ? safeString((rec["engine"] as Record<string, unknown>)["id"])
    : "";
  // native roles already use known engine ids; forward them as hints.
  const engineHint = engineId || "acp";

  return {
    kind: "hallucinate-role",
    confidence: classify("hallucinate-role"),
    name,
    description,
    body: description,
    declaredTools: [],
    engineHint,
    source,
    isSkill: false,
  };
}

/** Parser for .github/agents/*.agent.md */
function parseCopilotAgent(text: string, source: string): DiscoveredItem {
  const { frontmatter, body } = splitFrontmatter(text);
  const stem = stemFromSource(source);
  const name = safeString(frontmatter["name"]) || stem;
  const description = safeString(frontmatter["description"]);
  const declaredTools = safeArray(frontmatter["tools"]);
  const model = safeString(frontmatter["model"]);
  // A missing model on a .github/agents/*.agent.md means Copilot default.
  const engineHint = model ? (claudeModelHint(model) ?? model) : "copilot";

  return {
    kind: "copilot-agent",
    confidence: classify("copilot-agent"),
    name,
    description,
    body,
    declaredTools,
    engineHint,
    source,
    isSkill: false,
  };
}

/** Parser for .github/chatmodes/*.chatmode.md */
function parseCopilotChatmode(text: string, source: string): DiscoveredItem {
  const { frontmatter, body } = splitFrontmatter(text);
  const stem = stemFromSource(source);
  const name = safeString(frontmatter["name"]) || stem;
  const description = safeString(frontmatter["description"]);
  const declaredTools = safeArray(frontmatter["tools"]);
  const model = safeString(frontmatter["model"]);
  const engineHint = model ? (claudeModelHint(model) ?? model) : "copilot";

  return {
    kind: "copilot-chatmode",
    confidence: classify("copilot-chatmode"),
    name,
    description,
    body,
    declaredTools,
    engineHint,
    source,
    isSkill: false,
  };
}

/** Parser for *.prompt.md files */
function parsePrompt(text: string, source: string): DiscoveredItem {
  const { frontmatter, body } = splitFrontmatter(text);
  const stem = stemFromSource(source);
  const name = safeString(frontmatter["name"]) || stem;
  const description = safeString(frontmatter["description"]);
  const declaredTools = safeArray(frontmatter["tools"]);
  // prompt files that declare tools or set mode: agent lean toward acp.
  const engineHint = "acp";

  return {
    kind: "prompt",
    confidence: classify("prompt"),
    name,
    description,
    body,
    declaredTools,
    engineHint,
    source,
    isSkill: false,
  };
}

/** Parser for .claude/skills/<name>/SKILL.md */
function parseClaudeSkill(text: string, source: string): DiscoveredItem {
  const { frontmatter, body } = splitFrontmatter(text);
  const stem = stemFromSource(source);
  const name = safeString(frontmatter["name"]) || stem;
  const description = safeString(frontmatter["description"]);
  const declaredTools = safeArray(frontmatter["allowed-tools"]).concat(safeArray(frontmatter["tools"]));
  const engineHint = "claude-sonnet-4-5";

  return {
    kind: "claude-skill",
    confidence: classify("claude-skill"),
    name,
    description,
    body,
    declaredTools,
    engineHint,
    source,
    isSkill: true,
  };
}

/** Parser for .continue/agents/*.yaml */
function parseContinueAgent(text: string, source: string): DiscoveredItem {
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch {
    raw = {};
  }

  const rec: Record<string, unknown> = typeof raw === "object" && raw !== null && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};

  const stem = stemFromSource(source);
  const name = safeString(rec["name"]) || stem;
  const description = safeString(rec["description"]);
  const declaredTools = safeArray(rec["tools"]);
  // .continue agents lean toward acp (generic protocol).
  const engineHint = "acp";

  return {
    kind: "continue-agent",
    confidence: classify("continue-agent"),
    name,
    description,
    body: description,
    declaredTools,
    engineHint,
    source,
    isSkill: false,
  };
}

/** Parser for .cursor/rules/*.mdc */
function parseCursorRule(text: string, source: string): DiscoveredItem {
  const { frontmatter, body } = splitFrontmatter(text);
  const stem = stemFromSource(source);
  const name = safeString(frontmatter["name"]) || stem;
  const description = safeString(frontmatter["description"]);
  // Cursor rules lean toward acp.
  const engineHint = "acp";

  return {
    kind: "cursor-rule",
    confidence: classify("cursor-rule"),
    name,
    description,
    body,
    declaredTools: [],
    engineHint,
    source,
    isSkill: false,
  };
}

/** Parser for CLAUDE.md / instructions files */
function parseInstructions(text: string, source: string): DiscoveredItem {
  const { frontmatter, body } = splitFrontmatter(text);
  const stem = stemFromSource(source);
  const name = safeString(frontmatter["name"]) || stem;
  const description = safeString(frontmatter["description"]);

  return {
    kind: "instructions",
    confidence: classify("instructions"),
    name,
    description,
    body: body || text,
    declaredTools: [],
    source,
    isSkill: false,
  };
}

// ---------------------------------------------------------------------------
// Public dispatch map
// ---------------------------------------------------------------------------

const PARSERS: Record<SourceKind, (text: string, source: string) => DiscoveredItem> = {
  "claude-agent": parseClaude,
  "hallucinate-role": parseHallucinateRole,
  "copilot-agent": parseCopilotAgent,
  "copilot-chatmode": parseCopilotChatmode,
  "prompt": parsePrompt,
  "claude-skill": parseClaudeSkill,
  "continue-agent": parseContinueAgent,
  "cursor-rule": parseCursorRule,
  "instructions": parseInstructions,
  // plugin-agent and plugin-skill: not yet wired to file patterns; parsers provided for completeness.
  "plugin-agent": (text, source) => ({
    kind: "plugin-agent",
    confidence: classify("plugin-agent"),
    name: stemFromSource(source),
    description: "",
    body: text,
    declaredTools: [],
    engineHint: "copilot",
    source,
    isSkill: false,
  }),
  "plugin-skill": (text, source) => ({
    kind: "plugin-skill",
    confidence: classify("plugin-skill"),
    name: stemFromSource(source),
    description: "",
    body: text,
    declaredTools: [],
    source,
    isSkill: true,
  }),
};

/**
 * Parse a discovered file into a DiscoveredItem using the appropriate parser
 * for the given SourceKind.
 */
export function parseDiscoveredFile(kind: SourceKind, text: string, source: string): DiscoveredItem {
  return PARSERS[kind](text, source);
}
