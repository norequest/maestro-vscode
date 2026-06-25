import { describe, expect, it } from "vitest";
import { renderAnatomyRail, renderAnatomyCanvas, renderGrantGate } from "../src/anatomy-render.js";
import type { AnatomyVM } from "../src/anatomy-protocol.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function baseVM(overrides?: Partial<AnatomyVM>): AnatomyVM {
  return {
    roleName: "Tester",
    instructions: "Run all tests before merging.",
    engineId: "copilot",
    autonomy: "manual",
    soulBody: "",
    toolsSummary: { granted: 0, canWrite: 0 },
    skills: [],
    availableSkills: [],
    ...overrides,
  };
}

// ─── renderAnatomyRail ────────────────────────────────────────────────────────

describe("renderAnatomyRail", () => {
  it("renders all 7 section rows", () => {
    const html = renderAnatomyRail(baseVM());
    const sections = ["identity", "soul", "instructions", "tools", "skills", "engine", "autonomy"];
    for (const s of sections) {
      expect(html).toContain(`data-section="${s}"`);
    }
  });

  it("renders the ANATOMY eyebrow above the rows", () => {
    const html = renderAnatomyRail(baseVM());
    expect(html).toContain("ANATOMY");
    expect(html).toContain("anatomy-rail-eyebrow");
  });

  it("shows a filled dot on identity when roleName is non-empty", () => {
    const html = renderAnatomyRail(baseVM({ roleName: "Tester" }));
    // The identity row should contain a filled dot
    expect(html).toContain("anatomy-dot filled");
  });

  it("shows a filled dot on soul when soulName is set", () => {
    const html = renderAnatomyRail(baseVM({ soulName: "careful-soul" }));
    expect(html).toContain("anatomy-dot filled");
  });

  it("does not mark soul as filled when soulName is absent", () => {
    // Create a VM with only instructions filled so we can count carefully
    const html = renderAnatomyRail(baseVM({
      soulName: undefined,
      instructions: "",
      toolsSummary: { granted: 0, canWrite: 0 },
      skills: [],
    }));
    // Only identity (roleName "Tester") and engine (engineId "copilot") + autonomy are filled
    // Soul should NOT be filled. Isolate the soul row and assert no "filled" inside it.
    const soulRowMatch = html.match(/data-section="soul"[\s\S]*?<\/div>/);
    expect(soulRowMatch).not.toBeNull();
    expect(soulRowMatch![0]).not.toContain("filled");
  });

  it("marks tools as filled when granted > 0", () => {
    const html = renderAnatomyRail(baseVM({ toolsSummary: { granted: 2, canWrite: 0 } }));
    expect(html).toContain("anatomy-dot filled");
  });

  it("marks skills as filled when skills array is non-empty", () => {
    const html = renderAnatomyRail(baseVM({ skills: [{ name: "run-tests" }] }));
    expect(html).toContain("anatomy-dot filled");
  });

  it("has exactly 7 rail rows", () => {
    const html = renderAnatomyRail(baseVM());
    // Match the row class exactly (the rows-wrapper "anatomy-rail-rows" must not count).
    const matches = html.match(/class="anatomy-rail-row"/g) ?? [];
    expect(matches.length).toBe(7);
  });
});

// ─── renderAnatomyCanvas ──────────────────────────────────────────────────────

