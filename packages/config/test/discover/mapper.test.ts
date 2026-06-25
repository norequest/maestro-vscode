import { describe, it, expect } from "vitest";
import { mapToRole } from "../../src/discover/mapper.js";
import { validateRole } from "../../src/validator.js";
import type { DiscoveredItem } from "../../src/discover/types.js";
import type { McpInventory, Provenance } from "../../src/discover/mapper.js";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const PROVENANCE: Provenance = {
  sourcePath: ".claude/agents/test-agent.md",
  upstreamSha: "deadbeef",
  adoptedAt: "2026-06-17",
};

const EMPTY_MCP: McpInventory = { servers: [] };

function makeItem(overrides: Partial<DiscoveredItem>): DiscoveredItem {
  return {
    kind: "claude-agent",
    confidence: "verified",
    name: "Test Agent",
    description: "A test agent for unit testing.",
    body: "You are a test agent. Do test things.",
    declaredTools: [],
    engineHint: "claude-sonnet-4-5",
    source: ".claude/agents/test-agent.md",
    isSkill: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Engine resolution
// ---------------------------------------------------------------------------

describe("mapToRole: engine resolution", () => {
  it("maps a claude-agent (engineHint=claude-*) to engine acp", () => {
    const item = makeItem({ kind: "claude-agent", engineHint: "claude-sonnet-4-5" });
    const draft = mapToRole(item, EMPTY_MCP, PROVENANCE);
    expect(draft.role.engine.id).toBe("acp");
  });

  it("maps a .github/ agent with no model to engine copilot", () => {
    const item = makeItem({
      kind: "copilot-agent",
      engineHint: "copilot",
      source: ".github/agents/planner.agent.md",
    });
    const draft = mapToRole(item, EMPTY_MCP, PROVENANCE);
    expect(draft.role.engine.id).toBe("copilot");
  });

  it("maps a copilot-chatmode to engine copilot", () => {
    const item = makeItem({ kind: "copilot-chatmode", engineHint: "copilot" });
    const draft = mapToRole(item, EMPTY_MCP, PROVENANCE);
    expect(draft.role.engine.id).toBe("copilot");
  });

  it("maps a continue-agent (acp-leaning hint) to engine acp", () => {
    const item = makeItem({ kind: "continue-agent", engineHint: "acp" });
    const draft = mapToRole(item, EMPTY_MCP, PROVENANCE);
    expect(draft.role.engine.id).toBe("acp");
  });

  it("maps a cursor-rule (acp-leaning hint) to engine acp", () => {
    const item = makeItem({ kind: "cursor-rule", engineHint: "acp" });
    const draft = mapToRole(item, EMPTY_MCP, PROVENANCE);
    expect(draft.role.engine.id).toBe("acp");
  });

  it("maps a plugin-agent to engine copilot", () => {
    const item = makeItem({ kind: "plugin-agent", engineHint: "copilot" });
    const draft = mapToRole(item, EMPTY_MCP, PROVENANCE);
    expect(draft.role.engine.id).toBe("copilot");
  });

  it("NEVER produces an engine id outside KNOWN_ENGINE_IDS", () => {
    const kinds: DiscoveredItem["kind"][] = [
      "claude-agent", "conductor-role", "copilot-agent", "copilot-chatmode",
      "prompt", "claude-skill", "continue-agent", "cursor-rule",
      "instructions", "plugin-agent", "plugin-skill",
    ];
    for (const kind of kinds) {
      const item = makeItem({ kind, engineHint: "claude-opus-4-5" });
      const draft = mapToRole(item, EMPTY_MCP, PROVENANCE);
      expect(["copilot", "acp"]).toContain(draft.role.engine.id);
    }
  });
});

// ---------------------------------------------------------------------------
// Name sanitization
// ---------------------------------------------------------------------------

describe("mapToRole: name sanitization", () => {
  it("sanitizes a hostile name '-rf' by stripping the leading dash", () => {
    const item = makeItem({ name: "-rf" });
    const draft = mapToRole(item, EMPTY_MCP, PROVENANCE);
    expect(draft.role.name).not.toMatch(/^-/);
    // Must still pass validation
    expect(validateRole(draft.role).ok).toBe(true);
  });

  it("falls back to the filename stem when name is empty after sanitization", () => {
    const item = makeItem({ name: "", source: ".claude/agents/my-worker.md" });
    const draft = mapToRole(item, EMPTY_MCP, PROVENANCE);
    expect(draft.role.name).toBeTruthy();
    expect(draft.role.name.length).toBeGreaterThan(0);
  });

  it("strips control characters from name", () => {
    // eslint-disable-next-line no-control-regex
    const item = makeItem({ name: "Bad\x00Name" });
    const draft = mapToRole(item, EMPTY_MCP, PROVENANCE);
    // eslint-disable-next-line no-control-regex
    expect(draft.role.name).not.toMatch(/[\x00-\x1f]/);
    expect(validateRole(draft.role).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Autonomy clamping
// ---------------------------------------------------------------------------

describe("mapToRole: autonomy clamping", () => {
  it("clamps bypassPermissions to auto-approve-safe with a note", () => {
    const item = makeItem({ permissionHint: "bypassPermissions" });
    const draft = mapToRole(item, EMPTY_MCP, PROVENANCE);
    expect(draft.role.autonomy).toBe("auto-approve-safe");
    expect(draft.autonomyClampNote).toBeTruthy();
  });

  it("sets manual autonomy for acceptEdits permission hint with a note", () => {
    const item = makeItem({ permissionHint: "acceptEdits" });
    const draft = mapToRole(item, EMPTY_MCP, PROVENANCE);
    expect(draft.role.autonomy).toBe("manual");
  });

  it("sets manual autonomy when a write tool is declared", () => {
    const item = makeItem({ declaredTools: ["Edit"] });
    const draft = mapToRole(item, EMPTY_MCP, PROVENANCE);
    expect(draft.role.autonomy).toBe("manual");
    expect(draft.autonomyClampNote).toBeTruthy();
  });

  it("NEVER raises autonomy above the clamped value", () => {
    // Even with no write tools or hints, autonomy stays at manual (conservative default).
    const item = makeItem({ permissionHint: undefined, declaredTools: [] });
    const draft = mapToRole(item, EMPTY_MCP, PROVENANCE);
    expect(draft.role.autonomy).toBe("manual");
  });
});

// ---------------------------------------------------------------------------
// Write-gate: no silent write grants
// ---------------------------------------------------------------------------

describe("mapToRole: write-gate", () => {
  it("puts a declared write builtin (Edit) in unavailableTools when no MCP server provides it, NOT in role.tools", () => {
    const item = makeItem({ declaredTools: ["Edit"] });
    const draft = mapToRole(item, EMPTY_MCP, PROVENANCE);
    // Edit is a write builtin, goes to proposedSkills (not unavailableTools for builtins).
    // The key invariant: role.tools must NOT have a write grant for Edit.
    const writeGrants = draft.role.tools?.builtins?.write ?? [];
    expect(writeGrants).not.toContain("Edit");
  });

  it("puts a declared MCP tool with no configured server in unavailableTools", () => {
    const item = makeItem({ declaredTools: ["sec-kit"] });
    const draft = mapToRole(item, EMPTY_MCP, PROVENANCE);
    expect(draft.unavailableTools).toContain("sec-kit");
    // Must not appear as an MCP grant in the role.
    const mcpGrants = draft.role.tools?.mcp ?? [];
    expect(mcpGrants.some((g) => g.server === "sec-kit")).toBe(false);
  });

  it("does not grant write even when a write-capable MCP server exists", () => {
    const mcp: McpInventory = { servers: [{ name: "file-writer", writeCapable: true }] };
    const item = makeItem({ declaredTools: ["file-writer"] });
    const draft = mapToRole(item, mcp, PROVENANCE);
    const mcpGrants = draft.role.tools?.mcp ?? [];
    const grant = mcpGrants.find((g) => g.server === "file-writer");
    expect(grant?.write).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------

describe("mapToRole: provenance", () => {
  it("sets role.provenance from the provenance argument", () => {
    const item = makeItem({});
    const prov: Provenance = {
      sourcePath: ".claude/agents/foo.md",
      upstreamSha: "abc123",
      adoptedAt: "2026-06-17",
    };
    const draft = mapToRole(item, EMPTY_MCP, prov);
    expect(draft.role.provenance?.source).toBe(".claude/agents/foo.md");
    expect(draft.role.provenance?.sha).toBe("abc123");
    expect(draft.role.provenance?.adoptedAt).toBe("2026-06-17");
  });

  it("omits sha when upstreamSha is absent", () => {
    const item = makeItem({});
    const prov: Provenance = { sourcePath: ".claude/agents/bar.md", adoptedAt: "2026-06-17" };
    const draft = mapToRole(item, EMPTY_MCP, prov);
    expect(draft.role.provenance?.sha).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Validation invariant: validateRole.ok always true
// ---------------------------------------------------------------------------

describe("mapToRole: validation invariant", () => {
  const sources: Array<[string, Partial<DiscoveredItem>]> = [
    ["claude-agent with claude model", { kind: "claude-agent", engineHint: "claude-sonnet-4-5" }],
    ["copilot-agent with no model", { kind: "copilot-agent", engineHint: "copilot", source: ".github/agents/x.agent.md" }],
    ["hostile name", { name: "-rf" }],
    ["bypassPermissions", { permissionHint: "bypassPermissions" }],
    ["write tool declared", { declaredTools: ["Edit", "Run"] }],
    ["continue-agent", { kind: "continue-agent", engineHint: "acp" }],
    ["cursor-rule", { kind: "cursor-rule", engineHint: "acp" }],
    ["instructions", { kind: "instructions", engineHint: undefined }],
    ["empty name fallback", { name: "", source: ".claude/agents/fallback.md" }],
    ["write MCP server in inventory", { declaredTools: ["db-write"] }],
  ];

  for (const [label, overrides] of sources) {
    it(`validateRole(draft.role).ok === true for: ${label}`, () => {
      const item = makeItem(overrides);
      const draft = mapToRole(item, EMPTY_MCP, PROVENANCE);
      const result = validateRole(draft.role);
      expect(result.ok).toBe(true);
    });
  }
});
