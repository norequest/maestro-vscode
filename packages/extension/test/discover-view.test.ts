import { describe, expect, it } from "vitest";
import { selectDiscover } from "../src/discover-view.js";
import type { DiscoverGroup } from "../src/discover-view.js";
import type { DiscoveredItem } from "@maestro/config";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeItem(overrides: Partial<DiscoveredItem> = {}): DiscoveredItem {
  return {
    kind: "claude-agent",
    confidence: "verified",
    name: "Test Agent",
    description: "A test agent",
    body: "",
    declaredTools: [],
    source: ".claude/agents/test-agent.md",
    isSkill: false,
    ...overrides,
  };
}

// ─── Adopted marking ──────────────────────────────────────────────────────────

describe("selectDiscover — adopted", () => {
  it("marks a card adopted when its source is in adoptedSources", () => {
    const items = [
      makeItem({ source: ".claude/agents/a.md", name: "A" }),
      makeItem({ source: ".claude/agents/b.md", name: "B" }),
    ];
    const vm = selectDiscover(items, "", "all", false, undefined, [".claude/agents/a.md"]);
    const inRepo = vm.groups.find((g) => g.group === "in-repo")!;
    const a = inRepo.cards.find((c) => c.name === "A")!;
    const b = inRepo.cards.find((c) => c.name === "B")!;
    expect(a.adopted).toBe(true);
    expect(b.adopted).toBe(false);
  });

  it("defaults to not-adopted when no adoptedSources are passed", () => {
    const vm = selectDiscover([makeItem()], "", "all", false);
    const card = vm.groups.find((g) => g.group === "in-repo")!.cards[0]!;
    expect(card.adopted).toBe(false);
  });
});

// ─── Grouping ─────────────────────────────────────────────────────────────────

describe("selectDiscover — grouping", () => {
  it("places verified non-plugin items in in-repo", () => {
    const items = [makeItem({ kind: "claude-agent", confidence: "verified" })];
    const vm = selectDiscover(items, "", "all", false);
    const inRepo = vm.groups.find((g) => g.group === "in-repo")!;
    expect(inRepo.count).toBe(1);
    expect(inRepo.cards[0]!.name).toBe("Test Agent");
  });

  it("places likely non-plugin items in in-repo", () => {
    const items = [makeItem({ kind: "prompt", confidence: "likely" })];
    const vm = selectDiscover(items, "", "all", false);
    const inRepo = vm.groups.find((g) => g.group === "in-repo")!;
    expect(inRepo.count).toBe(1);
  });

  it("places plugin-agent items in plugins group", () => {
    const items = [
      makeItem({ kind: "plugin-agent", confidence: "verified", pluginName: "my-plugin" }),
    ];
    const vm = selectDiscover(items, "", "all", false);
    const plugins = vm.groups.find((g) => g.group === "plugins")!;
    expect(plugins.count).toBe(1);
    expect(plugins.cards[0]!.sourceBadge).toBe("Plugin · my-plugin");
  });

  it("places plugin-skill items in plugins group", () => {
    const items = [makeItem({ kind: "plugin-skill", confidence: "likely", isSkill: true })];
    const vm = selectDiscover(items, "", "all", false);
    const plugins = vm.groups.find((g) => g.group === "plugins")!;
    expect(plugins.count).toBe(1);
  });

  it("places instructions-confidence items in instructions group", () => {
    const items = [makeItem({ kind: "instructions", confidence: "instructions" })];
    const vm = selectDiscover(items, "", "all", false);
    const instructions = vm.groups.find((g) => g.group === "instructions")!;
    expect(instructions.count).toBe(1);
  });

  it("routes items across all three real buckets correctly", () => {
    const items = [
      makeItem({ kind: "claude-agent", confidence: "verified" }),
      makeItem({ kind: "plugin-agent", confidence: "verified", pluginStem: "plug" }),
      makeItem({ kind: "instructions", confidence: "instructions" }),
    ];
    const vm = selectDiscover(items, "", "all", false);
    expect(vm.groups.find((g) => g.group === "in-repo")!.count).toBe(1);
    expect(vm.groups.find((g) => g.group === "plugins")!.count).toBe(1);
    expect(vm.groups.find((g) => g.group === "instructions")!.count).toBe(1);
  });
});

// ─── Counts ───────────────────────────────────────────────────────────────────

