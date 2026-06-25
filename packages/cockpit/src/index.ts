export const MAESTRO_COCKPIT_VERSION = "0.0.0";

export type { CardVM, CockpitState, DelegationVM, HostToWebview, WebviewToHost, Lane } from "./protocol.js";
export { isWebviewMessage } from "./protocol.js";
export { laneFor } from "./lane.js";
export { initialModel, reduce, setFocus, OUTPUT_CAP } from "./reducer.js";
export type { CockpitModel } from "./reducer.js";
export { selectState } from "./select.js";
export { composerOptions, buildDispatchMessage, canDispatch, ENGINE_FAMILIES } from "./composer.js";
export type { ComposerOptions, PresetChip, TeamRow, DispatchForm } from "./composer.js";
