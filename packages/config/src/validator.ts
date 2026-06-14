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

/**
 * Allowed characters for an engine model id. Anchored so the first character
 * must be alphanumeric. This forbids a leading dash, which prevents a model
 * value from being interpreted as a CLI flag if any downstream code ever
 * builds a command string from it (argument-injection defense, Issue 29 / S4).
 */
const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

/** Matches ASCII control characters (\x00-\x1f), which must never appear in a role name. */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x1f]/;

export function validateRole(raw: unknown): ValidationResult<Role> {
  const errors: string[] = [];
  const warnings: ValidationWarning[] = [];

  if (!isRecord(raw)) {
    return { ok: false, errors: ["role must be an object"], warnings };
  }

  if (!isString(raw["name"]) || raw["name"].trim() === "") {
    errors.push("role.name must be a non-empty string");
  } else {
    // role.name may legitimately contain spaces or non-ASCII / Georgian
    // characters, so we do NOT impose an ASCII allowlist. We only block names
    // that could be interpreted as a CLI flag (leading dash) or that smuggle
    // control characters downstream (argument-injection defense, Issue 29 / S4).
    const name = raw["name"].trim();
    if (name.startsWith("-")) {
      errors.push("role.name must not start with a dash");
    }
    if (CONTROL_CHARS.test(raw["name"])) {
      errors.push("role.name must not contain control characters");
    }
  }
  if (!isString(raw["instructions"]) || raw["instructions"].trim() === "") {
    errors.push("role.instructions must be a non-empty string");
  }

  const engine = raw["engine"];
  if (!isRecord(engine)) {
    errors.push("role.engine must be an object with an id field");
  } else {
    // Invariant: an adapter's command / binary must NEVER be sourced from
    // .conductor/ config. Only the fixed, registered adapters (KNOWN_ENGINE_IDS)
    // are ever spawned. engine.id selects among those adapters by name; it does
    // not supply an executable path. An unknown engine.id is therefore an ERROR
    // (not a warning): a role naming an engine we cannot run must be rejected
    // (Issue 28 / S9).
    if (!isString(engine["id"]) || engine["id"].trim() === "") {
      errors.push("role.engine.id must be a non-empty string");
    } else if (!KNOWN_ENGINE_IDS.has(engine["id"])) {
      errors.push(
        `role.engine.id "${engine["id"]}" is not a known engine; known ids: ${[...KNOWN_ENGINE_IDS].join(", ")}`,
      );
    }
    if (engine["model"] !== undefined) {
      if (!isString(engine["model"])) {
        errors.push("role.engine.model must be a string if provided");
      } else if (!MODEL_PATTERN.test(engine["model"])) {
        // Charset guard so a model value can never become a CLI flag or smuggle
        // shell-unsafe characters (argument-injection defense, Issue 29 / S4).
        errors.push(
          "role.engine.model must start with an alphanumeric character and contain only letters, digits, and the characters . _ : -",
        );
      }
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
