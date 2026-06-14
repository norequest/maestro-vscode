import { parse as parseYaml } from "yaml";
import { validateRole, validateTeam, validateOrchestratorConfig } from "./validator.js";
import type { ValidationResult } from "./types.js";
import type { Role, Team, OrchestratorConfig } from "@maestro/core";

export interface ParseRoleResult {
  role: ValidationResult<Role>;
  source: string;
}

export interface ParseTeamResult {
  team: ValidationResult<Team>;
  source: string;
}

export interface ParseConfigResult {
  config: ValidationResult<OrchestratorConfig>;
  source: string;
}

export function parseRoleYaml(
  yamlText: string,
  source: string,
  knownRoles?: Map<string, Role>,
): ParseRoleResult {
  let raw: unknown;
  try {
    raw = parseYaml(yamlText);
  } catch (err) {
    return {
      source,
      role: {
        ok: false,
        errors: [`YAML parse error in ${source}: ${String(err)}`],
        warnings: [],
      },
    };
  }
  return { source, role: validateRole(raw) };
}

export function parseTeamYaml(
  yamlText: string,
  source: string,
  knownRoles: Map<string, Role>,
): ParseTeamResult {
  let raw: unknown;
  try {
    raw = parseYaml(yamlText);
  } catch (err) {
    return {
      source,
      team: {
        ok: false,
        errors: [`YAML parse error in ${source}: ${String(err)}`],
        warnings: [],
      },
    };
  }
  return { source, team: validateTeam(raw, knownRoles) };
}

export function parseConfigYaml(yamlText: string, source: string): ParseConfigResult {
  let raw: unknown;
  try {
    raw = parseYaml(yamlText);
  } catch (err) {
    return {
      source,
      config: {
        ok: false,
        errors: [`YAML parse error in ${source}: ${String(err)}`],
        warnings: [],
      },
    };
  }
  return { source, config: validateOrchestratorConfig(raw) };
}
