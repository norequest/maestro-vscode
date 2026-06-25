import { describe, it, expect } from "vitest";
import { parseSoul, serializeSoul, loadSoul } from "../src/souls.js";
import type { FsReader } from "../src/loader.js";

const FIXTURE_MD = `## Identity
I am a code reviewer who ensures quality and correctness.

## Principles
- Be thorough
- Be concise

## Voice
Direct and respectful.

## Priorities
1. Correctness first
2. Clarity second

## Red lines
Never approve code that breaks security invariants.

## Notes
This is an extra unknown section.
`;

describe("parseSoul", () => {
  it("extracts identity from ## Identity header", () => {
    const soul = parseSoul(FIXTURE_MD);
    expect(soul.identity).toContain("I am a code reviewer");
  });

  it("extracts redLines from ## Red lines header (case-insensitive)", () => {
    const soul = parseSoul(FIXTURE_MD);
    expect(soul.redLines).toContain("Never approve code that breaks security invariants");
  });

  it("sets raw to the full input", () => {
    const soul = parseSoul(FIXTURE_MD);
    expect(soul.raw).toBe(FIXTURE_MD);
  });

  it("keeps unknown headers in raw (not lost)", () => {
    const soul = parseSoul(FIXTURE_MD);
    // raw must contain the unknown section
    expect(soul.raw).toContain("## Notes");
  });

  it("returns undefined for missing sections", () => {
    const minimal = `## Identity\nHello\n`;
    const soul = parseSoul(minimal);
    expect(soul.redLines).toBeUndefined();
    expect(soul.voice).toBeUndefined();
  });
});

describe("serializeSoul + round-trip", () => {
  it("round-trips identity and redLines through serialize then parse", () => {
    const original = parseSoul(FIXTURE_MD);
    const serialized = serializeSoul(original);
    const reparsed = parseSoul(serialized);
    expect(reparsed.identity?.trim()).toBe(original.identity?.trim());
    expect(reparsed.redLines?.trim()).toBe(original.redLines?.trim());
  });

  it("omits sections that are undefined", () => {
    const minimal = parseSoul(`## Identity\nHello\n`);
    const serialized = serializeSoul(minimal);
    expect(serialized).not.toContain("## Red lines");
    expect(serialized).not.toContain("## Voice");
  });
});

describe("loadSoul", () => {
  it("returns error object (not a throw) when file is missing", async () => {
    const fakeFs: FsReader = {
      async readFile() { throw new Error("File not found"); },
      async listFiles() { return []; },
      async listDirs() { return []; },
      async exists() { return false; },
    };

    const result = await loadSoul("/repo", "reviewer", fakeFs);
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toBeTruthy();
      expect(result.source).toContain("reviewer");
    }
  });

  it("returns a SoulDoc when the file exists", async () => {
    const fakeFs: FsReader = {
      async readFile(p: string) {
        if (p.endsWith("reviewer.md")) return FIXTURE_MD;
        throw new Error("File not found");
      },
      async listFiles() { return []; },
      async listDirs() { return []; },
      async exists() { return true; },
    };

    const result = await loadSoul("/repo", "reviewer", fakeFs);
    expect("soul" in result).toBe(true);
    if ("soul" in result) {
      expect(result.soul.identity).toContain("I am a code reviewer");
    }
  });
});
