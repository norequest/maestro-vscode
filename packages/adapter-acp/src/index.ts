export const MAESTRO_ADAPTER_ACP_VERSION = "0.0.0";

export { AcpAdapter } from "./adapter.js";
export type { AcpAdapterOptions } from "./adapter.js";
export { ACP_CAPABILITIES } from "./capabilities.js";
export { AcpSession } from "./session.js";
export type { AcpSessionOptions } from "./session.js";
export { ProcessAcpTransport, defaultAcpTransportFn } from "./transport.js";
export type { AcpChildHandle } from "./transport.js";
export type { AcpMessage, AcpApprovalDetail, AcpTransport, AcpTransportFn, AcpPermissionMode } from "./types.js";
export { autonomyToPermissionMode } from "./types.js";
export { parseAcpLine, buildInitialize, buildPermissionResponse, buildUserTurn } from "./messages.js";
