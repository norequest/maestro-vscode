/**
 * Real ConfigGateway implementation over @hallucinate/config + node fs.
 * Implements the ConfigGateway interface from library-controller.ts.
 * Node imports are isolated here; library-controller.ts stays node-free.
 */

import * as nodePath from "node:path";
import {
  loadSkills,
  loadHallucinateDir,
  loadSoul,
  serializeSkill,
  serializeRole,
  serializeTeam,
  makeNodeFsReader,
  makeNodeFsWriter,
  KNOWN_ENGINE_IDS,
  SKILLS_DIR_SEGMENTS,
} from "@hallucinate/config";
import type { Role } from "@hallucinate/core";
import type { ConfigGateway } from "./library-controller.js";
import type { AnatomyGateway } from "./anatomy-controller.js";

/**
 * The shape a freshly-seeded role gets. Copy of the extension's DEFAULT_ROLE so
 * "New agent" produces a valid, editable role file (the anatomy editor's
 * role-set-* handlers bail when loadRole returns null, so the file must exist
 * before the editor opens). The user renames + retools it from there.
 */
function defaultRole(name: string): Role {
  return {
    name,
    instructions: "You are an implementer. Make the requested change in this worktree.",
    engine: { id: "copilot" },
    autonomy: "auto-approve-safe",
  };
}

/**
 * Refuse any name that is not a single, clean path segment before it is joined
 * onto a filesystem path. This is the R6 containment guard at the source: a name
 * carrying a separator or "." / ".." could otherwise traverse out of its home dir
 * (.github/skills/ for skills, .hallucinate/ for roles and teams; the writer's
 * removeDir guard is only a backstop). Skill and role names that fail this are
 * rejected, never sanitized, so a write can never land outside the intended
 * <home>/<name>.
 */
function assertSafeSegment(value: string, kind: string): void {
  if (
    value.length === 0 ||
    value === "." ||
    value === ".." ||
    value.includes("/") ||
    value.includes("\\") ||
    value.includes("\0") ||
    value.includes(nodePath.sep)
  ) {
    throw new Error(`Unsafe ${kind} name "${value}": must be a single path segment.`);
  }
}

export function makeConfigGateway(repoRoot: string): ConfigGateway {
  return {
    async loadSkills() {
      const fsReader = await makeNodeFsReader();
      const result = await loadSkills(repoRoot, fsReader);
      return {
        skills: result.skills.map((s) => ({
          name: s.name,
          description: s.description,
          allowedTools: s.allowedTools,
          source: "authored" as const,
        })),
      };
    },

    async loadRoles() {
      const fsReader = await makeNodeFsReader();
      const result = await loadHallucinateDir(repoRoot, fsReader);
      return result.roles.map((r) => ({
        name: r.name,
        engineId: r.engine.id,
        skills: r.skills ?? [],
      }));
    },

    async loadTeams() {
      const fsReader = await makeNodeFsReader();
      const result = await loadHallucinateDir(repoRoot, fsReader);
      return result.teams.map((t) => ({
        name: t.name,
        roleNames: t.roles.map((r) => r.name),
      }));
    },

    async saveSkill(manifest, body) {
      assertSafeSegment(manifest.name, "skill");
      const fsWriter = await makeNodeFsWriter();
      // Skills live under .github/skills/ (shared with VS Code + Copilot). The
      // location is defined once in @hallucinate/config as SKILLS_DIR_SEGMENTS so the
      // write target stays in lock-step with what the loader reads.
      const skillDir = nodePath.join(repoRoot, ...SKILLS_DIR_SEGMENTS, manifest.name);
      await fsWriter.mkdir(skillDir);
      const skillPath = nodePath.join(skillDir, "SKILL.md");
      await fsWriter.writeFile(skillPath, serializeSkill(manifest, body));
    },

    async deleteSkill(name) {
      assertSafeSegment(name, "skill");
      // Delete from .github/skills/ (same home the loader and VS Code read).
      // assertSafeSegment above is the containment guard: name is proven to be a
      // single clean path segment, so the join cannot escape the skills home.
      // We use node fs.rm directly here rather than the config writer's removeDir,
      // because that writer's guard only permits paths under .hallucinate and would
      // refuse the .github/skills home. force:true makes a missing dir a no-op.
      const { rm } = await import("node:fs/promises");
      const skillDir = nodePath.join(repoRoot, ...SKILLS_DIR_SEGMENTS, name);
      await rm(skillDir, { recursive: true, force: true });
    },

    async setRoleSkills(roleName, skills) {
      const fsReader = await makeNodeFsReader();
      const result = await loadHallucinateDir(repoRoot, fsReader);
      const role = result.roles.find((r) => r.name === roleName);
      if (!role) {
        throw new Error(`Role "${roleName}" not found in .hallucinate/roles/`);
      }
      // Produce updated role: omit skills key when empty (keeps file clean)
      const updatedRole = skills.length > 0
        ? { ...role, skills }
        : { ...role, skills: undefined };
      const serialized = serializeRole(updatedRole);

      // Use a safe filename: lowercase roleName, spaces to hyphens.
      // The loader reads all *.yaml files in .hallucinate/roles/ so the exact
      // filename does not need to match, but mirroring the scaffolder's
      // convention (implementer.yaml for role "Implementer") keeps it tidy.
      const baseName = roleName.toLowerCase().replace(/\s+/g, "-");
      assertSafeSegment(baseName, "role");
      const rolePath = nodePath.join(repoRoot, ".hallucinate", "roles", `${baseName}.yaml`);

      const fsWriter = await makeNodeFsWriter();
      await fsWriter.writeFile(rolePath, serialized);
    },

    async seedRole(seed) {
      // Mirror the role-filename convention used everywhere else.
      const baseName = seed.name.toLowerCase().replace(/\s+/g, "-");
      assertSafeSegment(baseName, "role");
      const fsWriter = await makeNodeFsWriter();
      const rolePath = nodePath.join(repoRoot, ".hallucinate", "roles", `${baseName}.yaml`);
      await fsWriter.writeFile(rolePath, serializeRole(defaultRole(seed.name)));
    },

    async deleteRole(name) {
      // A role is a SINGLE file (not a dir like a skill). Guard the slug then
      // remove the file.
      const baseName = name.toLowerCase().replace(/\s+/g, "-");
      assertSafeSegment(baseName, "role");
      const fsWriter = await makeNodeFsWriter();
      const rolePath = nodePath.join(repoRoot, ".hallucinate", "roles", `${baseName}.yaml`);
      await fsWriter.removeFile(rolePath);
    },

    async writeTeam(team) {
      const baseName = team.name.toLowerCase().replace(/\s+/g, "-");
      assertSafeSegment(baseName, "team");
      const fsWriter = await makeNodeFsWriter();
      const teamPath = nodePath.join(repoRoot, ".hallucinate", "teams", `${baseName}.yaml`);
      // serializeTeam stores roles as NAME strings, so pass role objects whose
      // only meaningful field is .name (no full Role fabrication needed). The
      // loader resolves these names back to real roles at load time.
      const serialized = serializeTeam({
        name: team.name,
        roles: team.roleNames.map((n) => ({ name: n }) as Role),
      });
      await fsWriter.writeFile(teamPath, serialized);
    },

    async deleteTeam(name) {
      const baseName = name.toLowerCase().replace(/\s+/g, "-");
      assertSafeSegment(baseName, "team");
      const fsWriter = await makeNodeFsWriter();
      const teamPath = nodePath.join(repoRoot, ".hallucinate", "teams", `${baseName}.yaml`);
      await fsWriter.removeFile(teamPath);
    },
  };
}

