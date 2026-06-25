import { parse as parseYaml } from "yaml";
import type { ValidationResult, ValidationWarning } from "./types.js";
import type { SkillManifest } from "./skill-types.js";

/** Matches ASCII control characters (\x00-\x1f). */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x1f]/;

/**
 * Guards a skill name against values that could be interpreted as CLI flags
 * or smuggle control characters downstream. Mirrors the role name guards in
 * validator.ts (Issue 29 / S4).
 */
function validateSkillName(name: string): string[] {
  const errors: string[] = [];
  if (name.trim() === "") {
    errors.push("skill name must be a non-empty string");
  } else {
    if (name.startsWith("-")) {
      errors.push("skill name must not start with a dash");
    }
    if (CONTROL_CHARS.test(name)) {
      errors.push("skill name must not contain control characters");
    }
  }
  return errors;
}

/** Splits the leading YAML frontmatter block from a markdown string.
 *
 * Returns null if the content does not start with a `---` fence.
 */
function splitFrontmatter(content: string): { front: string; body: string } | null {
  // Must start with --- on its own line (possibly preceded by a UTF-8 BOM).
  const bom = content.startsWith("﻿") ? 1 : 0;
  const stripped = bom ? content.slice(bom) : content;

  if (!stripped.startsWith("---")) {
    return null;
  }

  // Find the closing fence (second occurrence of --- on its own line).
  const afterOpen = stripped.slice(3);
  // Match a newline then ---, or --- right at start (for empty frontmatter).
  const closeMatch = afterOpen.match(/\n---[ \t]*(?:\n|$)/);
  if (!closeMatch || closeMatch.index === undefined) {
    return null;
  }

  const front = afterOpen.slice(0, closeMatch.index);
  const body = afterOpen.slice(closeMatch.index + closeMatch[0].length);
  return { front, body };
}

/**
 * Parses a SKILL.md string into a validated manifest and the body text.
 *
 * @param content  - Full text of the SKILL.md file.
 * @param sourceFile - The relative path used for error messages.
 * @returns `{ manifest: ValidationResult<SkillManifest>; body: string }`
 *
 * The body is the markdown content after the frontmatter fence,
 * trimmed of leading/trailing blank lines.
 */
export function parseSkillMarkdown(
  content: string,
  sourceFile: string,
): { manifest: ValidationResult<SkillManifest>; body: string } {
  const warnings: ValidationWarning[] = [];

  const split = splitFrontmatter(content);
  if (split === null) {
    return {
      manifest: {
        ok: false,
        errors: [
          `${sourceFile}: SKILL.md must begin with a YAML frontmatter block enclosed by --- fences`,
        ],
        warnings,
      },
      body: "",
    };
  }

  const { front, body } = split;
  const trimmedBody = body.trim();

  let raw: unknown;
  try {
    raw = parseYaml(front);
  } catch (err) {
    return {
      manifest: {
        ok: false,
        errors: [`${sourceFile}: failed to parse YAML frontmatter: ${String(err)}`],
        warnings,
      },
      body: trimmedBody,
    };
  }

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return {
      manifest: {
        ok: false,
        errors: [`${sourceFile}: frontmatter must be a YAML object`],
        warnings,
      },
      body: trimmedBody,
    };
  }

  const rec = raw as Record<string, unknown>;
  const errors: string[] = [];

  // Validate name.
  const rawName = rec["name"];
  if (typeof rawName !== "string" || rawName.trim() === "") {
    errors.push(`${sourceFile}: skill name must be a non-empty string`);
  } else {
    const nameErrors = validateSkillName(rawName.trim());
    for (const e of nameErrors) {
      errors.push(`${sourceFile}: ${e}`);
    }
  }

  // Validate description.
  const rawDesc = rec["description"];
  if (typeof rawDesc !== "string" || rawDesc.trim() === "") {
    errors.push(`${sourceFile}: skill description must be a non-empty string`);
  }

  if (errors.length > 0) {
    return { manifest: { ok: false, errors, warnings }, body: trimmedBody };
  }

  // Coerce allowed-tools.
  let allowedTools: string[] | undefined;
  const rawTools = rec["allowed-tools"];
  if (rawTools !== undefined) {
    if (Array.isArray(rawTools)) {
      allowedTools = rawTools.filter((t): t is string => typeof t === "string");
    } else if (typeof rawTools === "string") {
      // Single string rather than array -- accept it gracefully.
      allowedTools = [rawTools];
    } else {
      warnings.push({
        field: "allowed-tools",
        message: `${sourceFile}: allowed-tools is not an array; ignoring`,
      });
    }
  }

  const manifest: SkillManifest = {
    name: (rawName as string).trim(),
    description: (rawDesc as string).trim(),
    ...(allowedTools !== undefined ? { allowedTools } : {}),
  };

  return { manifest: { ok: true, value: manifest, warnings }, body: trimmedBody };
}
