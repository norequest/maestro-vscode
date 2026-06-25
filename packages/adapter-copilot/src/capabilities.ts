import type { Capabilities } from "@maestro/core";
import type { OutputFormat } from "./args.js";

/**
 * The DEFAULT (text-mode) capabilities. This object is the shared baseline the
 * conformance suite asserts against; it MUST keep `structuredEvents: false`.
 */
export const COPILOT_CAPABILITIES: Capabilities = {
  streaming: true,
  structuredEvents: false,
  approvals: false,
  steerable: false,
};

/**
 * Per-instance capabilities for a given output mode. Returns a fresh object so
 * the shared {@link COPILOT_CAPABILITIES} is never mutated.
 *
 * Only `structuredEvents` differs by mode: `json` and `fleet` parse the CLI's
 * structured stream into formatted events, so they advertise `true`. `approvals`
 * stays `false` in every mode because `copilot -p` is headless and autonomous
 * (`--allow-all --no-ask-user`); there is no approval handshake to honor.
 */
export function capabilitiesFor(outputFormat: OutputFormat): Capabilities {
  return {
    streaming: true,
    structuredEvents: outputFormat === "json" || outputFormat === "fleet",
    approvals: false,
    steerable: false,
  };
}
