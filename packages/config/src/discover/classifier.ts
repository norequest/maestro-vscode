import type { Confidence, SourceKind } from "./types.js";

/**
 * Classify a source kind into a confidence tier.
 *
 * - verified: claude-agent, hallucinate-role, copilot-agent, copilot-chatmode, plugin-agent
 * - likely:   prompt, claude-skill, continue-agent, cursor-rule, plugin-skill
 * - instructions: instructions
 *
 * The switch is EXHAUSTIVE: adding a new SourceKind without handling it here
 * produces a TypeScript compile error (unreachable default branch guard).
 */
export function classify(kind: SourceKind): Confidence {
  switch (kind) {
    case "claude-agent":
      return "verified";
    case "hallucinate-role":
      return "verified";
    case "copilot-agent":
      return "verified";
    case "copilot-chatmode":
      return "verified";
    case "plugin-agent":
      return "verified";

    case "prompt":
      return "likely";
    case "claude-skill":
      return "likely";
    case "continue-agent":
      return "likely";
    case "cursor-rule":
      return "likely";
    case "plugin-skill":
      return "likely";

    case "instructions":
      return "instructions";

    default: {
      // Exhaustiveness guard: if a new SourceKind is added and not handled above,
      // TypeScript will flag this as an unreachable assignment.
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}
