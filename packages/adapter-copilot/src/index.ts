export const MAESTRO_ADAPTER_COPILOT_VERSION = "0.0.0";

export { CopilotAdapter } from "./adapter.js";
export type { CopilotAdapterOptions } from "./adapter.js";
export { COPILOT_CAPABILITIES, capabilitiesFor } from "./capabilities.js";
export { resolveAuth } from "./auth.js";
export { buildArgs, cleanOutput } from "./args.js";
export type { OutputFormat } from "./args.js";
export { renderJsonLine } from "./json-output.js";
export type { CopilotSessionOptions } from "./copilot-session.js";
export type { ChildHandle, SpawnFn } from "./types.js";
