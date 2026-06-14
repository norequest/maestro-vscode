import type { Role, Task, Workspace } from "@maestro/core";

/**
 * The wire format Copilot is asked to stream on stdout.
 * - `"text"` (default): human-readable plain text, the unchanged v1 behavior.
 * - `"json"`: opt-in newline-delimited JSON via `--output-format json`, parsed
 *   into structured output events by {@link CopilotSession}.
 */
export type OutputFormat = "text" | "json";

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
  const args = ["-C", workspace.path, "-p", task.description, "-s", "--no-ask-user", "--allow-all"];
  if (outputFormat === "json") {
    args.push("--output-format", "json");
  }
  if (role.engine.model) {
    args.push("--model", role.engine.model);
  }
  return args;
}

const SPINNER = /[⠀-⣿]/g; // animated Braille spinner glyphs

/** Remove animated spinner glyphs from a streamed stdout chunk; keep the rest. */
export function cleanOutput(text: string): string {
  return text.replace(SPINNER, "");
}
