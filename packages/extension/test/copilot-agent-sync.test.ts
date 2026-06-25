import { describe, expect, it } from "vitest";
import type { Role } from "@maestro/core";
import { resolveRolePreamble } from "../src/copilot-agent-sync.js";

/**
 * resolveRolePreamble is what activate() registers as the orchestrator's
 * PreambleResolver. The orchestrator feeds it the EFFECTIVE (merged) role:
 * spawn() builds it via effectiveRole(), which folds defaults.leadSkills into the
 * lead's skill NAMES (gated on isLead), and launch() passes agent.role into the
 * resolver. So a lead whose leadSkills include "task-coordination-strategies"
 * arrives here with that name on role.skills, and we must turn it into a SkillRef
 * (name + frontmatter description + full SKILL.md text) for the orchestrator to
 * materialize into the worktree. These tests pin that resolution end to end.
 */

const REPO = "/repo";
const SKILL_NAME = "task-coordination-strategies";
const SKILL_MD = `---
name: ${SKILL_NAME}
description: Split a task into independent worktree teammates.
---
# Task Coordination Strategies

Do the glue work yourself, then write one delegate block per independent unit.
`;

/** An in-memory FsReader serving exactly one skill under .conductor/skills/. */
function fakeReader(files: Record<string, string>, dirs: Record<string, string[]>) {
  return {
    readFile: async (p: string): Promise<string> => {
      const v = files[p];
      if (v === undefined) throw new Error(`no such file: ${p}`);
      return v;
    },
    listFiles: async (): Promise<string[]> => [],
    listDirs: async (dir: string): Promise<string[]> => dirs[dir] ?? [],
    exists: async (p: string): Promise<boolean> => p in files || p in dirs,
  };
}

const skillsDir = `${REPO}/.conductor/skills`;
const reader = fakeReader(
  { [`${skillsDir}/${SKILL_NAME}/SKILL.md`]: SKILL_MD },
  { [skillsDir]: [SKILL_NAME] },
);

const leadRole = (skills: string[]): Role => ({
  name: "Conductor",
  instructions: "You lead.",
  engine: { id: "copilot" },
  autonomy: "auto-approve-safe",
  skills,
});

describe("resolveRolePreamble: lead leadSkills resolve to SkillRef[]", () => {
  it("turns a resolved lead skill NAME into a SkillRef with its description and full SKILL.md content", async () => {
    const { skills } = await resolveRolePreamble(REPO, leadRole([SKILL_NAME]), reader);
    expect(skills).toBeDefined();
    expect(skills).toHaveLength(1);
    const [ref] = skills!;
    expect(ref!.name).toBe(SKILL_NAME);
    expect(ref!.description).toBe("Split a task into independent worktree teammates.");
    // content is the FULL original SKILL.md text (frontmatter + body), not the body alone.
    expect(ref!.content).toBe(SKILL_MD);
  });

  it("omits skills the role names but that are not on disk (best-effort, not an error)", async () => {
    const { skills } = await resolveRolePreamble(REPO, leadRole([SKILL_NAME, "does-not-exist"]), reader);
    expect(skills).toHaveLength(1);
    expect(skills!.map((s) => s.name)).toEqual([SKILL_NAME]);
  });

  it("omits the skills field entirely when the role names no skills", async () => {
    const { skills } = await resolveRolePreamble(REPO, leadRole([]), reader);
    expect(skills).toBeUndefined();
  });

  it("degrades to no skills when the .conductor/skills dir is absent (resolver never throws)", async () => {
    const empty = fakeReader({}, {});
    const { skills } = await resolveRolePreamble(REPO, leadRole([SKILL_NAME]), empty);
    expect(skills).toBeUndefined();
  });
});
