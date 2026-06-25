import type { Role, SkillRef, SoulDoc } from "@hallucinate/core";
import { buildAgentProfile, slugForRole, writeRepoAgentFile } from "@hallucinate/adapter-copilot";
import { loadHallucinateDir, loadSkills, loadSoul, makeNodeFsReader } from "@hallucinate/config";

/** A reader as produced by makeNodeFsReader(); kept loose to avoid coupling. */
type FsReader = Awaited<ReturnType<typeof makeNodeFsReader>>;

/**
 * Resolve a role's soul document and attached skills from .hallucinate/.
 * Extracted so the orchestrator's preamble resolver and the .github/agents
 * sync share ONE definition of "how a role's persona is assembled". Best-effort:
 * a missing/unreadable soul or skills file degrades to omitting that part.
 *
 * Skills are returned as {@link SkillRef}s (name + description + full SKILL.md
 * text), not inlined bodies: they are advertised by name in the preamble and the
 * orchestrator materializes their content into the worktree on demand.
 */
export async function resolveRolePreamble(
  repoRoot: string,
  role: Role,
  reader: FsReader,
): Promise<{ soulDoc?: SoulDoc; skills?: SkillRef[] }> {
  const skillsResult = await loadSkills(repoRoot, reader).catch(() => ({
    bodies: new Map<string, string>(),
    details: new Map<string, { description?: string; raw: string }>(),
  }));
  const skills = (role.skills ?? [])
    .map((n): SkillRef | undefined => {
      const d = skillsResult.details?.get(n);
      return d ? { name: n, description: d.description, content: d.raw } : undefined;
    })
    .filter((s): s is SkillRef => s !== undefined);
  let soulDoc: SoulDoc | undefined;
  if (role.soul) {
    const s = await loadSoul(repoRoot, role.soul, reader).catch(() => null);
    if (s && "soul" in s) soulDoc = s.soul;
  }
  return { ...(soulDoc ? { soulDoc } : {}), ...(skills.length ? { skills } : {}) };
}

/**
 * Materialize a saved Hallucinate role as a repo-level Copilot custom agent at
 * `.github/agents/<slug>.agent.md`, so it appears in the VS Code Copilot Chat
 * picker (after a window reload) and the CLI WITHOUT having to dispatch it.
 *
 * Only copilot-engine roles are mirrored (the .agent.md format is Copilot's; an
 * ACP/gemini role would be misleading). Best-effort: any failure (role gone,
 * unreadable config, write error) resolves to `null` rather than throwing, so a
 * sync never breaks the create/edit flow that triggered it.
 *
 * Returns `{ created }` (true when the file was newly written) or null when no
 * file was written, so the caller can show the "reload window" hint once.
 */
export async function syncRepoCopilotAgent(
  repoRoot: string,
  roleName: string,
): Promise<{ created: boolean } | null> {
  try {
    const reader = await makeNodeFsReader();
    const loaded = await loadHallucinateDir(repoRoot, reader).catch(() => null);
    const role = loaded?.roles.find((r) => r.name === roleName);
    if (!role || role.engine.id !== "copilot") return null;
    const { soulDoc, skills } = await resolveRolePreamble(repoRoot, role, reader);
    const content = buildAgentProfile(role, {
      id: "",
      description: "",
      roleName: role.name,
      ...(soulDoc ? { soulDoc } : {}),
      ...(skills ? { skills } : {}),
    });
    return writeRepoAgentFile(repoRoot, slugForRole(role.name), content);
  } catch {
    return null;
  }
}
