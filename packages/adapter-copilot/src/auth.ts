import type { HealthStatus } from "@maestro/core";

const TOKEN_VARS = ["COPILOT_GITHUB_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"] as const;

/** Check for a GitHub token granting Copilot access. The Copilot CLI reuses the
 *  user's Copilot subscription via this token — no separate API key. */
export function resolveAuth(env: Record<string, string | undefined>): HealthStatus {
  if (TOKEN_VARS.some((v) => env[v])) return { ok: true };
  return {
    ok: false,
    detail:
      "No GitHub token found. Set COPILOT_GITHUB_TOKEN (or GH_TOKEN / GITHUB_TOKEN) " +
      "with Copilot access, or run `gh auth login`.",
  };
}
