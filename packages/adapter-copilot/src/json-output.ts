/**
 * Tolerant renderer for Copilot's `--output-format json` stream.
 *
 * IMPORTANT: the exact JSON schema of the installed `copilot` CLI is NOT
 * confirmed. This module therefore models a small, REPRESENTATIVE schema and
 * always degrades gracefully: any line that is not valid JSON, or is valid JSON
 * of an unrecognized shape, is returned as the raw (already cleaned) text. The
 * caller still emits it as an `output` event, so the stream is never dropped and
 * this function never throws.
 *
 * Assumed representative schema (newline-delimited JSON, one object per line):
 *   - { "type": "assistant" | "text", "text": string }
 *       -> the assistant's message text, rendered verbatim.
 *   - { "type": "tool" | "tool_call", "name": string,
 *       "input"?: { "path"?: string; "command"?: string } }
 *       -> rendered as "▸ <name>: <path-or-command>" (target omitted if absent).
 *   - anything else (unknown object, array, bare value) -> raw line fallback.
 */

/** Prefix marking a rendered tool/action line in json mode. */
const TOOL_PREFIX = "▸";

/**
 * Render one complete cleaned stdout line into displayable text.
 * Returns the mapped text for a recognized JSON shape, otherwise the input line
 * unchanged (the tolerant fallback).
 */
export function renderJsonLine(line: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return line; // not JSON at all -> raw fallback
  }
  if (!isRecord(parsed)) {
    return line; // valid JSON but not an object (array, number, string, null)
  }

  const type = parsed["type"];

  if ((type === "assistant" || type === "text") && typeof parsed["text"] === "string") {
    return parsed["text"];
  }

  if (type === "tool" || type === "tool_call") {
    const name = typeof parsed["name"] === "string" ? parsed["name"] : "tool";
    const target = toolTarget(parsed["input"]);
    return target ? `${TOOL_PREFIX} ${name}: ${target}` : `${TOOL_PREFIX} ${name}`;
  }

  return line; // recognized as JSON object but not a shape we model -> raw fallback
}

/** Extract the most descriptive target from a tool's `input`, if present. */
function toolTarget(input: unknown): string | undefined {
  if (!isRecord(input)) return undefined;
  if (typeof input["path"] === "string") return input["path"];
  if (typeof input["command"] === "string") return input["command"];
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
