import { describe, it, expect } from "vitest";
import { dedupeDiscoveredAgents } from "../../src/discover/dedupe.js";
import type { DiscoveredItem, SourceKind } from "../../src/discover/types.js";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeItem(overrides: Partial<DiscoveredItem>): DiscoveredItem {
  return {
    kind: "claude-agent",
    confidence: "verified",
    name: "Test Agent",
    description: "A test agent for unit testing.",
    body: "You are a test agent.",
    declaredTools: [],
    source: ".claude/agents/test-agent.md",
    isSkill: false,
    ...overrides,
  };
}

/** Convenience: build an agent item of a given kind and name with a derived source. */
function agent(kind: SourceKind, name: string, source?: string): DiscoveredItem {
  return makeItem({
    kind,
    name,
    source: source ?? `${kind}/${name}`,
    isSkill: false,
  });
}

// ---------------------------------------------------------------------------
// Collapse: conductor-role beats copilot-agent mirror
// ---------------------------------------------------------------------------

describe("dedupeDiscoveredAgents: conductor-role vs copilot mirror", () => {
  it("collapses a conductor-role and a copilot-agent of the same name to ONE conductor-role", () => {
    const input = [
      agent("conductor-role", "implementer", ".conductor/roles/implementer.yaml"),
      agent("copilot-agent", "Implementer", ".github/agents/implementer.agent.md"),
    ];
    const out = dedupeDiscoveredAgents(input);
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe("conductor-role");
    expect(out[0]!.name).toBe("implementer");
  });

  it("keeps the conductor-role even when the copilot mirror appears FIRST in input, at that first position", () => {
    const input = [
      agent("copilot-agent", "Implementer", ".github/agents/implementer.agent.md"),
      agent("conductor-role", "implementer", ".conductor/roles/implementer.yaml"),
    ];
    const out = dedupeDiscoveredAgents(input);
    expect(out).toHaveLength(1);
    // Survivor is the conductor-role (lowest priority number)...
    expect(out[0]!.kind).toBe("conductor-role");
    // ...and it sits at the EARLIEST duplicate's slot (index 0).
    expect(out[0]!.source).toBe(".conductor/roles/implementer.yaml");
  });

  it("collapses two 'tornike' items (conductor-role + copilot-agent) to the conductor-role", () => {
    const input = [
      agent("conductor-role", "tornike", ".conductor/roles/tornike.yaml"),
      agent("copilot-agent", "tornike", ".github/agents/tornike.agent.md"),
    ];
    const out = dedupeDiscoveredAgents(input);
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe("conductor-role");
  });
});

// ---------------------------------------------------------------------------
// Distinct agents are all kept
// ---------------------------------------------------------------------------

describe("dedupeDiscoveredAgents: distinct agents", () => {
  it("keeps agents with different names", () => {
    const input = [
      agent("conductor-role", "implementer"),
      agent("conductor-role", "reviewer"),
      agent("copilot-agent", "Planner"),
    ];
    const out = dedupeDiscoveredAgents(input);
    expect(out).toHaveLength(3);
    expect(out.map((i) => i.name)).toEqual(["implementer", "reviewer", "Planner"]);
  });
});

// ---------------------------------------------------------------------------
// Non-agent kinds pass through (not collapsed)
// ---------------------------------------------------------------------------

