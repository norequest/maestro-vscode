import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as path from "node:path";
import type { AgentProfile, Role, SpawnOptions, Team } from "@maestro/core";
import { slugForRole } from "@maestro/adapter-copilot";
import {
  COPILOT_ENGINE_ID,
  FLEET_ENGINE_ID,
  buildFleetPrompt,
  launchFleetTeam,
  teammateDescription,
  toFleetConductor,
  usesFleet,
} from "../src/fleet-team.js";

const role = (name: string, instructions = `You are ${name}.`): Role => ({
  name,
  instructions,
  engine: { id: "copilot" },
  autonomy: "auto-approve-safe",
});

const conductor: Role = {
  name: "Conductor",
  instructions: "You are the conductor.",
  engine: { id: "copilot" },
  autonomy: "auto-approve-safe",
};

describe("usesFleet", () => {
  it("is true for a Copilot lead", () => {
    expect(usesFleet(conductor)).toBe(true);
    expect(usesFleet({ ...conductor, engine: { id: COPILOT_ENGINE_ID } })).toBe(true);
  });

  it("is false for an ACP (gemini) lead, so ACP keeps the delegate/spawn model", () => {
    expect(usesFleet({ ...conductor, engine: { id: "acp" } })).toBe(false);
    expect(usesFleet({ ...conductor, engine: { id: "gemini" } })).toBe(false);
  });
});

describe("toFleetConductor", () => {
  it("rewrites ONLY engine.id to the fleet id, preserving everything else", () => {
    const c: Role = { ...conductor, engine: { id: "copilot", model: "gpt-5" }, skills: ["x"] };
    const f = toFleetConductor(c);
    expect(f.engine.id).toBe(FLEET_ENGINE_ID);
    expect(f.engine.model).toBe("gpt-5");
    expect(f.name).toBe("Conductor");
    expect(f.instructions).toBe(c.instructions);
    expect(f.skills).toEqual(["x"]);
    // Pure: input untouched.
    expect(c.engine.id).toBe("copilot");
  });
});

describe("teammateDescription", () => {
  it("takes the first instruction line, trimmed", () => {
    expect(teammateDescription(role("Coder", "Writes code.\nMore detail."))).toBe("Writes code.");
  });

  it("falls back to the role name when instructions are empty", () => {
    expect(teammateDescription(role("Coder", ""))).toBe("Coder");
  });

  it("caps an over-long line with a plain ... (never an em dash)", () => {
    const long = "x".repeat(200);
    const out = teammateDescription(role("Coder", long));
    expect(out.length).toBe(123); // 120 + "..."
    expect(out.endsWith("...")).toBe(true);
    expect(out).not.toContain("—");
  });
});

describe("buildFleetPrompt", () => {
  it("starts with the REQUIRED '/fleet ' trigger then the task text", () => {
    const prompt = buildFleetPrompt("wire the endpoint", [], slugForRole);
    expect(prompt.startsWith("/fleet wire the endpoint")).toBe(true);
  });

  it("lists one roster line per teammate as '- <slug>: <description>'", () => {
    const teammates = [role("Api Dev", "Builds APIs."), role("Db Dev", "Owns the schema.")];
    const prompt = buildFleetPrompt("task", teammates, slugForRole);
    expect(prompt).toContain("- api-dev: Builds APIs.");
    expect(prompt).toContain("- db-dev: Owns the schema.");
    // The delegation nudge is present.
    expect(prompt).toContain("Delegate independent work");
    expect(prompt).toContain("run independent items in parallel");
  });

  it("uses the SAME slug helper the adapter selects with --agent, so names match", () => {
    const prompt = buildFleetPrompt("task", [role("API Reviewer")], slugForRole);
    expect(prompt).toContain(`- ${slugForRole("API Reviewer")}:`);
  });

  it("contains no em dashes", () => {
    const prompt = buildFleetPrompt("ship it", [role("Coder")], slugForRole);
    expect(prompt).not.toContain("—");
  });
});

