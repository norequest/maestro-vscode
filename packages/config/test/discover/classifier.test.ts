import { describe, it, expect } from "vitest";
import { classify } from "../../src/discover/classifier.js";
import type { SourceKind } from "../../src/discover/types.js";

describe("classify", () => {
  it("returns verified for claude-agent", () => {
    expect(classify("claude-agent")).toBe("verified");
  });

  it("returns verified for hallucinate-role", () => {
    expect(classify("hallucinate-role")).toBe("verified");
  });

  it("returns verified for copilot-agent", () => {
    expect(classify("copilot-agent")).toBe("verified");
  });

  it("returns verified for copilot-chatmode", () => {
    expect(classify("copilot-chatmode")).toBe("verified");
  });

  it("returns verified for plugin-agent", () => {
    expect(classify("plugin-agent")).toBe("verified");
  });

  it("returns likely for prompt", () => {
    expect(classify("prompt")).toBe("likely");
  });

  it("returns likely for claude-skill", () => {
    expect(classify("claude-skill")).toBe("likely");
  });

  it("returns likely for continue-agent", () => {
    expect(classify("continue-agent")).toBe("likely");
  });

  it("returns likely for cursor-rule", () => {
    expect(classify("cursor-rule")).toBe("likely");
  });

  it("returns likely for plugin-skill", () => {
    expect(classify("plugin-skill")).toBe("likely");
  });

  it("returns instructions for instructions", () => {
    expect(classify("instructions")).toBe("instructions");
  });

  it("verified is ONLY returned for the five HIGH kinds", () => {
    const allKinds: SourceKind[] = [
      "claude-agent",
      "hallucinate-role",
      "copilot-agent",
      "copilot-chatmode",
      "plugin-agent",
      "prompt",
      "claude-skill",
      "continue-agent",
      "cursor-rule",
      "instructions",
      "plugin-skill",
    ];
    const verifiedKinds = allKinds.filter((k) => classify(k) === "verified");
    expect(verifiedKinds.sort()).toEqual(
      ["claude-agent", "hallucinate-role", "copilot-agent", "copilot-chatmode", "plugin-agent"].sort(),
    );
  });
});
