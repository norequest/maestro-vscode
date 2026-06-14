import { stringify as stringifyYaml } from "yaml";
import type { Role, Team } from "@maestro/core";

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
  };
  return stringifyYaml(doc, { lineWidth: 120 });
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
