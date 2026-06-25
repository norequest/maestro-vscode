import type { Role, Task, Workspace } from "@hallucinate/core";
import { composePreamble, renderToolsForPreamble } from "@hallucinate/core";

/**
 * The wire format Copilot is asked to stream on stdout.
 * - `"text"` (default): human-readable plain text, the unchanged v1 behavior.
 * - `"json"`: opt-in newline-delimited JSON via `--output-format json`, parsed
 *   into structured output events by {@link CopilotSession}.
 * - `"fleet"`: the JSONL stream of a single-session `/fleet` lead run,
 *   parsed into sub-agent lifecycle events (plus output/done/error) by
 *   {@link CopilotSession}. The wire flag is still `--output-format json`; this
 *   value only selects the fleet-aware line parser.
 */
export type OutputFormat = "text" | "json" | "fleet";

/**
 * Build the `copilot` argv for an unattended, worktree-scoped run.
 * v1 always uses `--allow-all` (safe because each agent is isolated in its own
 * worktree) and `--no-ask-user`. Fine-grained per-tool approval is a later
 * ACP-mode upgrade.
 *
 * @param outputFormat - defaults to `"text"`. `--output-format json` is appended
 *   ONLY when this is `"json"`, so the default run is byte-for-byte unchanged.
 */
export function buildArgs(
  task: Task,
  workspace: Workspace,
  role: Role,
  outputFormat: OutputFormat = "text",
): string[] {
  const preamble = composePreamble({
    soul: task.soulDoc,
    instructions: role.instructions,
    tools: renderToolsForPreamble(role.tools),
    skills: task.skills,
    task: task.description,
  });
  const args = ["-C", workspace.path, "-p", preamble, "-s", "--no-ask-user", "--allow-all"];
  if (outputFormat === "json") {
    args.push("--output-format", "json");
  }
  if (role.engine.model) {
    args.push("--model", role.engine.model);
  }
  return args;
}

/**
 * The text sent via `-p` in native custom-agent mode: just the task (and its
 * goal, if any). The persona now lives in the `.agent.md` the adapter
 * materialized, so it must NOT be repeated here.
 */
export function buildTaskPrompt(task: Task): string {
  const goal = task.goal?.trim();
  const description = task.description.trim();
  return goal ? `${description}\n\nGoal: ${goal}` : description;
}

/**
 * Build the `copilot` argv in native custom-agent mode: select the materialized
 * agent with `--agent <slug>` and pass only the task via `-p`. Mirrors
 * {@link buildArgs} for the shared unattended flags (`-s --no-ask-user
 * --allow-all`, optional `--output-format json` and `--model`).
 */
export function buildAgentArgs(
  task: Task,
  workspace: Workspace,
  role: Role,
  agentSlug: string,
  outputFormat: OutputFormat = "text",
): string[] {
  const args = [
    "-C",
    workspace.path,
    "--agent",
    agentSlug,
    "-p",
    buildTaskPrompt(task),
    "-s",
    "--no-ask-user",
    "--allow-all",
  ];
  if (outputFormat === "json") {
    args.push("--output-format", "json");
  }
  if (role.engine.model) {
    args.push("--model", role.engine.model);
  }
  return args;
}

/**
 * Build the `copilot` argv for FLEET single-session mode: spawn ONE lead
 * session that runs named custom agents as in-session sub-agents and streams
 * their lifecycle as JSONL.
 *
 * Unlike {@link buildAgentArgs}, fleet mode:
 *   - passes `task.description` VERBATIM via `-p` (the extension supplies the
 *     leading `/fleet ...` text and the roster; the adapter must NOT prepend
 *     `/fleet` or compose any preamble),
 *   - does NOT pass `--agent`. Copilot's BUILT-IN default dispatcher owns the
 *     `task` tool that `/fleet` uses to dispatch the named specialist agents in
 *     parallel. Selecting a custom lead agent with `--agent` instead teaches
 *     the OLD ```delegate fenced-block convention (not a wired mechanism in
 *     Copilot v1.0.65), so `/fleet` never dispatches and no files are created.
 *     Dropping `--agent` was empirically verified to dispatch reliably,
 *   - always streams structured events (`--output-format json --no-color`) so
 *     the sub-agent frames are parseable, and so does NOT pass `-s` (silent),
 *     which would suppress the very stream we parse.
 *
 * Mirrors the shared unattended flags (`--no-ask-user --allow-all`, optional
 * `--model`) used elsewhere. `--allow-all` is the superset of `--allow-all-tools`.
 */
export function buildFleetArgs(task: Task, workspace: Workspace, role: Role): string[] {
  const model = role.engine.model;
  return [
    "-C",
    workspace.path,
    "-p",
    task.description,
    "--no-ask-user",
    "--allow-all",
    "--output-format",
    "json",
    "--no-color",
    ...(model ? ["--model", model] : []),
  ];
}

const SPINNER = /[⠀-⣿]/g; // animated Braille spinner glyphs

/** Remove animated spinner glyphs from a streamed stdout chunk; keep the rest. */
export function cleanOutput(text: string): string {
  return text.replace(SPINNER, "");
}