describe("selectDiscover — counts", () => {
  it("count reflects visible card count (no filter)", () => {
    const items = [
      makeItem({ name: "Alpha", source: ".claude/agents/alpha.md" }),
      makeItem({ name: "Beta", source: ".claude/agents/beta.md" }),
    ];
    const vm = selectDiscover(items, "", "all", false);
    const inRepo = vm.groups.find((g) => g.group === "in-repo")!;
    expect(inRepo.count).toBe(2);
  });

  it("count reflects cards after filter is applied", () => {
    const items = [
      makeItem({ name: "Alpha", source: ".claude/agents/alpha.md" }),
      makeItem({ name: "Beta", source: ".claude/agents/beta.md" }),
    ];
    const vm = selectDiscover(items, "alpha", "all", false);
    const inRepo = vm.groups.find((g) => g.group === "in-repo")!;
    expect(inRepo.count).toBe(1);
    expect(inRepo.cards[0]!.name).toBe("Alpha");
  });
});

// ─── Filter ───────────────────────────────────────────────────────────────────

describe("selectDiscover — filter", () => {
  it("narrows cards by name (case-insensitive)", () => {
    const items = [
      makeItem({ name: "AlPhA Agent", source: "a.md" }),
      makeItem({ name: "Beta Agent", source: "b.md" }),
    ];
    const vm = selectDiscover(items, "alpha", "all", false);
    const inRepo = vm.groups.find((g) => g.group === "in-repo")!;
    expect(inRepo.count).toBe(1);
    expect(inRepo.cards[0]!.name).toBe("AlPhA Agent");
  });

  it("narrows cards by description", () => {
    const items = [
      makeItem({ name: "A", description: "runs typescript linting", source: "a.md" }),
      makeItem({ name: "B", description: "Python formatter", source: "b.md" }),
    ];
    const vm = selectDiscover(items, "typescript", "all", false);
    const inRepo = vm.groups.find((g) => g.group === "in-repo")!;
    expect(inRepo.count).toBe(1);
  });

  it("narrows cards by skill chips", () => {
    const items = [
      makeItem({ name: "A", declaredTools: ["eslint", "prettier"], source: "a.md" }),
      makeItem({ name: "B", declaredTools: ["mypy"], source: "b.md" }),
    ];
    const vm = selectDiscover(items, "eslint", "all", false);
    const inRepo = vm.groups.find((g) => g.group === "in-repo")!;
    expect(inRepo.count).toBe(1);
    expect(inRepo.cards[0]!.name).toBe("A");
  });

  it("is case-insensitive on description", () => {
    const items = [makeItem({ name: "X", description: "UPPERCASE DESC", source: "x.md" })];
    const vm = selectDiscover(items, "uppercase", "all", false);
    const inRepo = vm.groups.find((g) => g.group === "in-repo")!;
    expect(inRepo.count).toBe(1);
  });

  it("empty filter matches all cards", () => {
    const items = [
      makeItem({ name: "A", source: "a.md" }),
      makeItem({ name: "B", source: "b.md" }),
      makeItem({ name: "C", source: "c.md" }),
    ];
    const vm = selectDiscover(items, "", "all", false);
    const inRepo = vm.groups.find((g) => g.group === "in-repo")!;
    expect(inRepo.count).toBe(3);
  });
});

// ─── canDispatch and canAdopt ─────────────────────────────────────────────────

describe("selectDiscover — canDispatch and canAdopt", () => {
  it("canDispatch is false for a likely (medium confidence) item", () => {
    const items = [makeItem({ confidence: "likely" })];
    const vm = selectDiscover(items, "", "all", false);
    const card = vm.groups.find((g) => g.group === "in-repo")!.cards[0]!;
    expect(card.canDispatch).toBe(false);
  });

  it("canDispatch is true for a verified item", () => {
    const items = [makeItem({ confidence: "verified" })];
    const vm = selectDiscover(items, "", "all", false);
    const card = vm.groups.find((g) => g.group === "in-repo")!.cards[0]!;
    expect(card.canDispatch).toBe(true);
  });

  it("canAdopt is false for an instructions-confidence item", () => {
    const items = [makeItem({ kind: "instructions", confidence: "instructions" })];
    const vm = selectDiscover(items, "", "all", false);
    const card = vm.groups.find((g) => g.group === "instructions")!.cards[0]!;
    expect(card.canAdopt).toBe(false);
  });

  it("canAdopt is true for a verified item", () => {
    const items = [makeItem({ confidence: "verified" })];
    const vm = selectDiscover(items, "", "all", false);
    const card = vm.groups.find((g) => g.group === "in-repo")!.cards[0]!;
    expect(card.canAdopt).toBe(true);
  });

  it("canAdopt is true for a likely item", () => {
    const items = [makeItem({ confidence: "likely" })];
    const vm = selectDiscover(items, "", "all", false);
    const card = vm.groups.find((g) => g.group === "in-repo")!.cards[0]!;
    expect(card.canAdopt).toBe(true);
  });
});

