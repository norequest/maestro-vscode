import type { SoulDoc } from "@hallucinate/core";
import type { FsReader } from "./loader.js";
import * as nodePath from "node:path";

/** Parse a soul markdown file into a SoulDoc. Unknown headers are kept in `raw`. */
export function parseSoul(markdown: string): SoulDoc {
  const raw = markdown;

  // Split on lines starting with "## " (level-2 headings).
  // We use a regex that captures the heading line and its content.
  const sections = new Map<string, string>();

  // Split on ## headings, keeping the heading names.
  const parts = markdown.split(/^(?=## )/m);
  for (const part of parts) {
    if (!part.trim()) continue;
    const newlineIdx = part.indexOf("\n");
    if (newlineIdx === -1) continue;
    const heading = part.slice(0, newlineIdx).replace(/^## /, "").trim();
    const body = part.slice(newlineIdx + 1);
    sections.set(heading.toLowerCase(), body.trim());
  }

  return {
    ...(sections.has("identity") ? { identity: sections.get("identity") } : {}),
    ...(sections.has("principles") ? { principles: sections.get("principles") } : {}),
    ...(sections.has("voice") ? { voice: sections.get("voice") } : {}),
    ...(sections.has("priorities") ? { priorities: sections.get("priorities") } : {}),
    // Case-insensitive: "Red lines", "Red Lines", "red lines" all map here.
    ...(sections.has("red lines") ? { redLines: sections.get("red lines") } : {}),
    raw,
  };
}

const KNOWN_SECTIONS: Array<{ key: keyof SoulDoc; heading: string }> = [
  { key: "identity", heading: "Identity" },
  { key: "principles", heading: "Principles" },
  { key: "voice", heading: "Voice" },
  { key: "priorities", heading: "Priorities" },
  { key: "redLines", heading: "Red lines" },
];

/** Serialize a SoulDoc back to canonical markdown with five known sections in order. */
export function serializeSoul(soul: SoulDoc): string {
  const parts: string[] = [];
  for (const { key, heading } of KNOWN_SECTIONS) {
    const value = soul[key];
    if (key === "raw") continue;
    if (typeof value === "string" && value.trim() !== "") {
      parts.push(`## ${heading}\n${value.trim()}\n`);
    }
  }
  return parts.join("\n");
}

export type LoadSoulResult =
  | { soul: SoulDoc; source: string }
  | { error: string; source: string };

/**
 * Load a soul from `.hallucinate/souls/<soulName>.md` via the injected FsReader.
 * Never throws; returns an error object when the file is missing.
 */
export async function loadSoul(
  workspaceRoot: string,
  soulName: string,
  fs: FsReader,
): Promise<LoadSoulResult> {
  const soulPath = nodePath.join(workspaceRoot, ".hallucinate", "souls", `${soulName}.md`);
  const source = nodePath.join(".hallucinate", "souls", `${soulName}.md`);

  try {
    const markdown = await fs.readFile(soulPath);
    const soul = parseSoul(markdown);
    return { soul, source };
  } catch (err) {
    return { error: `Failed to load soul "${soulName}": ${String(err)}`, source };
  }
}
