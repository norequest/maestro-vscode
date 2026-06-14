import { describe, expect, it } from "vitest";
import type { AgentState } from "@maestro/core";
import type { CardVM } from "@maestro/cockpit";
import { cardIcon, cardToRosterItem } from "../src/roster-map.js";

function card(over: Partial<CardVM> = {}): CardVM {
  return { id: "a1", roleName: "Implementer", engineId: "copilot", state: "working", output: "", attention: false, ...over };
}

describe("roster mapping", () => {
  it("labels with the role and describes with the engine", () => {
    const item = cardToRosterItem(card());
    expect(item.id).toBe("a1");
    expect(item.label).toContain("Implementer");
    expect(item.description).toContain("copilot");
  });

  it("picks a distinct icon per state", () => {
    const states: AgentState[] = ["preparing", "working", "awaiting-approval", "done", "error", "conflict", "merged", "discarded", "stopped", "detached", "pr-created"];
    const icons = states.map(cardIcon);
    expect(new Set(icons).size).toBe(icons.length); // all distinct
  });

  it("flags attention cards", () => {
    expect(cardToRosterItem(card({ state: "done", attention: true })).attention).toBe(true);
  });

  it("returns debug-disconnect icon for detached state", () => {
    expect(cardIcon("detached")).toBe("debug-disconnect");
  });

  it("returns warning icon for merge-cleanup-failed state", () => {
    expect(cardIcon("merge-cleanup-failed")).toBe("warning");
  });

  it("returns git-pull-request icon for pr-created state", () => {
    expect(cardIcon("pr-created")).toBe("git-pull-request");
  });

  it("maps a pr-created card to a roster item with the right description and icon", () => {
    const item = cardToRosterItem(card({ state: "pr-created" }));
    expect(item.icon).toBe("git-pull-request");
    expect(item.description).toContain("pr-created");
    expect(item.description).toContain("copilot");
  });
});