// ─── skillChips and overflowSkills ───────────────────────────────────────────

describe("selectDiscover — skillChips and overflowSkills", () => {
  it("caps skillChips at 4", () => {
    const tools = ["a", "b", "c", "d", "e", "f"];
    const items = [makeItem({ declaredTools: tools })];
    const vm = selectDiscover(items, "", "all", false);
    const card = vm.groups.find((g) => g.group === "in-repo")!.cards[0]!;
    expect(card.skillChips).toHaveLength(4);
    expect(card.skillChips).toEqual(["a", "b", "c", "d"]);
  });

  it("overflowSkills is correct when > 4 tools (6 tools → 2 overflow)", () => {
    const tools = ["a", "b", "c", "d", "e", "f"];
    const items = [makeItem({ declaredTools: tools })];
    const vm = selectDiscover(items, "", "all", false);
    const card = vm.groups.find((g) => g.group === "in-repo")!.cards[0]!;
    expect(card.overflowSkills).toBe(2);
  });

  it("overflowSkills is 0 when <= 4 tools", () => {
    const tools = ["a", "b", "c"];
    const items = [makeItem({ declaredTools: tools })];
    const vm = selectDiscover(items, "", "all", false);
    const card = vm.groups.find((g) => g.group === "in-repo")!.cards[0]!;
    expect(card.overflowSkills).toBe(0);
  });

  it("overflowSkills is 0 when exactly 4 tools", () => {
    const tools = ["a", "b", "c", "d"];
    const items = [makeItem({ declaredTools: tools })];
    const vm = selectDiscover(items, "", "all", false);
    const card = vm.groups.find((g) => g.group === "in-repo")!.cards[0]!;
    expect(card.overflowSkills).toBe(0);
  });

  it("overflowSkills is 0 when no tools declared", () => {
    const items = [makeItem({ declaredTools: [] })];
    const vm = selectDiscover(items, "", "all", false);
    const card = vm.groups.find((g) => g.group === "in-repo")!.cards[0]!;
    expect(card.overflowSkills).toBe(0);
    expect(card.skillChips).toHaveLength(0);
  });
});

// ─── Marketplace always present ───────────────────────────────────────────────

describe("selectDiscover — marketplace group", () => {
  it("marketplace group always has exactly 1 placeholder card", () => {
    const vm = selectDiscover([], "", "all", false);
    const marketplace = vm.groups.find((g) => g.group === "marketplace")!;
    expect(marketplace.count).toBe(1);
    expect(marketplace.cards).toHaveLength(1);
    expect(marketplace.cards[0]!.id).toBe("__marketplace__");
  });

  it("marketplace placeholder card is present even when filter matches nothing", () => {
    const items = [makeItem({ name: "TestAgent", source: "a.md" })];
    const vm = selectDiscover(items, "xxxxxxxxxxx", "all", false);
    const marketplace = vm.groups.find((g) => g.group === "marketplace")!;
    expect(marketplace.count).toBe(1);
    expect(marketplace.cards[0]!.id).toBe("__marketplace__");
  });

  it("marketplace placeholder has correct static fields", () => {
    const vm = selectDiscover([], "", "all", false);
    const card = vm.groups.find((g) => g.group === "marketplace")!.cards[0]!;
    // Name and badge avoid the doubled word ("Browse Marketplace" + "Marketplace"
    // badge previously read as "Browse Marketplace Marketplace" on the card).
    expect(card.name).toBe("Marketplace");
    expect(card.description).toContain("Marketplace");
    expect(card.sourceBadge).toBe("Soon");
    expect(card.engineId).toBe("copilot");
    expect(card.canDispatch).toBe(false);
    expect(card.canAdopt).toBe(false);
  });
});

// ─── activeChip filter ────────────────────────────────────────────────────────

