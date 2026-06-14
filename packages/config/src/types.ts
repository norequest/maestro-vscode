export interface ValidationOk<T> {
  ok: true;
  value: T;
  warnings: ValidationWarning[];
}

export interface ValidationError {
  ok: false;
  errors: string[];
  warnings: ValidationWarning[];
}

export type ValidationResult<T> = ValidationOk<T> | ValidationError;

export interface ValidationWarning {
  field: string;
  message: string;
}

/**
 * Engine ids known at build time. These are the only adapters Maestro will ever
 * spawn. A role naming any other engine.id is REJECTED at validation time
 * (Issue 28 / S9): an adapter command/binary must never be sourced from
 * .conductor/ config, so an unknown id cannot be honored.
 */
export const KNOWN_ENGINE_IDS = new Set<string>(["copilot", "acp"]);
