import type { Role } from "@hallucinate/core";

/**
 * MINIMAL P3 append. P4 replaces this with the full Soul/Instructions/Tools/Skills/Task
 * preamble assembled in the adapters (R3). Do not duplicate: P4 imports this resolver
 * and deletes the extension prepend.
 *
 * Resolves `role.skills` entries to their procedure bodies and returns a markdown
 * preamble string. Returns an empty string when the role has no skills or all
 * skill names are dangling (not found in the bodies map).
 *
 * @param role  - The role being spawned.
 * @param bodies - Map from skill name to body text, as returned by loadSkills().
 */
export function composeSkillPreamble(role: Role, bodies: Map<string, string>): string {
  const skills = role.skills;
  if (!skills || skills.length === 0) {
    return "";
  }

  const sections: string[] = [];
  for (const name of skills) {
    const body = bodies.get(name);
    if (body === undefined) {
      // Dangling reference: the skill was declared but no SKILL.md was loaded.
      // Skip silently; a warning was already emitted by loadSkills.
      continue;
    }
    sections.push(`### ${name}\n\n${body}`);
  }

  if (sections.length === 0) {
    return "";
  }

  return `## Skills\n\n${sections.join("\n\n")}`;
}

/**
 * MINIMAL P3 append. P4 replaces this with the full Soul/Instructions/Tools/Skills/Task
 * preamble assembled in the adapters (R3). Do not duplicate: P4 imports this resolver
 * and deletes the extension prepend.
 *
 * Prepends the skill preamble to the task description. Returns the task
 * unchanged when the preamble is empty (no skills or all dangling).
 *
 * @param role  - The role being spawned.
 * @param bodies - Map from skill name to body text, as returned by loadSkills().
 * @param task  - The verbatim task description to dispatch.
 */
export function composeSpawnDescription(
  role: Role,
  bodies: Map<string, string>,
  task: string,
): string {
  const preamble = composeSkillPreamble(role, bodies);
  if (preamble === "") {
    return task;
  }
  return `${preamble}\n\n${task}`;
}
