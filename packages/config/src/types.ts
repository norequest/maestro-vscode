import type { OrchestratorConfig, AgentDefaults } from "@hallucinate/core";
import { COPILOT_ENGINE_ID, ACP_ENGINE_ID } from "@hallucinate/core";

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
 * Engine ids known at build time. These are the only adapters Hallucinate will ever
 * spawn. A role naming any other engine.id is REJECTED at validation time
 * (Issue 28 / S9): an adapter command/binary must never be sourced from
 * .hallucinate/ config, so an unknown id cannot be honored.
 *
 * Derived from the core constants (the single source of truth). FLEET_ENGINE_ID
 * is deliberately omitted: it is launch-injected and internal, never authored in
 * .hallucinate/, so a role naming it must still be rejected here.
 */
export const KNOWN_ENGINE_IDS = new Set<string>([COPILOT_ENGINE_ID, ACP_ENGINE_ID]);

/**
 * The config object the loader returns: the core `OrchestratorConfig` plus the
 * optional config-driven `defaults` layer parsed from `.hallucinate/config.yaml`.
 *
 * `defaults` is kept here (not on the core type) so the config package owns the
 * shape it parses/serializes. It is optional, so an absent `defaults` block is
 * identical to today (back-compat).
 */
export interface HallucinateConfig extends OrchestratorConfig {
  defaults?: AgentDefaults;
}
