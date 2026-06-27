import { describe, expect, it } from "vitest";
import { teamHue } from "../src/crest.js";

// Mirror of the source palette. If the source palette changes, the membership
// assertion below FAILS, forcing a deliberate review of the new colors against
// the status bands.
const EXPECTED_PALETTE = [268, 288, 332, 256, 305, 320, 278, 296];

// The status accents the Floor already uses (blue/green/amber/red). A team
// identity hue must never land in any of these, or it would read as a status.
const STATUS_BANDS: ReadonlyArray<readonly [number, number]> = [
  [200, 230], // blue
  [135, 175], // green
  [30, 55], // amber
  [345, 360], // red (upper wrap)
  [0, 15], // red (lower wrap)
];

const inBand = (h: number): boolean => STATUS_BANDS.some(([lo, hi]) => h >= lo && h <= hi);

describe("teamHue (M10 team-identity crest)", () => {
  it("is deterministic: the same id yields the same hue across calls", () => {
    expect(teamHue("lead")).toBe(teamHue("lead"));
    expect(teamHue("alpha")).toBe(teamHue("alpha"));
    // Repeated calls in a row stay stable (no hidden state / no randomness).
    const first = teamHue("some-lead-id");
    for (let i = 0; i < 5; i++) expect(teamHue("some-lead-id")).toBe(first);
  });

  it("can produce different hues for different ids", () => {
    const ids = Array.from({ length: 50 }, (_, i) => `lead-${i}`);
    const distinct = new Set(ids.map(teamHue));
    expect(distinct.size).toBeGreaterThan(1);
  });

  it("every returned hue is a member of the palette and within 0-359", () => {
    const ids = Array.from({ length: 200 }, (_, i) => `team-${i}-xyz`);
    for (const id of ids) {
      const h = teamHue(id);
      expect(EXPECTED_PALETTE).toContain(h);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(359);
    }
  });

  it("the palette avoids every status band (a colliding palette edit fails here)", () => {
    for (const h of EXPECTED_PALETTE) {
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(359);
      expect(inBand(h)).toBe(false);
    }
  });
});
