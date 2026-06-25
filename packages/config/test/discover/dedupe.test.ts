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
// Collapse: hallucinate-role beats copilot-agent mirror
// ---------------------------------------------------------------------------

describe("dedupeDiscoveredAgents: hallucinate-role vs copilot mirror", () => {
  it("collapses a hallucinate-role and a copilot-agent of the same name to ONE hallucinate-role", () => {
    const input = [
      agent("hallucinate-role", "implementer", ".hallucinate/roles/implementer.yaml"),
      agent("copilot-agent", "Implementer", ".github/agents/implementer.agent.md"),
    ];
    const out = dedupeDiscoveredAgents(input);
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe("hallucinate-role");
    expect(out[0]!.name).toBe("implementer");
  });

  it("keeps the hallucinate-role even when the copilot mirror appears FIRST in input, at that first position", () => {
    const input = [
      agent("copilot-agent", "Implementer", ".github/agents/implementer.agent.md"),
      agent("hallucinate-role", "implementer", ".hallucinate/roles/implementer.yaml"),
    ];
    const out = dedupeDiscoveredAgents(input);
    expect(out).toHaveLength(1);
    // Survivor is the hallucinate-role (lowest priority number)...
    expect(out[0]!.kind).toBe("hallucinate-role");
    // ...and it sits at the EARLIEST duplicate's slot (index 0).
    expect(out[0]!.source).toBe(".hallucinate/roles/implementer.yaml");
  });

  it("collapses two 'writer' items (hallucinate-role + copilot-agent) to the hallucinate-role", () => {
    const input = [
      agent("hallucinate-role", "writer", ".hallucinate/roles/writer.yaml"),
      agent("copilot-agent", "writer", ".github/agents/writer.agent.md"),
    ];
    const out = dedupeDiscoveredAgents(input);
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe("hallucinate-role");
  });
});

// ---------------------------------------------------------------------------
// Distinct agents are all kept
// ---------------------------------------------------------------------------

describe("dedupeDiscoveredAgents: distinct agents", () => {
  it("keeps agents with different names", () => {
    const input = [
      agent("hallucinate-role", "implementer"),
      agent("hallucinate-role", "reviewer"),
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
      agent("hallucinate-role", "implementer", ".hallucinate/roles/implementer.yaml"),
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
    expect(out.map((i) => i.kind)).toEqual(["hallucinate-role", "claude-skill", "instructions"]);
  });

  it("passes through prompt and plugin-agent items unchanged in position", () => {
    const input = [
      makeItem({ kind: "prompt", name: "implementer", source: "prompts/implementer.md" }),
      makeItem({ kind: "plugin-agent", name: "implementer", source: "plugins/x/implementer.md" }),
      agent("hallucinate-role", "implementer"),
    ];
    const out = dedupeDiscoveredAgents(input);
    expect(out).toHaveLength(3);
    expect(out.map((i) => i.kind)).toEqual(["prompt", "plugin-agent", "hallucinate-role"]);
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
  it("copilot-agent beats claude-agent for the same name when no hallucinate-role exists", () => {
    const input = [
      agent("claude-agent", "helper", ".claude/agents/helper.md"),
      agent("copilot-agent", "helper", ".github/agents/helper.agent.md"),
    ];
    const out = dedupeDiscoveredAgents(input);
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe("copilot-agent");
  });

  it("walks the full chain: hallucinate-role wins over copilot, claude, continue, chatmode, cursor", () => {
    const input = [
      agent("cursor-rule", "all"),
      agent("copilot-chatmode", "all"),
      agent("continue-agent", "all"),
      agent("claude-agent", "all"),
      agent("copilot-agent", "all"),
      agent("hallucinate-role", "all"),
    ];
    const out = dedupeDiscoveredAgents(input);
    expect(out).toHaveLength(1);
    // The hallucinate-role is the survivor (its own data, including its source).
    expect(out[0]!.kind).toBe("hallucinate-role");
    expect(out[0]!.source).toBe("hallucinate-role/all");
  });
});

// ---------------------------------------------------------------------------
// Normalization + empty names
// ---------------------------------------------------------------------------

describe("dedupeDiscoveredAgents: normalization", () => {
  it("treats 'Code Reviewer', 'code-reviewer', and 'code_reviewer' as the same key", () => {
    const input = [
      agent("hallucinate-role", "Code Reviewer", ".hallucinate/roles/code-reviewer.yaml"),
      agent("copilot-agent", "code-reviewer", ".github/agents/code-reviewer.agent.md"),
      agent("claude-agent", "code_reviewer", ".claude/agents/code_reviewer.md"),
    ];
    const out = dedupeDiscoveredAgents(input);
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe("hallucinate-role");
  });

  it("does NOT collapse empty/whitespace-named agent items together", () => {
    const input = [
      agent("hallucinate-role", "   ", ".hallucinate/roles/blank-a.yaml"),
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
  it("given [copilot A, native A, agent B] yields [native A, B] in that order", () => {
    const input = [
      agent("copilot-agent", "A", "copilot/A"),
      agent("hallucinate-role", "A", "native/A"),
      agent("hallucinate-role", "B", "native/B"),
    ];
    const out = dedupeDiscoveredAgents(input);
    expect(out).toHaveLength(2);
    expect(out[0]!.kind).toBe("hallucinate-role");
    expect(out[0]!.name).toBe("A");
    expect(out[0]!.source).toBe("native/A");
    expect(out[1]!.name).toBe("B");
  });

  it("preserves interleaved non-agent items in their original positions", () => {
    const input = [
      agent("copilot-agent", "A", "copilot/A"),
      makeItem({ kind: "instructions", name: "notes", source: "notes.md" }),
      agent("hallucinate-role", "A", "native/A"),
      makeItem({ kind: "claude-skill", name: "skill", source: "skill", isSkill: true }),
    ];
    const out = dedupeDiscoveredAgents(input);
    // Agent A collapses (native role wins, keeps slot 0). Non-agents stay put.
    expect(out.map((i) => i.kind)).toEqual(["hallucinate-role", "instructions", "claude-skill"]);
    expect(out[0]!.source).toBe("native/A");
  });
});

// ---------------------------------------------------------------------------
// Purity: input is not mutated
// ---------------------------------------------------------------------------

describe("dedupeDiscoveredAgents: purity", () => {
  it("does not mutate the input array or its items", () => {
    const input = [
      agent("copilot-agent", "Implementer", "copilot/impl"),
      agent("hallucinate-role", "implementer", "native/impl"),
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
    const input = [agent("hallucinate-role", "solo")];
    const out = dedupeDiscoveredAgents(input);
    expect(out).not.toBe(input);
    expect(out).toEqual(input);
  });
});
