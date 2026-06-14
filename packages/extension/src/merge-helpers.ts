/** Pure helpers for M9 merge UX. No vscode import, so unit-testable under Vitest. */

export function buildConflictResolveMessage(files: readonly string[]): string {
  const list = files.map((f) => `  - ${f}`).join("\n");
  return `Maestro: resolve the conflicts in:\n${list}\nThen click "Finish Merge" on the card.`;
}

export function buildPrTitle(roleName: string, taskDescription: string): string {
  const truncated = taskDescription.length > 60 ? `${taskDescription.slice(0, 60)}...` : taskDescription;
  return `[Maestro/${roleName}] ${truncated}`;
}

export function buildPrBody(summary: string | undefined, diffFiles: readonly string[]): string {
  const fileList = diffFiles.length > 0 ? `\n\n**Changed files:**\n${diffFiles.map((f) => `- ${f}`).join("\n")}` : "";
  return `${summary ?? "No summary provided."}${fileList}\n\n_Created by Maestro._`;
}