export function makeAnatomyGateway(repoRoot: string): AnatomyGateway {
  return {
    async loadRole(roleName: string) {
      const fsReader = await makeNodeFsReader();
      const result = await loadHallucinateDir(repoRoot, fsReader);
      return result.roles.find((r) => r.name === roleName) ?? null;
    },

    async loadSoulBody(roleName: string) {
      try {
        const fsReader = await makeNodeFsReader();
        const result = await loadHallucinateDir(repoRoot, fsReader);
        const role = result.roles.find((r) => r.name === roleName);
        if (!role || !role.soul) return "";
        const soulResult = await loadSoul(repoRoot, role.soul, fsReader);
        if ("error" in soulResult) return "";
        return soulResult.soul.raw;
      } catch {
        return "";
      }
    },

    async loadSkillRequirements() {
      const fsReader = await makeNodeFsReader();
      const result = await loadSkills(repoRoot, fsReader);
      return result.skills.map((s) => ({ name: s.name, allowedTools: s.allowedTools }));
    },

    async writeRole(role) {
      const baseName = role.name.toLowerCase().replace(/\s+/g, "-");
      assertSafeSegment(baseName, "role");
      const fsWriter = await makeNodeFsWriter();
      const rolePath = nodePath.join(repoRoot, ".hallucinate", "roles", `${baseName}.yaml`);
      await fsWriter.writeFile(rolePath, serializeRole(role));
    },

    async writeSoul(roleName, body) {
      const fsReader = await makeNodeFsReader();
      const result = await loadHallucinateDir(repoRoot, fsReader);
      const role = result.roles.find((r) => r.name === roleName);
      if (!role) throw new Error(`Role "${roleName}" not found`);

      const soulName = role.soul ?? roleName.toLowerCase().replace(/\s+/g, "-");
      assertSafeSegment(soulName, "soul");

      const fsWriter = await makeNodeFsWriter();
      const soulPath = nodePath.join(repoRoot, ".hallucinate", "souls", `${soulName}.md`);
      await fsWriter.writeFile(soulPath, body);

      if (!role.soul) {
        const updatedRole = { ...role, soul: soulName };
        const baseName = roleName.toLowerCase().replace(/\s+/g, "-");
        assertSafeSegment(baseName, "role");
        const rolePath = nodePath.join(repoRoot, ".hallucinate", "roles", `${baseName}.yaml`);
        await fsWriter.writeFile(rolePath, serializeRole(updatedRole));
      }
    },

    isKnownEngineId(id: string) {
      return KNOWN_ENGINE_IDS.has(id);
    },
  };
}
