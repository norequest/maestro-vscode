import { loadHallucinateDir, KNOWN_ENGINE_IDS, type FsReader } from "@hallucinate/config";
import type { Role, Team } from "@hallucinate/core";

export interface ComposerData {
  roles: Role[];
  teams: Team[];
  errors: Array<{ source: string; errors: string[] }>;
}

/**
 * Loads the .hallucinate/ directory and maps the result to the shape the
 * composer panel expects. Vscode-free: inject any FsReader for testing.
 */
export async function loadComposerData(repoRoot: string, fs: FsReader): Promise<ComposerData> {
  const loaded = await loadHallucinateDir(repoRoot, fs);
  return {
    roles: loaded.roles,
    teams: loaded.teams,
    errors: loaded.errors,
  };
}

/**
 * The host-side allowlist gate (R6): a dispatch engineId must be one of the
 * statically-known adapter ids before it is forwarded to core. This prevents
 * a tampered webview from injecting an arbitrary binary as an engine.
 */
export function isKnownEngineId(id: string): boolean {
  return KNOWN_ENGINE_IDS.has(id);
}
