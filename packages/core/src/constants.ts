import type { Autonomy } from "./types.js";

/**
 * Engine ids: the single source of truth for the strings the orchestrator uses
 * to route an agent to its adapter (`adapters.get(role.engine.id)`). Every other
 * package imports these instead of repeating the literals.
 *
 * `COPILOT_ENGINE_ID` and `ACP_ENGINE_ID` are USER-AUTHORABLE: a role in
 * .conductor/ may name them, and config's KNOWN_ENGINE_IDS is derived from them.
 * `FLEET_ENGINE_ID` is INTERNAL: it is injected only at launch (a Copilot team's
 * conductor is rewritten to it) and is intentionally NOT user-authorable, so it
 * is deliberately excluded from KNOWN_ENGINE_IDS.
 */
export const COPILOT_ENGINE_ID = "copilot";
export const ACP_ENGINE_ID = "acp";
export const FLEET_ENGINE_ID = "copilot-fleet";

/**
 * The autonomy levels as a runtime array, for value-level checks (validation,
 * guards). Kept in lockstep with the {@link Autonomy} type: the `readonly
 * Autonomy[]` annotation makes adding a level without updating both a type error.
 */
export const AUTONOMY_VALUES: readonly Autonomy[] = ["manual", "auto-approve-safe", "yolo"];
