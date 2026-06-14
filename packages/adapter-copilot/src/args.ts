import type { Role, Task, Workspace } from "@maestro/core";

/**
 * Build the `copilot` argv for an unattended, worktree-scoped run.
 * v1 always uses `--allow-all` (safe because each agent is isolated in its own
 * worktree) and `--no-ask-user`. Fine-grained per-tool approval is a later
 * ACP-mode upgrade.
 */
export function buildArgs(task: Task, workspace: Workspace, role: Role): string[] {
  const args = ["-C", workspace.path, "-p", task.description, "-s", "--no-ask-user", "--allow-all"];
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
