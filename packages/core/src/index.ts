export const MAESTRO_CORE_VERSION = "0.0.0";

export * from "./types.js";
export * from "./adapter.js";
export { Orchestrator } from "./orchestrator.js";
export { Emitter } from "./emitter.js";
export { EventQueue } from "./event-queue.js";
export { isTerminalState, isDiscardableState, stateNeedsAttention } from "./events.js";
export { FakeEngineAdapter, FakeSession } from "./fake-adapter.js";
export { FakeWorkspaceProvider, FakeWorkspaceManager, isWorkspaceManager } from "./workspace.js";
export type { WorkspaceProvider, WorkspaceManager } from "./workspace.js";