describe("renderAnatomyCanvas", () => {
  it("renders every section as a canvas block (single scroll, not tabs)", () => {
    const html = renderAnatomyCanvas(baseVM());
    const sections = ["identity", "soul", "instructions", "tools", "skills", "engine", "autonomy"];
    for (const s of sections) {
      expect(html).toContain(`<section class="anatomy-section" data-section="${s}">`);
    }
  });

  it("renders the identity name in a Manrope name block", () => {
    const html = renderAnatomyCanvas(baseVM({ roleName: "Backend reviewer" }));
    expect(html).toContain("anatomy-identity-name");
    expect(html).toContain("Backend reviewer");
  });

  it("renders the identity vitals line led by a pulse icon", () => {
    const html = renderAnatomyCanvas(baseVM({ engineId: "copilot", autonomy: "manual" }));
    // The pulse SVG precedes the "engine · autonomy" vitals text (prototype 674-677).
    expect(html).toContain("anatomy-vitals-icon");
    expect(html).toContain("anatomy-vitals-text");
    const meta = html.match(/anatomy-identity-meta[\s\S]*?<\/div>/);
    expect(meta).not.toBeNull();
    // The pulse <svg> must appear before the vitals text inside the meta block.
    const iconIdx = meta![0].indexOf("anatomy-vitals-icon");
    const textIdx = meta![0].indexOf("anatomy-vitals-text");
    expect(iconIdx).toBeGreaterThanOrEqual(0);
    expect(textIdx).toBeGreaterThan(iconIdx);
  });

  it("renders a modal header with a title and a close control", () => {
    const html = renderAnatomyCanvas(baseVM({ roleName: "Backend reviewer" }));
    expect(html).toContain("anatomy-header");
    expect(html).toContain("anatomy-header-title");
    expect(html).toContain('data-action="anatomy-close"');
    expect(html).toContain("Backend reviewer anatomy");
  });

  it("falls back to a generic header title when roleName is empty", () => {
    const html = renderAnatomyCanvas(baseVM({ roleName: "" }));
    expect(html).toContain("Agent anatomy");
  });

  it("renders a footer with Cancel and Save agent buttons", () => {
    const html = renderAnatomyCanvas(baseVM());
    expect(html).toContain("anatomy-footer");
    expect(html).toContain('data-action="anatomy-cancel"');
    expect(html).toContain("Cancel");
    expect(html).toContain('data-action="anatomy-save"');
    expect(html).toContain("Save agent");
  });

  it("renders the contrasting Soul and Instructions helper eyebrows", () => {
    const html = renderAnatomyCanvas(baseVM());
    // Soul = "who it is", Instructions = "what it does" (the twin-editor contrast).
    expect(html).toContain("who it is");
    expect(html).toContain("what it does");
  });

  it("renders the soul.md and instructions.md file cards", () => {
    const html = renderAnatomyCanvas(baseVM());
    expect(html).toContain("soul.md");
    expect(html).toContain("instructions.md");
    expect(html).toContain("anatomy-textarea-card");
  });

  it("renders a tools grid with all 5 builtin tools", () => {
    const html = renderAnatomyCanvas(baseVM());
    for (const tool of ["Read", "Search", "Edit", "Run", "Git"]) {
      expect(html).toContain(`data-tool="${tool}"`);
    }
  });

  it("groups the tools grid into BUILT-IN", () => {
    const html = renderAnatomyCanvas(baseVM());
    expect(html).toContain("BUILT-IN");
  });

  it("renders each tool read grant as a sliding toggle track + knob", () => {
    const html = renderAnatomyCanvas(baseVM());
    expect(html).toContain("anatomy-tool-toggle");
    expect(html).toContain("anatomy-tool-toggle-track");
    expect(html).toContain("anatomy-tool-toggle-knob");
    // The read grant is still a checkbox named data-mode="read" so wiring can read it.
    expect(html).toContain('data-mode="read"');
  });

  it("marks the read toggle 'on' when read is granted", () => {
    const vm = baseVM({
      tools: { builtins: { read: ["Read"], write: [] } },
      toolsSummary: { granted: 1, canWrite: 0 },
    });
    const html = renderAnatomyCanvas(vm);
    expect(html).toContain("anatomy-tool-toggle on");
  });

  it("renders a write toggle (never a read toggle) for write-capable built-ins", () => {
    // Edit/Run/Git are write-only in the model; offering them a read toggle let
    // users grant "read" on Edit, which the config validator rejects. They now
    // render a write toggle + a static amber write badge instead.
    const html = renderAnatomyCanvas(baseVM());
    expect(html).toContain("anatomy-tool-toggle--write");
    expect(html).toContain('data-mode="write"');
    expect(html).toContain("anatomy-tool-write-badge");
    // Every row keeps a placeholder so the 4-column grid stays aligned.
    expect(html).toContain("anatomy-tool-write-placeholder");
  });

  it("renders MCP rows grouped under MCP SERVERS when mcp grants exist", () => {
    const vm = baseVM({
      tools: { mcp: [{ server: "supabase", read: true, write: false }] },
      toolsSummary: { granted: 1, canWrite: 0 },
    });
    const html = renderAnatomyCanvas(vm);
    expect(html).toContain("MCP SERVERS");
    expect(html).toContain('data-tool="supabase"');
  });

  it("write toggles are unchecked by default (write OFF by default)", () => {
    const html = renderAnatomyCanvas(baseVM());
    // No checked write checkboxes for a default role.
    const writeInputs = html.match(/data-mode="write"[^>]*/g) ?? [];
    expect(writeInputs.length).toBeGreaterThan(0);
    for (const input of writeInputs) {
      expect(input).not.toContain("checked");
    }
  });

  it("shows write toggle unchecked for a read-only role (read granted, no write)", () => {
    const vm = baseVM({
      tools: { builtins: { read: ["Read"], write: [] } },
      toolsSummary: { granted: 1, canWrite: 0 },
    });
    const html = renderAnatomyCanvas(vm);
    const writeInputs = html.match(/data-mode="write"[^>]*/g) ?? [];
    for (const input of writeInputs) {
      expect(input).not.toContain("checked");
    }
  });

  it("shows write toggle checked when Git write is granted", () => {
    const vm = baseVM({
      tools: { builtins: { write: ["Git"] } },
      toolsSummary: { granted: 1, canWrite: 1 },
    });
    const html = renderAnatomyCanvas(vm);
    // The Git write input should be checked.
    expect(html).toContain("checked");
  });

  it("renders the granted summary line", () => {
    const vm = baseVM({ toolsSummary: { granted: 2, canWrite: 1 } });
    const html = renderAnatomyCanvas(vm);
    expect(html).toContain("2 granted");
    expect(html).toContain("1 can write");
  });

  it("the can-write count has amber class when canWrite > 0", () => {
    const vm = baseVM({ toolsSummary: { granted: 2, canWrite: 1 } });
    const html = renderAnatomyCanvas(vm);
    expect(html).toContain("anatomy-tools-can-write amber");
  });

  it("the can-write count does NOT have amber class when canWrite is 0", () => {
    const vm = baseVM({ toolsSummary: { granted: 1, canWrite: 0 } });
    const html = renderAnatomyCanvas(vm);
    // Should not have "amber" on the can-write span
    expect(html).not.toContain("anatomy-tools-can-write amber");
    expect(html).toContain("anatomy-tools-can-write");
  });

  it("renders the write-granted-separately note", () => {
    const html = renderAnatomyCanvas(baseVM());
    expect(html).toContain("Write is granted separately from read.");
  });

  it("renders skill chips with the skill name and a remove control", () => {
    const vm = baseVM({ skills: [{ name: "run-tests" }, { name: "openapi" }] });
    const html = renderAnatomyCanvas(vm);
    expect(html).toContain("run-tests");
    expect(html).toContain("openapi");
    expect(html).toContain("anatomy-skill-remove");
  });

  it("renders a per-skill usage link icon next to each chip", () => {
    const vm = baseVM({ skills: [{ name: "run-tests" }] });
    const html = renderAnatomyCanvas(vm);
    expect(html).toContain("anatomy-skill-usage");
    expect(html).toContain("anatomy-skill-usage-icon");
    expect(html).toContain('data-action="skill-usage"');
  });

  it("renders the Add-skill action", () => {
    const html = renderAnatomyCanvas(baseVM());
    expect(html).toContain("anatomy-skill-add");
    expect(html).toContain("Add skill");
  });

  it("renders the skill picker with a row per available skill", () => {
    const vm = baseVM({
      availableSkills: [{ name: "reviewer" }, { name: "tester", allowedTools: ["Read"] }],
    });
    const html = renderAnatomyCanvas(vm);
    // The hidden picker container is present, with the "+ Add skill" trigger.
    expect(html).toContain("data-skill-picker");
    expect(html).toContain("anatomy-skill-add");
    expect(html).toContain('data-action="add-skill"');
    // One attach row per available skill, each carrying its data-skill.
    const attachRows = html.match(/data-action="anatomy-attach-skill"/g) ?? [];
    expect(attachRows.length).toBe(2);
    expect(html).toContain('data-skill="reviewer"');
    expect(html).toContain('data-skill="tester"');
    // The allowedTools hint is shown when present.
    expect(html).toContain("anatomy-skill-picker-hint");
    expect(html).toContain("Read");
  });

  it("renders an attached skill chip with a remove control", () => {
    const vm = baseVM({ skills: [{ name: "run-tests" }] });
    const html = renderAnatomyCanvas(vm);
    expect(html).toContain('data-action="remove-skill"');
    expect(html).toContain('data-skill="run-tests"');
  });

  it("renders a muted 'all attached' picker row when no skills are available", () => {
    const vm = baseVM({ skills: [{ name: "run-tests" }], availableSkills: [] });
    const html = renderAnatomyCanvas(vm);
    expect(html).toContain("anatomy-skill-picker-empty");
    expect(html).toContain("All skills attached.");
    // No clickable attach rows in the empty state.
    expect(html).not.toContain('data-action="anatomy-attach-skill"');
  });

  it("renders a 'no skills available' picker row when role has none attached and none exist", () => {
    const vm = baseVM({ skills: [], availableSkills: [] });
    const html = renderAnatomyCanvas(vm);
    expect(html).toContain("anatomy-skill-picker-empty");
    expect(html).toContain("No skills available.");
  });

  it("escapes a malicious available-skill name in the picker", () => {
    const vm = baseVM({ availableSkills: [{ name: "<script>alert(1)</script>" }] });
    const html = renderAnatomyCanvas(vm);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("renders the soul textarea prefilled with soulBody", () => {
    const vm = baseVM({ soulBody: "You are careful." });
    const html = renderAnatomyCanvas(vm);
    expect(html).toContain('data-action="role-set-soul"');
    expect(html).toContain("You are careful.");
  });

  it("renders the instructions textarea", () => {
    const html = renderAnatomyCanvas(baseVM());
    expect(html).toContain('data-action="role-set-instructions"');
  });

  it("renders the active autonomy button with active class", () => {
    const vm = baseVM({ autonomy: "auto-approve-safe" });
    const html = renderAnatomyCanvas(vm);
    expect(html).toContain('data-value="auto-approve-safe"');
    // The auto-approve-safe button should carry the active class.
    const activeMatch = html.match(/anatomy-autonomy-btn active[^>]*data-value="auto-approve-safe"/);
    expect(activeMatch).not.toBeNull();
  });

  it("renders the engine pills with the active engine highlighted", () => {
    const html = renderAnatomyCanvas(baseVM());
    expect(html).toContain("anatomy-engine-pill active");
    expect(html).toContain("copilot");
  });

  it("marks exactly the active engine pill with the bordered 'active' class", () => {
    // acp is a supported engine, so its active state renders as a selectable
    // bordered pill carrying both the active class and data-engine.
    const html = renderAnatomyCanvas(baseVM({ engineId: "acp" }));
    // The active class is the styling hook the CSS uses to render a bordered
    // (not filled) pill. Only the active engine carries it.
    const activeMatches = html.match(/anatomy-engine-pill active/g) ?? [];
    expect(activeMatches.length).toBe(1);
    const activeIdx = html.indexOf("anatomy-engine-pill active");
    // The active pill is the acp one, not a filled-blue variant.
    expect(html.slice(activeIdx, activeIdx + 120)).toContain('data-engine="acp"');
  });

  it("does not inline a blue fill on the active engine pill (bordered, not filled)", () => {
    const html = renderAnatomyCanvas(baseVM());
    // Styling lives in CSS via the .active class; the markup must not hardcode a fill.
    expect(html).not.toContain("background:var(--blue)");
    expect(html).not.toContain("background:#8ab8ff");
  });

  it("keeps an unknown engine id visible as an active pill", () => {
    const html = renderAnatomyCanvas(baseVM({ engineId: "mystery-engine" }));
    expect(html).toContain("mystery-engine");
    expect(html).toContain("anatomy-engine-pill active");
  });

  it("renders gemini/claude/codex as disabled 'soon' pills, not selectable", () => {
    // These engines have no registered adapter. Clicking them used to post
    // role-set-engine and trip the host's refuse-to-write error, so they render
    // disabled with a "soon" badge and carry NO role-set-engine action.
    const html = renderAnatomyCanvas(baseVM());
    for (const engine of ["gemini", "claude", "codex"]) {
      // The soon pill is present (badge + the soon modifier class) and disabled.
      const soonIdx = html.indexOf(`title="${engine} is not available yet"`);
      expect(soonIdx).toBeGreaterThanOrEqual(0);
      const pill = html.slice(soonIdx - 160, soonIdx + 120);
      expect(pill).toContain("anatomy-engine-pill--soon");
      expect(pill).toContain("disabled");
      expect(pill).toContain("anatomy-engine-soon");
      // The unsupported engine is never wired to role-set-engine.
      expect(html).not.toContain(`data-engine="${engine}"`);
    }
  });

  it("keeps copilot and acp pills interactive (data-action + data-engine)", () => {
    const html = renderAnatomyCanvas(baseVM());
    for (const engine of ["copilot", "acp"]) {
      const idx = html.indexOf(`data-engine="${engine}"`);
      expect(idx).toBeGreaterThanOrEqual(0);
      // The same pill carries the role-set-engine action and is not a soon pill.
      const pill = html.slice(idx - 160, idx + 60);
      expect(pill).toContain('data-action="role-set-engine"');
      expect(pill).not.toContain("anatomy-engine-pill--soon");
      expect(pill).not.toContain("disabled");
    }
  });
});

// ─── renderGrantGate ──────────────────────────────────────────────────────────

describe("renderGrantGate", () => {
  it("contains 'needs' in the copy", () => {
    const html = renderGrantGate(
      "run-tests",
      { missingWrite: ["Git"], missingRead: [], missingMcp: [] },
      "Tester"
    );
    expect(html).toContain("needs");
  });

  it("is amber-bordered", () => {
    const html = renderGrantGate(
      "run-tests",
      { missingWrite: ["Git"], missingRead: [], missingMcp: [] },
      "Tester"
    );
    expect(html).toContain("amber-border");
  });

  it("names the missing tool (Git)", () => {
    const html = renderGrantGate(
      "run-tests",
      { missingWrite: ["Git"], missingRead: [], missingMcp: [] },
      "Tester"
    );
    expect(html).toContain("Git");
  });

  it("has a grant button with data-action='grant'", () => {
    const html = renderGrantGate(
      "run-tests",
      { missingWrite: ["Git"], missingRead: [], missingMcp: [] },
      "Tester"
    );
    expect(html).toContain('data-action="grant"');
  });

  it("has an attach-without-granting button with data-action='attach-anyway'", () => {
    const html = renderGrantGate(
      "run-tests",
      { missingWrite: ["Git"], missingRead: [], missingMcp: [] },
      "Tester"
    );
    expect(html).toContain('data-action="attach-anyway"');
    expect(html).toContain("Attach without granting");
  });

  it("has a cancel button with data-action='cancel-grant'", () => {
    const html = renderGrantGate(
      "run-tests",
      { missingWrite: ["Git"], missingRead: [], missingMcp: [] },
      "Tester"
    );
    expect(html).toContain('data-action="cancel-grant"');
  });

  it("does NOT contain a silent attach (no auto-grant)", () => {
    const html = renderGrantGate(
      "run-tests",
      { missingWrite: ["Git"], missingRead: [], missingMcp: [] },
      "Tester"
    );
    // There should be no hidden auto-grant mechanism
    expect(html).not.toContain("auto-grant");
    expect(html).not.toContain("silently");
  });

  it("contains the skill name in the output", () => {
    const html = renderGrantGate(
      "run-tests",
      { missingWrite: ["Git"], missingRead: [], missingMcp: [] },
      "Tester"
    );
    expect(html).toContain("run-tests");
  });

  // ─── XSS escaping ─────────────────────────────────────────────────────────

  it("escapes an <img onerror> in a soul body (via renderAnatomyCanvas)", () => {
    const vm = baseVM({ soulBody: '<img onerror="alert(1)">' });
    const html = renderAnatomyCanvas(vm);
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("escapes an <img onerror> in a skill name (via renderAnatomyCanvas)", () => {
    const vm = baseVM({ skills: [{ name: '<script>alert(1)</script>' }] });
    const html = renderAnatomyCanvas(vm);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("escapes an mcp server name in the tools grid (via renderAnatomyCanvas)", () => {
    const vm = baseVM({
      tools: { mcp: [{ server: '<img src=x>', read: true }] },
      toolsSummary: { granted: 1, canWrite: 0 },
    });
    const html = renderAnatomyCanvas(vm);
    expect(html).not.toContain("<img src=x>");
    expect(html).toContain("&lt;img");
  });

  it("escapes a skill name in the grant-gate", () => {
    const html = renderGrantGate(
      '<img onerror="x">',
      { missingWrite: ["Git"], missingRead: [], missingMcp: [] },
      "Tester"
    );
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("escapes a role name in the grant-gate", () => {
    const html = renderGrantGate(
      "run-tests",
      { missingWrite: ["Git"], missingRead: [], missingMcp: [] },
      '<script>bad()</script>'
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
