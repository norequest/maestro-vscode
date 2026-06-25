import { describe, expect, it } from "vitest";
import type { AgentDefaults } from "@maestro/core";
import { resolveDefaults, applyDefaults, FALLBACK_LEAD_SKILLS } from "../src/config-defaults.js";

describe("resolveDefaults", () => {
  it("falls back to the lead playbook when config has NO defaults block", () => {
    expect(resolveDefaults(undefined)).toEqual({
      leadSkills: ["task-coordination-strategies", "team-composition-patterns", "team-communication-protocols"],
    });
    expect(FALLBACK_LEAD_SKILLS).toEqual([
      "task-coordination-strategies",
      "team-composition-patterns",
      "team-communication-protocols",
    ]);
  });

  it("returns a provided defaults object UNCHANGED (passes it through as-is)", () => {
    const defaults: AgentDefaults = {
      instructions: "House rules.",
      skills: ["s1", "s2"],
      leadSkills: ["task-coordination-strategies", "extra"],
    };
    // Same reference, untouched: we do not clone or mutate the author's config.
    expect(resolveDefaults(defaults)).toBe(defaults);
  });

  it("respects an explicit empty leadSkills (no playbook) instead of re-injecting the fallback", () => {
    const defaults: AgentDefaults = { leadSkills: [] };
    const out = resolveDefaults(defaults);
    expect(out).toBe(defaults);
    expect(out.leadSkills).toEqual([]);
  });

  it("respects defaults that set only general layers and leave leadSkills unset", () => {
    const defaults: AgentDefaults = { instructions: "Be concise." };
    // No fallback injected: an explicit (non-undefined) defaults is authoritative.
    expect(resolveDefaults(defaults)).toBe(defaults);
    expect(resolveDefaults(defaults).leadSkills).toBeUndefined();
  });
});

describe("applyDefaults", () => {
  /** A spy orchestrator exposing just the setDefaults seam applyDefaults needs. */
  function spyOrch() {
    const calls: AgentDefaults[] = [];
    return { calls, orch: { setDefaults: (d: AgentDefaults) => calls.push(d) } };
  }

  it("pushes the lead-playbook fallback when the config has no defaults", () => {
    const { calls, orch } = spyOrch();
    applyDefaults(orch, { defaults: undefined });
    expect(calls).toEqual([{
      leadSkills: ["task-coordination-strategies", "team-composition-patterns", "team-communication-protocols"],
    }]);
  });

  it("pushes the config's defaults verbatim when present", () => {
    const { calls, orch } = spyOrch();
    const defaults: AgentDefaults = { instructions: "X", skills: ["s"], leadSkills: ["task-coordination-strategies"] };
    applyDefaults(orch, { defaults });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toBe(defaults);
  });

  it("pushes an explicit empty leadSkills through (no playbook)", () => {
    const { calls, orch } = spyOrch();
    const defaults: AgentDefaults = { leadSkills: [] };
    applyDefaults(orch, { defaults });
    expect(calls[0]).toEqual({ leadSkills: [] });
  });
});