describe("selectDiscover — activeChip filter", () => {
  it("activeChip='in-repo' keeps only in-repo cards and marketplace", () => {
    const items = [
      makeItem({ name: "Repo Agent", kind: "claude-agent", confidence: "verified", source: "a.md" }),
      makeItem({ name: "Plugin Agent", kind: "plugin-agent", confidence: "verified", source: "b.md", pluginName: "plug" }),
    ];
    const vm = selectDiscover(items, "", "in-repo", false);
    const inRepo = vm.groups.find((g) => g.group === "in-repo")!;
    const plugins = vm.groups.find((g) => g.group === "plugins")!;
    const marketplace = vm.groups.find((g) => g.group === "marketplace")!;
    expect(inRepo.count).toBe(1);
    expect(plugins.count).toBe(0);
    expect(marketplace.count).toBe(1); // marketplace always present
  });

  it("activeChip='plugins' keeps only plugin cards and marketplace", () => {
    const items = [
      makeItem({ name: "Repo Agent", kind: "claude-agent", confidence: "verified", source: "a.md" }),
      makeItem({ name: "Plugin Agent", kind: "plugin-agent", confidence: "verified", source: "b.md" }),
    ];
    const vm = selectDiscover(items, "", "plugins", false);
    const inRepo = vm.groups.find((g) => g.group === "in-repo")!;
    const plugins = vm.groups.find((g) => g.group === "plugins")!;
    expect(inRepo.count).toBe(0);
    expect(plugins.count).toBe(1);
  });

  it("activeChip='instructions' keeps only instructions cards and marketplace", () => {
    const items = [
      makeItem({ name: "InstrAgent", kind: "instructions", confidence: "instructions", source: "a.md" }),
      makeItem({ name: "Repo Agent", kind: "claude-agent", confidence: "verified", source: "b.md" }),
    ];
    const vm = selectDiscover(items, "", "instructions", false);
    const instructions = vm.groups.find((g) => g.group === "instructions")!;
    const inRepo = vm.groups.find((g) => g.group === "in-repo")!;
    expect(instructions.count).toBe(1);
    expect(inRepo.count).toBe(0);
  });

  it("activeChip='all' shows all groups", () => {
    const items = [
      makeItem({ name: "A", kind: "claude-agent", confidence: "verified", source: "a.md" }),
      makeItem({ name: "B", kind: "plugin-agent", confidence: "verified", source: "b.md" }),
      makeItem({ name: "C", kind: "instructions", confidence: "instructions", source: "c.md" }),
    ];
    const vm = selectDiscover(items, "", "all", false);
    expect(vm.groups.find((g) => g.group === "in-repo")!.count).toBe(1);
    expect(vm.groups.find((g) => g.group === "plugins")!.count).toBe(1);
    expect(vm.groups.find((g) => g.group === "instructions")!.count).toBe(1);
    expect(vm.groups.find((g) => g.group === "marketplace")!.count).toBe(1);
  });

  it("activeChip='marketplace' keeps marketplace (all real groups drop to 0)", () => {
    const items = [makeItem({ source: "a.md" })];
    const vm = selectDiscover(items, "", "marketplace", false);
    const inRepo = vm.groups.find((g) => g.group === "in-repo")!;
    const marketplace = vm.groups.find((g) => g.group === "marketplace")!;
    expect(inRepo.count).toBe(0);
    expect(marketplace.count).toBe(1);
  });
});

// ─── Empty items list ─────────────────────────────────────────────────────────

describe("selectDiscover — empty items", () => {
  it("produces all 4 group slots even when items is empty", () => {
    const vm = selectDiscover([], "", "all", false);
    const groupNames = vm.groups.map((g) => g.group);
    expect(groupNames).toContain("in-repo");
    expect(groupNames).toContain("plugins");
    expect(groupNames).toContain("instructions");
    expect(groupNames).toContain("marketplace");
  });

  it("real groups have 0 cards when items is empty", () => {
    const vm = selectDiscover([], "", "all", false);
    expect(vm.groups.find((g) => g.group === "in-repo")!.count).toBe(0);
    expect(vm.groups.find((g) => g.group === "plugins")!.count).toBe(0);
    expect(vm.groups.find((g) => g.group === "instructions")!.count).toBe(0);
  });

  it("marketplace still has 1 placeholder card when items is empty", () => {
    const vm = selectDiscover([], "", "all", false);
    expect(vm.groups.find((g) => g.group === "marketplace")!.count).toBe(1);
  });
});

// ─── engineId derivation ──────────────────────────────────────────────────────

