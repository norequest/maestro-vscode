import type { Role, Team } from "@maestro/core";
import type { WebviewToHost } from "./protocol.js";

export const ENGINE_FAMILIES: ReadonlyArray<{ id: string; label: string; models: readonly string[] }> = [
  { id: "copilot", label: "Copilot", models: ["claude-sonnet-4.5", "gpt-5", "o3"] },
  { id: "acp", label: "ACP", models: ["gemini", "claude-sonnet-4.5"] },
];

export interface PresetChip {
  roleName: string;
  engineId: string;
  model?: string;
  instructionsSnippet: string;
}

export interface TeamRow {
  name: string;
  roleCount: number;
}

export interface ComposerOptions {
  presets: PresetChip[];
  teams: TeamRow[];
  engines: typeof ENGINE_FAMILIES;
}

export interface DispatchForm {
  roleName?: string;
  newRoleName?: string;
  engineId?: string;
  model?: string;
  goal?: string;
  description: string;
}

const SNIPPET_CAP = 120;

function snippet(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > SNIPPET_CAP ? `${oneLine.slice(0, SNIPPET_CAP - 1)}…` : oneLine;
}

export function composerOptions(roles: readonly Role[], teams: readonly Team[]): ComposerOptions {
  return {
    presets: roles.map((r) => ({
      roleName: r.name,
      engineId: r.engine.id,
      ...(r.engine.model !== undefined ? { model: r.engine.model } : {}),
      instructionsSnippet: snippet(r.instructions),
    })),
    teams: teams.map((t) => ({ name: t.name, roleCount: t.roles.length })),
    engines: ENGINE_FAMILIES,
  };
}

export function canDispatch(form: DispatchForm): boolean {
  const hasRole =
    (typeof form.roleName === "string" && form.roleName.trim() !== "") ||
    (typeof form.newRoleName === "string" && form.newRoleName.trim() !== "");
  return hasRole && form.description.trim() !== "";
}

export function buildDispatchMessage(
  form: DispatchForm,
): Extract<WebviewToHost, { type: "dispatch" }> | null {
  if (!canDispatch(form)) return null;
  const put = (v: string | undefined): string | undefined => {
    const t = v?.trim();
    return t ? t : undefined;
  };
  return {
    type: "dispatch",
    ...(put(form.roleName) ? { roleName: put(form.roleName) } : {}),
    ...(put(form.newRoleName) ? { newRoleName: put(form.newRoleName) } : {}),
    ...(put(form.engineId) ? { engineId: put(form.engineId) } : {}),
    ...(put(form.model) ? { model: put(form.model) } : {}),
    ...(put(form.goal) ? { goal: put(form.goal) } : {}),
    description: form.description.trim(),
  };
}
