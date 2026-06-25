import { describe, expect, it } from "vitest";
import { countGrants } from "@maestro/core";
import type { ToolGrant } from "@maestro/core";
import { renderAnatomyCanvas } from "../src/anatomy-render.js";
import type { AnatomyVM } from "../src/anatomy-protocol.js";

function vmWithTools(tools: ToolGrant): AnatomyVM {
  return {
    roleName: "Implementer",
    instructions: "do the thing",
    engineId: "copilot",
    autonomy: "auto-approve-safe",
    soulBody: "",
    tools,
    toolsSummary: countGrants(tools),
    skills: [],
    availableSkills: [],
  };
}

/** Extract the inner markup of the tool row for a given tool name. */
function rowFor(html: string, tool: string): string {
  const start = html.indexOf(`data-tool="${tool}"`);
  expect(start, `row for ${tool} should exist`).toBeGreaterThan(-1);
  return html.slice(start, start + 320);
}

describe("renderAnatomyCanvas — built-in tool rows", () => {
  const html = renderAnatomyCanvas(vmWithTools({ builtins: { read: ["Read"], write: ["Edit"] } }));

  it("renders a READ toggle (not write) for read-only built-ins", () => {
    const read = rowFor(html, "Read");
    expect(read).toContain('class="anatomy-tool-read-input"');
    expect(read).not.toContain("anatomy-tool-write-input");
  });

  it("renders a WRITE toggle (never a read toggle) for write-only built-ins", () => {
    // The bug: Edit/Run/Git used to get a read toggle, so toggling it wrote
    // "Edit" into `read`, which the config validator rejects.
    for (const tool of ["Edit", "Run", "Git"]) {
      const row = rowFor(html, tool);
      expect(row, `${tool} must offer a write input`).toContain('class="anatomy-tool-write-input"');
      expect(row, `${tool} must NOT offer a read input`).not.toContain("anatomy-tool-read-input");
    }
  });
});
