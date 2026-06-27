import { describe, expect, it, vi } from "vitest";
import {
  createDiscoverController,
  type DiscoverDeps,
} from "../src/discover-controller.js";
import type { DiscoveredItem, McpInventory, AdoptDraft, Provenance, DiscoverResult } from "@hallucinate/config";
import type { HostToLibrary } from "../src/library-protocol.js";

// ─── Fake item factory ────────────────────────────────────────────────────────

function makeItem(overrides?: Partial<DiscoveredItem>): DiscoveredItem {
  return {
    kind: "copilot-agent",
    confidence: "verified",
    name: "Test Agent",
    description: "A test agent",
    body: "You are a test agent.",
    declaredTools: [],
    source: "/repo/.github/agents/test-agent.agent.md",
    isSkill: false,
    ...overrides,
  };
}

function makeSkillItem(overrides?: Partial<DiscoveredItem>): DiscoveredItem {
  return {
    kind: "claude-skill",
    confidence: "likely",
    name: "test-skill",
    description: "A test skill",
    body: "This skill does something.",
    declaredTools: [],
    source: "/repo/.claude/skills/test-skill/SKILL.md",
    isSkill: true,
    ...overrides,
  };
}

function makeMcp(names: string[] = []): McpInventory {
  return { servers: names.map((name) => ({ name, writeCapable: false })) };
}

function makeDiscoverResult(
  items: DiscoveredItem[] = [],
  mcp?: McpInventory
): DiscoverResult {
  return { items, mcp: mcp ?? makeMcp(), skipped: [] };
}

// ─── Fake DiscoverDeps factory ────────────────────────────────────────────────

type EmittedMsg = Extract<HostToLibrary, { type: "discover-results" }>;
type AnatomyCall = AdoptDraft;
type SkillWriteCall = { name: string; item: DiscoveredItem };
type SkillEditorCall = { item: DiscoveredItem; provenance: Provenance };

