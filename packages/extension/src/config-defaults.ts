import type { AgentDefaults } from "@hallucinate/core";

/**
 * The skills the lead (the agent holding a team roster) is given when a
 * `.hallucinate` dir predates the config-driven `defaults` block. The lead's
 * delegation brief now comes from config, not hardcoded on LEAD_ROLE; this
 * fallback keeps the lead's playbook working for legacy repos that have no
 * `defaults:` block yet. These three are the vendored coordination skills that
 * STARTER_CONFIG_YAML lists under `defaults.leadSkills`.
 */
export const FALLBACK_LEAD_SKILLS = [
  "task-coordination-strategies",
  "team-composition-patterns",
  "team-communication-protocols",
];

/**
 * Resolve the effective {@link AgentDefaults} to push onto the orchestrator from
 * a loaded config's `defaults` block.
 *
 * - When the config carries NO `defaults` (a legacy `.hallucinate` dir, or none at
 *   all, falling back to DEFAULT_CONFIG), return the fallback that still gives
 *   the lead the coordination playbook: `{ leadSkills: FALLBACK_LEAD_SKILLS }`.
 * - When the config DOES carry `defaults`, pass it through UNCHANGED. An explicit
 *   `leadSkills: []` is respected as "no playbook for the lead"; we do not
 *   re-inject the fallback over an author's deliberate choice.
 *
 * Pure (no fs, no vscode) so the activate/launch wiring stays unit-testable.
 */
export function resolveDefaults(defaults: AgentDefaults | undefined): AgentDefaults {
  if (defaults === undefined) return { leadSkills: [...FALLBACK_LEAD_SKILLS] };
  return defaults;
}

/** The minimal orchestrator seam the defaults wiring needs (set on the real Orchestrator). */
export interface SetsDefaults {
  setDefaults(d: AgentDefaults): void;
}

/**
 * Apply a loaded config's `defaults` (resolved via {@link resolveDefaults}) onto
 * an orchestrator. The single seam both the activate-time wiring and the
 * per-launch refresh call, so a config edit takes effect on the next team launch
 * without a window reload and the two call sites cannot drift.
 */
export function applyDefaults(
  orch: SetsDefaults,
  config: { defaults?: AgentDefaults },
): void {
  orch.setDefaults(resolveDefaults(config.defaults));
}
