/**
 * Pure builder for an adopt-draft AnatomyVM. Extracted from the (now retired)
 * AnatomyWebviewPanel.openDraft so the single-page host can show a discovered
 * agent's anatomy pre-filled WITHOUT writing it to disk.
 *
 * No vscode, no node imports: just the VM shape over @maestro/core + @maestro/config.
 */

import { countGrants } from "@maestro/core";
import { skillNeedsGrant } from "@maestro/config";
import type { AdoptDraft } from "@maestro/config";
import type { AnatomyVM } from "./anatomy-protocol.js";

/**
 * Build a minimal AnatomyVM from an adopt draft + the library's declared skill
 * requirements, without persisting. Mirrors the old AnatomyWebviewPanel.openDraft
 * exactly so the draft preview is identical.
 */
export function buildDraftAnatomyVM(
  draft: AdoptDraft,
  skillReqs: { name: string; allowedTools?: string[] }[],
): AnatomyVM {
  const role = draft.role;
  const toolsSummary = countGrants(role.tools);
  const skills = (role.skills ?? []).map((name) => {
    const req = skillReqs.find((s) => s.name === name);
    const gap = skillNeedsGrant(req?.allowedTools, role.tools);
    return { name, allowedTools: req?.allowedTools, gap };
  });
  // Known skills NOT currently attached, for the "+ Add skill" picker.
  const attached = new Set(role.skills ?? []);
  const availableSkills = skillReqs
    .filter((s) => !attached.has(s.name))
    .map((s) => ({ name: s.name, ...(s.allowedTools !== undefined ? { allowedTools: s.allowedTools } : {}) }));
  return {
    roleName: role.name,
    instructions: role.instructions,
    engineId: role.engine.id,
    model: role.engine.model,
    autonomy: role.autonomy,
    soulName: role.soul,
    soulBody: "", // adopt draft has no soul yet
    tools: role.tools,
    toolsSummary,
    skills,
    availableSkills,
  };
}
