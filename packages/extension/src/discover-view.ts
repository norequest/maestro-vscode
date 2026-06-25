/**
 * Pure presenter for the Discover tab.
 * No vscode imports, no node imports: pure data transformation.
 *
 * Consumes DiscoveredItem[] from @maestro/config and emits a DiscoverVM
 * ready for the webview renderer.
 */

import type { DiscoveredItem, Confidence } from "@maestro/config";

// ─── View-model types ─────────────────────────────────────────────────────────

export interface DiscoverCardVM {
  id: string;
  name: string;
  description: string;
  sourceBadge: string;
  engineId: "copilot" | "acp";
  confidence: Confidence;
  skillChips: string[];
  overflowSkills: number;
  canDispatch: boolean;
  canAdopt: boolean;
  isSkill: boolean;
  /** True once the user has adopted this item this session; renders the adopted (done) state. */
  adopted?: boolean;
}

export type DiscoverGroup = "in-repo" | "plugins" | "instructions" | "marketplace";

export interface DiscoverVM {
  groups: Array<{
    group: DiscoverGroup;
    label: string;
    count: number;
    cards: DiscoverCardVM[];
  }>;
  scanning: boolean;
  scanError?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const GROUP_LABELS: Record<DiscoverGroup, string> = {
  "in-repo": "In this repo",
  plugins: "Plugins",
  instructions: "Instructions",
  marketplace: "Marketplace",
};

const SKILL_CHIPS_MAX = 4;

/** The fixed marketplace placeholder, always present, never from real items. */
const MARKETPLACE_PLACEHOLDER: DiscoverCardVM = {
  id: "__marketplace__",
  name: "Marketplace",
  description: "Find more agents and skills in the GitHub Copilot Marketplace.",
  sourceBadge: "Soon",
  engineId: "copilot",
  confidence: "verified",
  skillChips: [],
  overflowSkills: 0,
  canDispatch: false,
  canAdopt: false,
  isSkill: false,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Derive the engineId for an item.
 * - copilot if kind is plugin-agent, copilot-agent, or copilot-chatmode
 * - copilot if engineHint starts with "copilot"
 * - acp otherwise
 */
function deriveEngineId(item: DiscoveredItem): "copilot" | "acp" {
  if (
    item.kind === "copilot-agent" ||
    item.kind === "copilot-chatmode" ||
    item.kind === "plugin-agent"
  ) {
    return "copilot";
  }
  if (item.engineHint && item.engineHint.startsWith("copilot")) {
    return "copilot";
  }
  return "acp";
}

/**
 * Derive the sourceBadge for an item.
 * - Plugin items: "Plugin · <pluginName>" (pluginName > pluginStem > "Plugin")
 * - Repo items: the source path
 */
function deriveSourceBadge(item: DiscoveredItem): string {
  const isPlugin = item.kind === "plugin-agent" || item.kind === "plugin-skill";
  if (isPlugin) {
    const label = item.pluginName ?? item.pluginStem ?? "Plugin";
    return `Plugin · ${label}`;
  }
  return item.source;
}

/**
 * Map a DiscoveredItem to a DiscoverCardVM.
 */
function toCard(item: DiscoveredItem, adoptedSet: Set<string>): DiscoverCardVM {
  const chips = item.declaredTools.slice(0, SKILL_CHIPS_MAX);
  const overflow = Math.max(0, item.declaredTools.length - SKILL_CHIPS_MAX);

  // Collapse multi-line raw bodies into a clean single-line summary so the
  // 2-line CSS clamp in the card reads cleanly (presentation normalization).
  const description = item.description.replace(/\s+/g, " ").trim();

  return {
    id: item.source,
    name: item.name,
    description,
    sourceBadge: deriveSourceBadge(item),
    engineId: deriveEngineId(item),
    confidence: item.confidence,
    skillChips: chips,
    overflowSkills: overflow,
    canDispatch: item.confidence === "verified",
    canAdopt: item.confidence !== "instructions",
    isSkill: item.isSkill,
    adopted: adoptedSet.has(item.source),
  };
}

/**
 * Determine which group an item belongs to.
 */
function classifyGroup(item: DiscoveredItem): "in-repo" | "plugins" | "instructions" {
  if (item.kind === "plugin-agent" || item.kind === "plugin-skill") {
    return "plugins";
  }
  if (item.confidence === "instructions") {
    return "instructions";
  }
  return "in-repo";
}

/**
 * Case-insensitive filter: item matches if name, description, or any skill chip
 * contains the filter string.
 */
function matchesFilter(card: DiscoverCardVM, filter: string): boolean {
  if (!filter) return true;
  const q = filter.toLowerCase();
  return (
    card.name.toLowerCase().includes(q) ||
    card.description.toLowerCase().includes(q) ||
    card.skillChips.some((chip) => chip.toLowerCase().includes(q))
  );
}

// ─── Main selector ────────────────────────────────────────────────────────────

/**
 * Select + shape all data needed to render the Discover tab.
 *
 * Always outputs all 4 group slots. The marketplace group always has exactly
 * one placeholder card regardless of filter or activeChip.
 */
export function selectDiscover(
  items: DiscoveredItem[],
  filter: string,
  activeChip: DiscoverGroup | "all",
  scanning: boolean,
  scanError?: string,
  adoptedSources: string[] = []
): DiscoverVM {
  const adoptedSet = new Set(adoptedSources);

  // ── 1. Bucket items into groups
  const buckets: Record<"in-repo" | "plugins" | "instructions", DiscoverCardVM[]> = {
    "in-repo": [],
    plugins: [],
    instructions: [],
  };

  for (const item of items) {
    const group = classifyGroup(item);
    buckets[group].push(toCard(item, adoptedSet));
  }

  // ── 2. Apply text filter to each real bucket
  const filterFn = (card: DiscoverCardVM) => matchesFilter(card, filter);

  // ── 3. Apply group chip filter (activeChip), marketplace always included
  const groupOrder: Array<"in-repo" | "plugins" | "instructions"> = [
    "in-repo",
    "plugins",
    "instructions",
  ];

  const realGroups = groupOrder.map((group) => {
    const filtered = buckets[group].filter(filterFn);
    // When activeChip restricts to a specific group, drop cards from other real groups.
    // "marketplace" chip hides all real groups (marketplace always present via its own slot).
    const cards =
      activeChip === "all" || activeChip === group
        ? filtered
        : [];
    return {
      group: group as DiscoverGroup,
      label: GROUP_LABELS[group],
      count: cards.length,
      cards,
    };
  });

  // ── 4. Marketplace group, always exactly one placeholder
  const marketplaceGroup = {
    group: "marketplace" as DiscoverGroup,
    label: GROUP_LABELS["marketplace"],
    count: 1,
    cards: [MARKETPLACE_PLACEHOLDER],
  };

  return {
    groups: [...realGroups, marketplaceGroup],
    scanning,
    scanError,
  };
}
