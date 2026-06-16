import { stringify as stringifyYaml } from "yaml";
import type { Role, Team } from "@maestro/core";
import type { SkillManifest } from "./skill-types.js";

/**
 * Serialize a Role to a YAML string suitable for writing to .conductor/roles/<name>.yaml.
 * Produces clean, human-readable output with no extra blank lines.
 */
export function serializeRole(role: Role): string {
  const doc: Record<string, unknown> = {
    name: role.name,
    instructions: role.instructions,
    engine: role.engine.model
      ? { id: role.engine.id, model: role.engine.model }
      : { id: role.engine.id },
    autonomy: role.autonomy,
    ...(role.skills !== undefined ? { skills: role.skills } : {}),
  };
  return stringifyYaml(doc, { lineWidth: 120 });
}

/**
 * Serialize a SkillManifest and body text to a SKILL.md string.
 * Produces a YAML frontmatter block followed by the body text.
 * Suitable for writing to .conductor/skills/<name>/SKILL.md.
 */
export function serializeSkill(manifest: SkillManifest, body: string): string {
  const frontmatterDoc: Record<string, unknown> = {
    name: manifest.name,
    description: manifest.description,
    ...(manifest.allowedTools !== undefined ? { "allowed-tools": manifest.allowedTools } : {}),
  };
  const frontmatter = stringifyYaml(frontmatterDoc, { lineWidth: 120 });
  return `---\n${frontmatter}---\n${body}`;
}

/**
 * Serialize a Team to a YAML string suitable for writing to .conductor/teams/<name>.yaml.
 * Role references are stored as name strings (resolved at load time).
 */
export function serializeTeam(team: Team): string {
  const doc: Record<string, unknown> = {
    name: team.name,
    roles: team.roles.map((r) => r.name),
  };
  return stringifyYaml(doc, { lineWidth: 120 });
}
