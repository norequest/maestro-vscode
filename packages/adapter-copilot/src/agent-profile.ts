import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Role, Task, ToolGrant } from "@maestro/core";
import { composePreamble } from "@maestro/core";

/**
 * Translate a Maestro Role into a GitHub Copilot CLI "custom agent" file
 * (`<slug>.agent.md`) and place it where `copilot --agent <slug>` will find it.
 *
 * Why this module exists: without it the adapter flattens the entire persona
 * (soul + instructions + tools) into a single `-p "<text>"` prompt, so Copilot
 * receives a wall of text and has NO concept that a named custom agent exists.
 * Materializing a real `.agent.md` makes Copilot treat the role as a first-class
 * custom agent (named, selectable, tool-scoped); the `-p` prompt then carries
 * only the task. We materialize into the agent's own WORKTREE at
 * ".github/agents/<slug>.agent.md", which Copilot reads (repo-level), invoked with
 * `--agent <slug>`. We NEVER write the global "~/.copilot/agents/" location, which
 * would pollute the user's config and shadow repo-local agents.
 */

/** Map a role name to a Copilot agent slug: lowercase, hyphen-joined, [a-z0-9-]. */
export function slugForRole(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "maestro-agent";
}

/**
 * Map Maestro's granular ToolGrant onto Copilot's tool vocabulary
 * (read | search | edit | execute). Returns undefined when no grants are
 * declared, so the frontmatter omits `tools` and Copilot grants all tools (its
 * default). A read-only role maps to just read/search; Run and Git both map to
 * execute (shell).
 */
export function mapToolsToCopilot(tools?: ToolGrant): string[] | undefined {
  if (!tools) return undefined;
  const read = tools.builtins?.read ?? [];
  const write = tools.builtins?.write ?? [];
  const present = new Set<string>();
  if (read.includes("Read")) present.add("read");
  if (read.includes("Search")) present.add("search");
  if (write.includes("Edit")) present.add("edit");
  if (write.includes("Run") || write.includes("Git")) present.add("execute");
  const ordered = ["read", "search", "edit", "execute"].filter((t) => present.has(t));
  return ordered.length ? ordered : undefined;
}

/** Double-quote a YAML scalar, escaping backslashes then quotes. */
function yamlQuote(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** A one-line description from the role's instructions (first sentence), capped.
 *  `description` is required by Copilot, so this never returns empty. */
function deriveDescription(role: Role): string {
  const firstLine = role.instructions.split(/\n/)[0]?.trim() ?? "";
  const firstSentence = firstLine.split(/(?<=[.!?])\s/)[0]?.trim() ?? firstLine;
  const text = (firstSentence || firstLine).trim();
  if (!text) return `Maestro agent ${role.name}`;
  return text.length > 160 ? `${text.slice(0, 159)}…` : text;
}

/**
 * Build the full `<slug>.agent.md` content: YAML frontmatter (name, description,
 * optional tools) followed by the persona body (soul + instructions + skills),
 * MINUS the task. The task is delivered separately via `-p`, so the same agent
 * file is reusable across dispatches.
 */
export function buildAgentProfile(role: Role, task: Task): string {
  const slug = slugForRole(role.name);
  const tools = mapToolsToCopilot(role.tools);

  const fm: string[] = ["---", `name: ${slug}`, `description: ${yamlQuote(deriveDescription(role))}`];
  if (tools) fm.push(`tools: [${tools.map((t) => yamlQuote(t)).join(", ")}]`);
  fm.push("---");

  // Persona minus task: reuse the canonical composer with an empty task so the
  // "# Task" block is omitted. Tools live in the frontmatter (the real gate), so
  // they are intentionally NOT duplicated into the body.
  const body = composePreamble({
    ...(task.soulDoc ? { soul: task.soulDoc } : {}),
    instructions: role.instructions,
    ...(task.skills && task.skills.length ? { skills: task.skills } : {}),
    task: "",
  });

  return `${fm.join("\n")}\n\n${body}\n`;
}

/** Injectable fs seam so materialization is unit-testable without touching disk. */
export interface AgentProfileWriter {
  /** True when a committed repo-level agent file already exists in the worktree. */
  repoAgentExists(worktreePath: string, slug: string): boolean;
  /**
   * Write (overwrite) the agent file INTO the worktree at
   * `<worktreePath>/.github/agents/<slug>.agent.md`. Never global.
   */
  writeWorktreeAgent(worktreePath: string, slug: string, content: string): void;
}

/**
 * Ensure a Copilot custom agent exists for this role and return its slug.
 *
 * The mix: if the worktree already carries a `.github/agents/<slug>.agent.md`
 * (already present, e.g. materialized by the orchestrator's writeAgentProfiles
 * hook or committed in the repo), use it as-is, with NO write. Otherwise
 * materialize the role into the worktree at
 * `<worktreePath>/.github/agents/<slug>.agent.md`. We NEVER write the global
 * `~/.copilot/agents/` location, which would pollute the user's config and
 * shadow repo-local agents.
 */
export function ensureCopilotAgent(
  writer: AgentProfileWriter,
  worktreePath: string,
  role: Role,
  task: Task,
): string {
  const slug = slugForRole(role.name);
  if (writer.repoAgentExists(worktreePath, slug)) return slug;
  writer.writeWorktreeAgent(worktreePath, slug, buildAgentProfile(role, task));
  return slug;
}

/** Real fs writer: checks the worktree for an existing agent, else writes into it. */
export const nodeAgentProfileWriter: AgentProfileWriter = {
  repoAgentExists(worktreePath, slug) {
    return existsSync(join(worktreePath, ".github", "agents", `${slug}.agent.md`));
  },
  writeWorktreeAgent(worktreePath, slug, content) {
    const dir = join(worktreePath, ".github", "agents");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${slug}.agent.md`), content, "utf8");
  },
};

/**
 * Write a repo-level Copilot agent at `<repoRoot>/.github/agents/<slug>.agent.md`.
 * This is the location the VS Code Copilot Chat picker (and the CLI) read, so
 * writing here at create/save time makes a Maestro agent visible in Copilot
 * without a dispatch. Returns whether the file was newly created (vs overwritten)
 * so the caller can show the "reload window" hint only once.
 */
export function writeRepoAgentFile(repoRoot: string, slug: string, content: string): { created: boolean } {
  const dir = join(repoRoot, ".github", "agents");
  const file = join(dir, `${slug}.agent.md`);
  const created = !existsSync(file);
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, content, "utf8");
  return { created };
}