function makeDeps(overrides?: Partial<DiscoverDeps>): DiscoverDeps & {
  emitted: EmittedMsg[];
  anatomyCalls: AnatomyCall[];
  skillWriteCalls: SkillWriteCall[];
  skillEditorCalls: SkillEditorCall[];
} {
  const emitted: EmittedMsg[] = [];
  const anatomyCalls: AnatomyCall[] = [];
  const skillWriteCalls: SkillWriteCall[] = [];
  const skillEditorCalls: SkillEditorCall[] = [];

  const deps: DiscoverDeps = {
    scanWorkspace: vi.fn(async () => makeDiscoverResult([makeItem()])),
    scanPlugins: vi.fn(async () => makeDiscoverResult([])),
    headSha: vi.fn(async () => "abc123sha"),
    writeSkill: vi.fn(async (name: string, item: DiscoveredItem) => {
      skillWriteCalls.push({ name, item });
    }),
    mcpInventory: vi.fn(() => makeMcp()),
    openAnatomyEditor: vi.fn((draft: AdoptDraft) => {
      anatomyCalls.push(draft);
    }),
    openSkillEditor: vi.fn((item: DiscoveredItem, provenance: Provenance) => {
      skillEditorCalls.push({ item, provenance });
    }),
    now: vi.fn(() => "2026-06-17T00:00:00.000Z"),
    emit: vi.fn((msg: EmittedMsg) => {
      emitted.push(msg);
    }),
    ...overrides,
  };

  return Object.assign(deps, { emitted, anatomyCalls, skillWriteCalls, skillEditorCalls });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("createDiscoverController", () => {
  // 1. scan-repo emits discover-results carrying the scanned items and correct mcp
  it("scan-repo emits discover-results with scanned items and mcp", async () => {
    const item = makeItem({ source: "/repo/.github/agents/alpha.agent.md", name: "Alpha" });
    const mcp = makeMcp(["my-server"]);
    const deps = makeDeps({
      scanWorkspace: vi.fn(async () => makeDiscoverResult([item], mcp)),
    });
    const ctrl = createDiscoverController(deps);
    await ctrl.handle({ type: "scan-repo" });

    expect(deps.emitted.length).toBe(1);
    const msg = deps.emitted[0]!;
    expect(msg.type).toBe("discover-results");
    expect(msg.items).toHaveLength(1);
    expect(msg.items[0]!.name).toBe("Alpha");
    expect(msg.mcp).toEqual(mcp);
    expect(msg.scanError).toBeUndefined();
  });

  // 2. scan-plugins emits discover-results carrying plugin items
  it("scan-plugins emits discover-results with plugin items", async () => {
    const pluginItem = makeItem({
      kind: "plugin-agent",
      source: "/plugins/my-plugin/agent.agent.md",
      name: "Plugin Agent",
    });
    const mcp = makeMcp(["plugin-server"]);
    const deps = makeDeps({
      scanPlugins: vi.fn(async () => makeDiscoverResult([pluginItem], mcp)),
    });
    const ctrl = createDiscoverController(deps);
    await ctrl.handle({ type: "scan-plugins" });

    expect(deps.emitted.length).toBe(1);
    const msg = deps.emitted[0]!;
    expect(msg.items[0]!.name).toBe("Plugin Agent");
    expect(msg.mcp).toEqual(mcp);
    expect(msg.scanError).toBeUndefined();
  });

  // 3. After both scan-repo and scan-plugins, emitted items contain both (cache merge)
  it("emitted items contain both workspace and plugin items after both scans", async () => {
    const repoItem = makeItem({ source: "/repo/alpha.agent.md", name: "Repo Agent" });
    const pluginItem = makeItem({ source: "/plugins/beta.agent.md", name: "Plugin Agent" });
    const deps = makeDeps({
      scanWorkspace: vi.fn(async () => makeDiscoverResult([repoItem])),
      scanPlugins: vi.fn(async () => makeDiscoverResult([pluginItem])),
    });
    const ctrl = createDiscoverController(deps);
    await ctrl.handle({ type: "scan-repo" });
    await ctrl.handle({ type: "scan-plugins" });

    const lastEmit = deps.emitted.at(-1)!;
    const names = lastEmit.items.map((i) => i.name);
    expect(names).toContain("Repo Agent");
    expect(names).toContain("Plugin Agent");
  });

  // 4. scan-repo with a throwing scanner emits scanError string (not undefined)
  it("scan-repo with a throwing scanner emits scanError", async () => {
    const deps = makeDeps({
      scanWorkspace: vi.fn(async () => { throw new Error("disk read error"); }),
    });
    const ctrl = createDiscoverController(deps);
    await ctrl.handle({ type: "scan-repo" });

    expect(deps.emitted.length).toBe(1);
    const msg = deps.emitted[0]!;
    expect(msg.scanError).toBe("disk read error");
    expect(msg.items).toHaveLength(0);
  });

  // 5. adopt-agent calls openAnatomyEditor with correct draft fields
  it("adopt-agent calls openAnatomyEditor with draft containing valid role and provenance", async () => {
    const item = makeItem({
      source: "/repo/.github/agents/worker.agent.md",
      name: "Worker",
      kind: "copilot-agent",
      engineHint: "copilot",
    });
    const deps = makeDeps({
      scanWorkspace: vi.fn(async () => makeDiscoverResult([item])),
      headSha: vi.fn(async () => "deadbeef"),
      now: vi.fn(() => "2026-06-17T12:00:00.000Z"),
    });
    const ctrl = createDiscoverController(deps);
    await ctrl.handle({ type: "scan-repo" });
    await ctrl.handle({ type: "adopt-agent", itemId: item.source });

    expect(deps.anatomyCalls).toHaveLength(1);
    const draft = deps.anatomyCalls[0]!;
    expect(["copilot", "acp"]).toContain(draft.role.engine.id);
    expect(draft.provenance.sourcePath).toBe(item.source);
    expect(draft.provenance.upstreamSha).toBe("deadbeef");
    expect(draft.provenance.adoptedAt).toBe("2026-06-17T12:00:00.000Z");
  });

  // 5b. adopt-agent re-emits discover-results marking the item adopted
  it("adopt-agent re-emits discover-results with the item in adoptedSources", async () => {
    const item = makeItem({ source: "/repo/.github/agents/worker.agent.md" });
    const deps = makeDeps({
      scanWorkspace: vi.fn(async () => makeDiscoverResult([item])),
    });
    const ctrl = createDiscoverController(deps);
    await ctrl.handle({ type: "scan-repo" });
    await ctrl.handle({ type: "adopt-agent", itemId: item.source });

    // A fresh emit followed the adopt; its adoptedSources lists the item source.
    const last = deps.emitted.at(-1)!;
    expect(last.adoptedSources).toContain(item.source);
  });

  // 5c. adopt-skill also re-emits with the item adopted
  it("adopt-skill re-emits discover-results with the item in adoptedSources", async () => {
    const skill = makeSkillItem({ source: "/repo/.claude/skills/my-skill/SKILL.md" });
    const deps = makeDeps({
      scanWorkspace: vi.fn(async () => makeDiscoverResult([skill])),
    });
    const ctrl = createDiscoverController(deps);
    await ctrl.handle({ type: "scan-repo" });
    await ctrl.handle({ type: "adopt-skill", itemId: skill.source });

    const last = deps.emitted.at(-1)!;
    expect(last.adoptedSources).toContain(skill.source);
  });

  // 6. adopt-agent does NOT call writeSkill
  it("adopt-agent does NOT call writeSkill", async () => {
    const item = makeItem({ source: "/repo/.github/agents/worker.agent.md" });
    const deps = makeDeps({
      scanWorkspace: vi.fn(async () => makeDiscoverResult([item])),
    });
    const ctrl = createDiscoverController(deps);
    await ctrl.handle({ type: "scan-repo" });
    await ctrl.handle({ type: "adopt-agent", itemId: item.source });

    expect(deps.skillWriteCalls.length).toBe(0);
  });

  // 7. adopt-agent for unknown itemId silently does nothing
  it("adopt-agent for unknown itemId does nothing silently", async () => {
    const deps = makeDeps();
    const ctrl = createDiscoverController(deps);
    // No crash; no emit; no anatomy calls
    await expect(
      ctrl.handle({ type: "adopt-agent", itemId: "/no/such/item.md" })
    ).resolves.toBeUndefined();
    expect(deps.anatomyCalls.length).toBe(0);
    expect(deps.emitted.length).toBe(0);
  });

  // 8. adopt-skill calls writeSkill and openSkillEditor
  it("adopt-skill calls writeSkill with item's name + item, and calls openSkillEditor", async () => {
    const skill = makeSkillItem({
      source: "/repo/.claude/skills/my-skill/SKILL.md",
      name: "my-skill",
    });
    const deps = makeDeps({
      scanWorkspace: vi.fn(async () => makeDiscoverResult([skill])),
    });
    const ctrl = createDiscoverController(deps);
    await ctrl.handle({ type: "scan-repo" });
    await ctrl.handle({ type: "adopt-skill", itemId: skill.source });

    expect(deps.skillWriteCalls).toHaveLength(1);
    expect(deps.skillWriteCalls[0]!.name).toBe("my-skill");
    expect(deps.skillWriteCalls[0]!.item).toEqual(skill);

    expect(deps.skillEditorCalls).toHaveLength(1);
    expect(deps.skillEditorCalls[0]!.item).toEqual(skill);
    expect(deps.skillEditorCalls[0]!.provenance.sourcePath).toBe(skill.source);
  });

  // 9. adopt-skill does NOT call openAnatomyEditor
  it("adopt-skill does NOT call openAnatomyEditor", async () => {
    const skill = makeSkillItem({ source: "/repo/.claude/skills/my-skill/SKILL.md" });
    const deps = makeDeps({
      scanWorkspace: vi.fn(async () => makeDiscoverResult([skill])),
    });
    const ctrl = createDiscoverController(deps);
    await ctrl.handle({ type: "scan-repo" });
    await ctrl.handle({ type: "adopt-skill", itemId: skill.source });

    expect(deps.anatomyCalls.length).toBe(0);
  });

  // 10. browse-source calls nothing / mutates nothing
  it("browse-source emits nothing and calls no side effects", async () => {
    const deps = makeDeps();
    const ctrl = createDiscoverController(deps);
    await ctrl.handle({ type: "browse-source", itemId: "/repo/AGENTS.md" });

    expect(deps.emitted.length).toBe(0);
    expect(deps.anatomyCalls.length).toBe(0);
    expect(deps.skillWriteCalls.length).toBe(0);
    expect(deps.skillEditorCalls.length).toBe(0);
  });

  // 11. scan-repo after a previous scan correctly merges (items from first scan still present)
  it("second scan-repo merges items, preserving items from the first scan", async () => {
    const item1 = makeItem({ source: "/repo/alpha.agent.md", name: "Alpha" });
    const item2 = makeItem({ source: "/repo/beta.agent.md", name: "Beta" });
    let callCount = 0;
    const deps = makeDeps({
      scanWorkspace: vi.fn(async () => {
        callCount++;
        return makeDiscoverResult(callCount === 1 ? [item1] : [item2]);
      }),
    });
    const ctrl = createDiscoverController(deps);
    await ctrl.handle({ type: "scan-repo" });
    await ctrl.handle({ type: "scan-repo" });

    const lastEmit = deps.emitted.at(-1)!;
    const sources = lastEmit.items.map((i) => i.source);
    expect(sources).toContain(item1.source);
    expect(sources).toContain(item2.source);
  });

  // 12. resolveSource: a scanned local-path itemId resolves to a file open target.
  // This is the seam the host's "Browse" button uses (it then turns it into a Uri).
  it("resolveSource returns the cached source flagged as a file for a scanned local path", async () => {
    const item = makeItem({ source: "/repo/.github/agents/alpha.agent.md" });
    const deps = makeDeps({ scanWorkspace: vi.fn(async () => makeDiscoverResult([item])) });
    const ctrl = createDiscoverController(deps);
    await ctrl.handle({ type: "scan-repo" });

    expect(ctrl.resolveSource(item.source)).toEqual({ source: item.source, kind: "file" });
  });

  // 13. resolveSource: an http(s) source is flagged as a url (host parses instead of file://).
  it("resolveSource flags an http(s) source as a url", async () => {
    const item = makeItem({ source: "https://example.com/agents/remote.agent.md" });
    const deps = makeDeps({ scanWorkspace: vi.fn(async () => makeDiscoverResult([item])) });
    const ctrl = createDiscoverController(deps);
    await ctrl.handle({ type: "scan-repo" });

    expect(ctrl.resolveSource(item.source)).toEqual({ source: item.source, kind: "url" });
  });

  // 14. resolveSource: an id NOT in the scan cache resolves to undefined, so the host
  // opens nothing (and never opens an arbitrary path a stale/tampered webview posts).
  it("resolveSource returns undefined for an id not in the cache", () => {
    const deps = makeDeps();
    const ctrl = createDiscoverController(deps);

    expect(ctrl.resolveSource("/no/such/item.md")).toBeUndefined();
  });
});
