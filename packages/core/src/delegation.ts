import type { Role, Team } from "./types.js";

/** A teammate the lead asked to bring in, parsed from a ```delegate block. */
export interface DelegateDirective {
  role: string;
  task: string;
}

/**
 * The fence keyword the lead uses to delegate. Kept here, next to the parser and
 * the brief that teaches the format, so the three can never drift apart.
 */
export const DELEGATE_FENCE = "delegate";

const FENCE_RE = /```delegate[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*```/g;

/**
 * Parse every COMPLETE ```delegate ... ``` block from accumulated lead output.
 * Each block body is YAML-ish: a `role:` line and a `task:` line whose value may
 * span the rest of the block. An incomplete trailing block (no closing fence) is
 * ignored, so scanning a growing stream only yields a directive once its block
 * closes. Blocks missing role or task are skipped.
 */
export function parseDelegateDirectives(text: string): DelegateDirective[] {
  const out: DelegateDirective[] = [];
  // exec with a /g regex walks each match; reset lastIndex defensively in case a
  // shared instance ever leaks (it does not here, but cheap insurance).
  FENCE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FENCE_RE.exec(text)) !== null) {
    const body = match[1] ?? "";
    let role: string | undefined;
    const taskLines: string[] = [];
    let inTask = false;
    for (const line of body.split(/\r?\n/)) {
      if (!inTask) {
        const roleM = /^[ \t]*role:[ \t]*(.*)$/.exec(line);
        if (roleM && role === undefined) {
          role = roleM[1]!.trim();
          continue;
        }
        const taskM = /^[ \t]*task:[ \t]*(.*)$/.exec(line);
        if (taskM) {
          inTask = true;
          taskLines.push(taskM[1]!);
          continue;
        }
        continue;
      }
      taskLines.push(line);
    }
    const task = taskLines.join("\n").trim();
    if (role && task) out.push({ role, task });
  }
  return out;
}

function specialty(instructions: string): string {
  const firstLine = instructions.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0) ?? "";
  return firstLine.length > 140 ? `${firstLine.slice(0, 137)}...` : firstLine;
}

/**
 * Build the instructions prefix injected into the lead (the default agent)
 * at launch. It names the specialists the lead can load as
 * sub-agents and teaches the exact delegation format the orchestrator parses.
 *
 * Only the dynamic roster and the parseable ```delegate fence live here in code,
 * because the orchestrator's parser depends on the fence staying exact: a config
 * edit must never be able to break it. The "how to delegate" prose lives in the
 * delegation-playbook skill (applied via the config defaults.leadSkills layer),
 * so it is not duplicated here. No em dashes, by house style.
 */
export function buildLeadBrief(team: Team, lead: Role): string {
  const teammates = team.roles.filter((r) => r.name !== lead.name);
  const roster = teammates.length
    ? teammates.map((r) => `- ${r.name}: ${specialty(r.instructions)}`).join("\n")
    : "(no specialists are available, so complete the task yourself)";
  return [
    `You are the default agent. You received one task. You can load these specialists as sub-agents to help, or just do the task yourself.`,
    ``,
    `First decide what the task actually needs. If it is small, just do it yourself and finish. Do not pull in specialists you do not need.`,
    ``,
    `Specialists you can load as sub-agents:`,
    roster,
    ``,
    `To load a specialist, emit a fenced block exactly like this (the lead approves each one before it starts):`,
    "```" + DELEGATE_FENCE,
    `role: <one specialist name from the list above>`,
    `task: <a self-contained subtask for them>`,
    "```",
    ``,
    `Use only the exact role names listed above. A block naming yourself or an unknown role is ignored. Follow your delegation playbook for how to split the work.`,
  ].join("\n");
}