describe("selectDiscover — engineId derivation", () => {
  it("copilot-agent kind → engineId copilot", () => {
    const items = [makeItem({ kind: "copilot-agent" })];
    const vm = selectDiscover(items, "", "all", false);
    const card = vm.groups.find((g) => g.group === "in-repo")!.cards[0]!;
    expect(card.engineId).toBe("copilot");
  });

  it("copilot-chatmode kind → engineId copilot", () => {
    const items = [makeItem({ kind: "copilot-chatmode" })];
    const vm = selectDiscover(items, "", "all", false);
    const card = vm.groups.find((g) => g.group === "in-repo")!.cards[0]!;
    expect(card.engineId).toBe("copilot");
  });

  it("plugin-agent kind → engineId copilot", () => {
    const items = [makeItem({ kind: "plugin-agent", source: "b.md" })];
    const vm = selectDiscover(items, "", "all", false);
    const card = vm.groups.find((g) => g.group === "plugins")!.cards[0]!;
    expect(card.engineId).toBe("copilot");
  });

  it("claude-agent kind → engineId acp", () => {
    const items = [makeItem({ kind: "claude-agent" })];
    const vm = selectDiscover(items, "", "all", false);
    const card = vm.groups.find((g) => g.group === "in-repo")!.cards[0]!;
    expect(card.engineId).toBe("acp");
  });

  it("engineHint starting with 'copilot' → engineId copilot", () => {
    const items = [makeItem({ kind: "claude-agent", engineHint: "copilot-gpt4" })];
    const vm = selectDiscover(items, "", "all", false);
    const card = vm.groups.find((g) => g.group === "in-repo")!.cards[0]!;
    expect(card.engineId).toBe("copilot");
  });

  it("no engineHint on conductor-role kind → engineId acp", () => {
    const items = [makeItem({ kind: "conductor-role" })];
    const vm = selectDiscover(items, "", "all", false);
    const card = vm.groups.find((g) => g.group === "in-repo")!.cards[0]!;
    expect(card.engineId).toBe("acp");
  });
});

// ─── sourceBadge for plugin items ─────────────────────────────────────────────

describe("selectDiscover — sourceBadge", () => {
  it("plugin-agent with pluginName uses pluginName in badge", () => {
    const items = [
      makeItem({ kind: "plugin-agent", pluginName: "My Copilot Plugin", source: "p.md" }),
    ];
    const vm = selectDiscover(items, "", "all", false);
    const card = vm.groups.find((g) => g.group === "plugins")!.cards[0]!;
    expect(card.sourceBadge).toBe("Plugin · My Copilot Plugin");
  });

  it("plugin-agent with pluginStem (no pluginName) uses pluginStem in badge", () => {
    const items = [makeItem({ kind: "plugin-agent", pluginStem: "my-plugin", source: "p.md" })];
    const vm = selectDiscover(items, "", "all", false);
    const card = vm.groups.find((g) => g.group === "plugins")!.cards[0]!;
    expect(card.sourceBadge).toBe("Plugin · my-plugin");
  });

  it("plugin-agent with neither pluginName nor pluginStem falls back to 'Plugin'", () => {
    const items = [makeItem({ kind: "plugin-agent", source: "p.md" })];
    const vm = selectDiscover(items, "", "all", false);
    const card = vm.groups.find((g) => g.group === "plugins")!.cards[0]!;
    expect(card.sourceBadge).toBe("Plugin · Plugin");
  });

  it("repo item sourceBadge is the source path", () => {
    const items = [makeItem({ kind: "claude-agent", source: ".claude/agents/my-agent.md" })];
    const vm = selectDiscover(items, "", "all", false);
    const card = vm.groups.find((g) => g.group === "in-repo")!.cards[0]!;
    expect(card.sourceBadge).toBe(".claude/agents/my-agent.md");
  });
});

// ─── scanning and scanError passthrough ──────────────────────────────────────

describe("selectDiscover — scanning and scanError", () => {
  it("passes scanning=true through to the VM", () => {
    const vm = selectDiscover([], "", "all", true);
    expect(vm.scanning).toBe(true);
  });

  it("passes scanning=false through to the VM", () => {
    const vm = selectDiscover([], "", "all", false);
    expect(vm.scanning).toBe(false);
  });

  it("passes scanError through to the VM", () => {
    const vm = selectDiscover([], "", "all", false, "disk error");
    expect(vm.scanError).toBe("disk error");
  });

  it("scanError is undefined when not provided", () => {
    const vm = selectDiscover([], "", "all", false);
    expect(vm.scanError).toBeUndefined();
  });
});

// ─── Card id ─────────────────────────────────────────────────────────────────

describe("selectDiscover — card id", () => {
  it("card id is the item source path", () => {
    const source = ".claude/agents/my-fancy-agent.md";
    const items = [makeItem({ source })];
    const vm = selectDiscover(items, "", "all", false);
    const card = vm.groups.find((g) => g.group === "in-repo")!.cards[0]!;
    expect(card.id).toBe(source);
  });
});
