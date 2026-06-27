/**
 * A status-safe palette in the violet/magenta/rose arc. These hues never collide
 * with the Floor's status accents (blue/green/amber/red), so a team-identity hue
 * can never be misread as a status signal (status stays on `tone`).
 */
const TEAM_HUES = [268, 288, 332, 256, 305, 320, 278, 296] as const;

/** FNV-1a (32-bit) over a string. Pure and deterministic; no randomness. */
function fnv1a(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Deterministic team-identity hue (0-359) for a lead id. Pure: the same id always
 * maps to the same hue, derived by hashing the id into the status-safe palette.
 */
export function teamHue(leadId: string): number {
  return TEAM_HUES[fnv1a(leadId) % TEAM_HUES.length]!;
}
