import type { Role, Team, OrchestratorConfig } from "@maestro/core";
import type { ValidationResult, ValidationWarning } from "./types.js";
import { KNOWN_ENGINE_IDS } from "./types.js";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isString(v: unknown): v is string {
  return typeof v === "string";
}

function isNumber(v: unknown): v is number {
  return typeof v === "number";
}

export function validateRole(raw: unknown): ValidationResult<Role> {
  const errors: string[] = [];
  const warnings: ValidationWarning[] = [];

  if (!isRecord(raw)) {
    return { ok: false, errors: ["role must be an object"], warnings };
  }

  if (!isString(raw["name"]) || raw["name"].trim() === "") {
    errors.push("role.name must be a non-empty string");
  }
  if (!isString(raw["instructions"]) || raw["instructions"].trim() === "") {
    errors.push("role.instructions must be a non-empty string");
  }

  const engine = raw["engine"];
  if (!isRecord(engine)) {
    errors.push("role.engine must be an object with an id field");
  } else {
    if (!isString(engine["id"]) || engine["id"].trim() === "") {
      errors.push("role.engine.id must be a non-empty string");
    } else if (!KNOWN_ENGINE_IDS.has(engine["id"])) {
      warnings.push({
        field: "engine.id",
        message: `unknown engine id "${engine["id"]}"; known ids: ${[...KNOWN_ENGINE_IDS].join(", ")}. This may work once the engine adapter is registered.`,
      });
    }
    if (engine["model"] !== undefined && !isString(engine["model"])) {
      errors.push("role.engine.model must be a string if provided");
    }
  }

  const autonomy = raw["autonomy"];
  const validAutonomy = ["manual", "auto-approve-safe", "yolo"];
  if (!isString(autonomy) || !validAutonomy.includes(autonomy)) {
    errors.push(`role.autonomy must be one of: ${validAutonomy.join(", ")}`);
  }

  if (errors.length > 0) {
    return { ok: false, errors, warnings };
  }

  const engineRecord = raw["engine"] as Record<string, unknown>;
  const role: Role = {
    name: (raw["name"] as string).trim(),
    instructions: raw["instructions"] as string,
    engine: {
      id: (engineRecord["id"] as string).trim(),
      ...(engineRecord["model"] !== undefined
        ? { model: engineRecord["model"] as string }
        : {}),
    },
    autonomy: raw["autonomy"] as Role["autonomy"],
  };

  return { ok: true, value: role, warnings };
}

export function validateTeam(
  raw: unknown,
  knownRoles: Map<string, Role>,
): ValidationResult<Team> {
  const errors: string[] = [];
  const warnings: ValidationWarning[] = [];

  if (!isRecord(raw)) {
    return { ok: false, errors: ["team must be an object"], warnings };
  }

  if (!isString(raw["name"]) || raw["name"].trim() === "") {
    errors.push("team.name must be a non-empty string");
  }

  if (!Array.isArray(raw["roles"])) {
    errors.push("team.roles must be an array of role name strings");
  } else {
    for (const item of raw["roles"]) {
      if (!isString(item)) {
        errors.push(`team.roles entries must be strings; got ${JSON.stringify(item)}`);
      } else if (!knownRoles.has(item)) {
        warnings.push({
          field: "roles",
          message: `role "${item}" is referenced in team but not found in loaded roles; the role file may not exist yet`,
        });
      }
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors, warnings };
  }

  const roleNames = (raw["roles"] as unknown[]).filter(isString);
  const roles: Role[] = roleNames.map((n) => knownRoles.get(n)).filter((r): r is Role => r !== undefined);

  return {
    ok: true,
    value: { name: (raw["name"] as string).trim(), roles },
    warnings,
  };
}

export function validateOrchestratorConfig(raw: unknown): ValidationResult<OrchestratorConfig> {
  const errors: string[] = [];
  const warnings: ValidationWarning[] = [];

  if (!isRecord(raw)) {
    return { ok: false, errors: ["config must be an object"], warnings };
  }

  const max = raw["maxParallelAgents"];
  if (max !== undefined) {
    if (!isNumber(max) || !Number.isInteger(max) || max < 1) {
      errors.push("config.maxParallelAgents must be a positive integer if provided");
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors, warnings };
  }

  return {
    ok: true,
    value: {
      maxParallelAgents: isNumber(max) ? max : 3,
    },
    warnings,
  };
}