describe("launchFleetTeam", () => {
  /** A spy seam recording profile builds, registrations, and the single spawn. */
  function spy() {
    const profiled: string[] = [];
    const registered: Array<{ name: string; engineId: string }> = [];
    const spawns: Array<{ roleName: string; description: string; opts?: SpawnOptions }> = [];
    return {
      profiled,
      registered,
      spawns,
      deps: {
        buildTeammateProfile: (r: Role): AgentProfile => {
          profiled.push(r.name);
          return { name: slugForRole(r.name), content: `--- agent ${r.name} ---` };
        },
        registerRole: (r: Role) => {
          registered.push({ name: r.name, engineId: r.engine.id });
        },
        slugFor: slugForRole,
        spawn: (roleName: string, description: string, opts?: SpawnOptions) => {
          spawns.push({ roleName, description, opts });
        },
      },
    };
  }

  const team: Team = { name: "Backend", roles: [role("ApiDev"), role("DbDev")] };

  it("spawns ONLY the conductor (one process), never a process per teammate", async () => {
    const s = spy();
    await launchFleetTeam(team, "build the api", conductor, s.deps);
    expect(s.spawns).toHaveLength(1);
    expect(s.spawns[0]!.roleName).toBe("Conductor");
  });

  it("the conductor's spawn description is the '/fleet ...' prompt listing the roster slugs", async () => {
    const s = spy();
    await launchFleetTeam(team, "build the api", conductor, s.deps);
    const desc = s.spawns[0]!.description;
    expect(desc.startsWith("/fleet build the api")).toBe(true);
    expect(desc).toContain("- apidev:");
    expect(desc).toContain("- dbdev:");
  });

  it("registers the conductor on the FLEET engine id and the teammates on their own", async () => {
    const s = spy();
    await launchFleetTeam(team, "task", conductor, s.deps);
    const cond = s.registered.find((r) => r.name === "Conductor");
    expect(cond?.engineId).toBe(FLEET_ENGINE_ID);
    expect(s.registered.find((r) => r.name === "ApiDev")?.engineId).toBe("copilot");
    expect(s.registered.find((r) => r.name === "DbDev")?.engineId).toBe("copilot");
  });

  it("passes agentProfiles to spawn: one per TEAMMATE, never one for the conductor", async () => {
    const s = spy();
    await launchFleetTeam(team, "task", conductor, s.deps);
    // Profiles built only for the teammates, not the conductor.
    expect(s.profiled).toEqual(["ApiDev", "DbDev"]);
    const profiles = s.spawns[0]!.opts?.agentProfiles ?? [];
    expect(profiles.map((p) => p.name)).toEqual(["apidev", "dbdev"]);
    // No profile carries the conductor's slug.
    expect(profiles.some((p) => p.name === slugForRole("Conductor"))).toBe(false);
    // Each profile has non-empty content.
    for (const p of profiles) expect(p.content.length).toBeGreaterThan(0);
  });

  it("the materialized profile names (slugs) match the names advertised in the prompt roster", async () => {
    const s = spy();
    await launchFleetTeam(team, "task", conductor, s.deps);
    const desc = s.spawns[0]!.description;
    const profiles = s.spawns[0]!.opts?.agentProfiles ?? [];
    for (const p of profiles) expect(desc).toContain(`- ${p.name}:`);
  });

  it("does NOT write into the main repo .github/agents (no materialize-to-repoRoot dep)", () => {
    // The dep contract no longer exposes a main-repo materialize hook; the only
    // agent files written at fleet launch are worktree profiles via spawn options.
    const s = spy();
    expect("materializeAgent" in s.deps).toBe(false);
  });

  it("skips a teammate whose profile build throws, still spawning the conductor", async () => {
    const s = spy();
    const deps = {
      ...s.deps,
      buildTeammateProfile: (r: Role): AgentProfile => {
        if (r.name === "ApiDev") throw new Error("read failed");
        s.profiled.push(r.name);
        return { name: slugForRole(r.name), content: `--- agent ${r.name} ---` };
      },
    };
    await launchFleetTeam(team, "task", conductor, deps);
    // The conductor still spawned despite the teammate's profile build throwing.
    expect(s.spawns).toHaveLength(1);
    const profiles = s.spawns[0]!.opts?.agentProfiles ?? [];
    // The failing teammate is skipped; the healthy one is still materialized.
    expect(profiles.map((p) => p.name)).toEqual(["dbdev"]);
  });

  it("skips a teammate whose profile build returns null (best-effort)", async () => {
    const s = spy();
    const deps = {
      ...s.deps,
      buildTeammateProfile: (r: Role): AgentProfile | null =>
        r.name === "ApiDev" ? null : { name: slugForRole(r.name), content: "x" },
    };
    await launchFleetTeam(team, "task", conductor, deps);
    expect(s.spawns).toHaveLength(1);
    const profiles = s.spawns[0]!.opts?.agentProfiles ?? [];
    expect(profiles.map((p) => p.name)).toEqual(["dbdev"]);
  });
});

// ─── Source-text wiring (extension.ts imports vscode, so it can't be unit-run) ──
const here = path.dirname(fileURLToPath(import.meta.url));
const extensionSrc = readFileSync(path.join(here, "..", "src", "extension.ts"), "utf8");

describe("fleet wiring in extension.ts (source)", () => {
  it("registers a SECOND Copilot adapter in fleet mode under FLEET_ENGINE_ID", () => {
    expect(extensionSrc).toMatch(/new CopilotAdapter\(\s*\{[^}]*fleet:\s*true[^}]*\}\s*\)/s);
    expect(extensionSrc).toMatch(/id:\s*FLEET_ENGINE_ID/);
  });

  it("the single-agent Copilot adapter stays NON-fleet (no fleet flag on the shared one)", () => {
    // The shared adapter line must not carry fleet:true.
    expect(extensionSrc).toMatch(
      /orch\.registerAdapter\(new CopilotAdapter\(\{ agentProfile: nodeAgentProfileWriter \}\)\)/,
    );
  });

  it("the team-launch path chooses fleet for a Copilot lead, else the delegate model", () => {
    expect(extensionSrc).toMatch(/if\s*\(usesFleet\(CONDUCTOR_ROLE\)\)/);
    expect(extensionSrc).toMatch(/await launchFleetTeam\(/);
    expect(extensionSrc).toMatch(/launchConductorTeam\(/);
  });
});
