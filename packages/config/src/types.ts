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

/** Engine ids known at build time. Forward-compat: unknown ids produce warnings, not errors. */
export const KNOWN_ENGINE_IDS = new Set<string>(["copilot", "acp"]);