describe("dedupeDiscoveredAgents: non-agent kinds pass through", () => {
  it("does NOT collapse a claude-skill or an instructions item that share a name with an agent", () => {
    const input = [
      agent("conductor-role", "implementer", ".conductor/roles/implementer.yaml"),
      makeItem({
        kind: "claude-skill",
        name: "implementer",
        source: ".claude/skills/implementer/SKILL.md",
        isSkill: true,
      }),
      makeItem({
        kind: "instructions",
        name: "implementer",
        source: ".github/copilot-instructions.md",
        isSkill: false,
      }),
    ];
    const out = dedupeDiscoveredAgents(input);
    // All three survive: the agent, plus the skill and instructions untouched.
    expect(out).toHaveLength(3);
    expect(out.map((i) => i.kind)).toEqual(["conductor-role", "claude-skill", "instructions"]);
  });

  it("passes through prompt and plugin-agent items unchanged in position", () => {
    const input = [
      makeItem({ kind: "prompt", name: "implementer", source: "prompts/implementer.md" }),
      makeItem({ kind: "plugin-agent", name: "implementer", source: "plugins/x/implementer.md" }),
      agent("conductor-role", "implementer"),
    ];
    const out = dedupeDiscoveredAgents(input);
    expect(out).toHaveLength(3);
    expect(out.map((i) => i.kind)).toEqual(["prompt", "plugin-agent", "conductor-role"]);
  });

  it("does not collapse two plugin-agent items with the same name", () => {
    const input = [
      makeItem({ kind: "plugin-agent", name: "shared", source: "plugins/a/shared.md" }),
      makeItem({ kind: "plugin-agent", name: "shared", source: "plugins/b/shared.md" }),
    ];
    const out = dedupeDiscoveredAgents(input);
    expect(out).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Priority chain
// ---------------------------------------------------------------------------

describe("dedupeDiscoveredAgents: priority chain", () => {
  it("copilot-agent beats claude-agent for the same name when no conductor-role exists", () => {
    const input = [
      agent("claude-agent", "helper", ".claude/agents/helper.md"),
      agent("copilot-agent", "helper", ".github/agents/helper.agent.md"),
    ];
    const out = dedupeDiscoveredAgents(input);
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe("copilot-agent");
  });

  it("walks the full chain: conductor-role wins over copilot, claude, continue, chatmode, cursor", () => {
    const input = [
      agent("cursor-rule", "all"),
      agent("copilot-chatmode", "all"),
      agent("continue-agent", "all"),
      agent("claude-agent", "all"),
      agent("copilot-agent", "all"),
      agent("conductor-role", "all"),
    ];
    const out = dedupeDiscoveredAgents(input);
    expect(out).toHaveLength(1);
    // The conductor-role is the survivor (its own data, including its source).
    expect(out[0]!.kind).toBe("conductor-role");
    expect(out[0]!.source).toBe("conductor-role/all");
  });
});

// ---------------------------------------------------------------------------
// Normalization + empty names
// ---------------------------------------------------------------------------

describe("dedupeDiscoveredAgents: normalization", () => {
  it("treats 'Code Reviewer', 'code-reviewer', and 'code_reviewer' as the same key", () => {
    const input = [
      agent("conductor-role", "Code Reviewer", ".conductor/roles/code-reviewer.yaml"),
      agent("copilot-agent", "code-reviewer", ".github/agents/code-reviewer.agent.md"),
      agent("claude-agent", "code_reviewer", ".claude/agents/code_reviewer.md"),
    ];
    const out = dedupeDiscoveredAgents(input);
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe("conductor-role");
  });

  it("does NOT collapse empty/whitespace-named agent items together", () => {
    const input = [
      agent("conductor-role", "   ", ".conductor/roles/blank-a.yaml"),
      agent("copilot-agent", "", ".github/agents/blank-b.agent.md"),
      agent("claude-agent", "!!!", ".claude/agents/blank-c.md"),
    ];
    const out = dedupeDiscoveredAgents(input);
    // All three normalize to an empty key, so none collapse.
    expect(out).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// Order preservation
// ---------------------------------------------------------------------------

describe("dedupeDiscoveredAgents: order preservation", () => {
  it("given [copilot A, conductor A, agent B] yields [conductor A, B] in that order", () => {
    const input = [
      agent("copilot-agent", "A", "copilot/A"),
      agent("conductor-role", "A", "conductor/A"),
      agent("conductor-role", "B", "conductor/B"),
    ];
    const out = dedupeDiscoveredAgents(input);
    expect(out).toHaveLength(2);
    expect(out[0]!.kind).toBe("conductor-role");
    expect(out[0]!.name).toBe("A");
    expect(out[0]!.source).toBe("conductor/A");
    expect(out[1]!.name).toBe("B");
  });

  it("preserves interleaved non-agent items in their original positions", () => {
    const input = [
      agent("copilot-agent", "A", "copilot/A"),
      makeItem({ kind: "instructions", name: "notes", source: "notes.md" }),
      agent("conductor-role", "A", "conductor/A"),
      makeItem({ kind: "claude-skill", name: "skill", source: "skill", isSkill: true }),
    ];
    const out = dedupeDiscoveredAgents(input);
    // Agent A collapses (conductor wins, keeps slot 0). Non-agents stay put.
    expect(out.map((i) => i.kind)).toEqual(["conductor-role", "instructions", "claude-skill"]);
    expect(out[0]!.source).toBe("conductor/A");
  });
});

// ---------------------------------------------------------------------------
// Purity: input is not mutated
// ---------------------------------------------------------------------------

describe("dedupeDiscoveredAgents: purity", () => {
  it("does not mutate the input array or its items", () => {
    const input = [
      agent("copilot-agent", "Implementer", "copilot/impl"),
      agent("conductor-role", "implementer", "conductor/impl"),
    ];
    const snapshot = input.map((i) => ({ ...i }));
    const inputRefs = [...input];

    const out = dedupeDiscoveredAgents(input);

    // Input array length and references unchanged.
    expect(input).toHaveLength(2);
    expect(input).toEqual(inputRefs);
    // Each input item is structurally unchanged.
    input.forEach((item, idx) => {
      expect(item).toEqual(snapshot[idx]);
    });
    // Output reuses an input object reference (no defensive clone required).
    expect(out[0]).toBe(input[1]!);
  });

  it("returns a new array distinct from the input", () => {
    const input = [agent("conductor-role", "solo")];
    const out = dedupeDiscoveredAgents(input);
    expect(out).not.toBe(input);
    expect(out).toEqual(input);
  });
});
