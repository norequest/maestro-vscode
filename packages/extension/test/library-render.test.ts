import { describe, expect, it } from "vitest";
import {
  renderTabBar,
  renderSkillCard,
  renderSkillEditor,
  renderPickerRows,
  renderRoleList,
} from "../src/library-render.js";
import { getLibraryHtml } from "../src/library-html.js";
import type { SkillCardVM } from "../src/library-protocol.js";

// ─── fixtures ─────────────────────────────────────────────────────────────────

const baseCard: SkillCardVM = {
  name: "run-tests",
  description: "Runs the test suite",
  allowedTools: ["Bash"],
  source: "authored",
  usedBy: [{ roleName: "Tester", engineId: "copilot" }],
};

const twoUsersCard: SkillCardVM = {
  ...baseCard,
  usedBy: [
    { roleName: "Tester", engineId: "copilot" },
    { roleName: "Reviewer", engineId: "copilot" },
  ],
};

const amberCard: SkillCardVM = {
  ...baseCard,
  usedBy: [
    { roleName: "Tester", engineId: "copilot" },
    { roleName: "Reviewer", engineId: "copilot" },
    { roleName: "Deployer", engineId: "acp" },
  ],
};

const pluginCard: SkillCardVM = {
  ...baseCard,
  source: "plugin",
};

// ─── renderTabBar ─────────────────────────────────────────────────────────────

describe("renderTabBar", () => {
  it("contains all four tab labels", () => {
    const html = renderTabBar("skills");
    expect(html).toContain("Agents");
    expect(html).toContain("Teams");
    expect(html).toContain("Skills");
    expect(html).toContain("Discover");
  });

  it("has data-tab='skills'", () => {
    const html = renderTabBar("skills");
    expect(html).toContain('data-tab="skills"');
  });

  it("marks the active tab on Skills", () => {
    const html = renderTabBar("skills");
    // The Skills tab button should have an active marker
    expect(html).toMatch(/active[^>]*>Skills|Skills[^<]*<\/button[^>]*>/);
    // More specifically: the button with data-tab="skills" has class active
    expect(html).toMatch(/class="[^"]*active[^"]*"[^>]*data-tab="skills"|data-tab="skills"[^>]*class="[^"]*active/);
  });

  it("marks agents tab active when tab is agents", () => {
    const html = renderTabBar("agents");
    expect(html).toMatch(/class="[^"]*active[^"]*"[^>]*data-tab="agents"|data-tab="agents"[^>]*class="[^"]*active/);
  });
});

// ─── renderSkillCard ──────────────────────────────────────────────────────────

describe("renderSkillCard", () => {
  it("shows the skill name", () => {
    expect(renderSkillCard(baseCard)).toContain("run-tests");
  });

  it("shows used by count for 1", () => {
    expect(renderSkillCard(baseCard)).toContain("used by 1");
  });

  it("shows used by count for 2", () => {
    expect(renderSkillCard(twoUsersCard)).toContain("used by 2");
  });

  it("shows the required-tools hint", () => {
    const html = renderSkillCard(baseCard);
    expect(html).toContain("Bash");
  });

  it("does NOT emit amber class when usedBy.length < 3", () => {
    expect(renderSkillCard(baseCard)).not.toContain("amber");
    expect(renderSkillCard(twoUsersCard)).not.toContain("amber");
  });

  it("emits amber class when usedBy.length >= 3", () => {
    expect(renderSkillCard(amberCard)).toContain("amber");
  });

  it("shows plugin badge when source is plugin", () => {
    expect(renderSkillCard(pluginCard)).toContain("plugin");
  });

  it("does NOT show plugin badge when source is authored", () => {
    const html = renderSkillCard(baseCard);
    // The word "plugin" as a badge/label should not appear for authored skills.
    // We check it doesn't emit a badge element containing "plugin".
    // (The CSS class name for the amber threshold is "amber", not "plugin".)
    expect(html).not.toMatch(/class="[^"]*plugin-badge[^"]*"/);
    expect(html).not.toMatch(/<[^>]+class="[^"]*plugin[^"]*"[^>]*>From plugin/);
  });

  it("escapeHtml: an XSS payload in description does NOT survive raw", () => {
    const xssCard: SkillCardVM = {
      ...baseCard,
      description: '<img onerror="alert(1)" src="x">',
    };
    const html = renderSkillCard(xssCard);
    expect(html).not.toContain('<img onerror="alert(1)"');
    expect(html).toContain("&lt;img");
  });

  it("escapeHtml: XSS payload in name is escaped", () => {
    const xssCard: SkillCardVM = {
      ...baseCard,
      name: '<script>evil()</script>',
    };
    const html = renderSkillCard(xssCard);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

// ─── renderSkillEditor ────────────────────────────────────────────────────────

describe("renderSkillEditor", () => {
  const body = "Run the test suite with vitest";

  it("renders the body text", () => {
    expect(renderSkillEditor(baseCard, body)).toContain(body);
  });

  it("renders the literal label 'declared requirements, not grants'", () => {
    expect(renderSkillEditor(baseCard, body)).toContain("declared requirements, not grants");
  });

  it("renders used-by chips", () => {
    const html = renderSkillEditor(baseCard, body);
    expect(html).toContain("Tester");
  });

  it("renders 'updates all 3' caution at usedBy length 3", () => {
    const html = renderSkillEditor(amberCard, body);
    expect(html).toContain("updates all 3");
  });

  it("does NOT render 'updates all' caution when usedBy < 3", () => {
    const html = renderSkillEditor(baseCard, body);
    expect(html).not.toContain("updates all");
  });

  it("renders a Delete affordance", () => {
    const html = renderSkillEditor(baseCard, body);
    expect(html).toMatch(/delete|Delete/);
  });

  it("names the dependent roles in the Delete modal copy", () => {
    const html = renderSkillEditor(amberCard, body);
    // The delete modal should name the dependent roles
    expect(html).toContain("Tester");
    expect(html).toContain("Reviewer");
    expect(html).toContain("Deployer");
  });

  it("escapeHtml: role name in used-by chips is escaped", () => {
    const xssCard: SkillCardVM = {
      ...baseCard,
      usedBy: [{ roleName: "<script>evil</script>", engineId: "copilot" }],
    };
    const html = renderSkillEditor(xssCard, body);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

// ─── renderPickerRows ─────────────────────────────────────────────────────────

describe("renderPickerRows", () => {
  it("lists the skill with its declared allowedTools hint", () => {
    const html = renderPickerRows([baseCard], "Tester");
    expect(html).toContain("run-tests");
    expect(html).toContain("Bash");
  });

  it("has NO data-action='grant' (R5: grant-gate is P4, not here)", () => {
    const html = renderPickerRows([baseCard], "Tester");
    expect(html).not.toContain('data-action="grant"');
    expect(html).not.toContain("Grant");
  });

  it("has NO 'Grant' flow at all", () => {
    const html = renderPickerRows([baseCard], "Tester");
    expect(html).not.toMatch(/grant/i);
  });
});

// ─── renderRoleList ───────────────────────────────────────────────────────────

describe("renderRoleList", () => {
  it("lists role name and engine", () => {
    const html = renderRoleList([{ name: "Tester", engineId: "copilot", skills: ["run-tests"] }]);
    expect(html).toContain("Tester");
    expect(html).toContain("copilot");
  });

  it("has no editor controls (read-only)", () => {
    const html = renderRoleList([{ name: "Tester", engineId: "copilot", skills: ["run-tests"] }]);
    // No input, textarea, or edit buttons
    expect(html).not.toMatch(/<input/);
    expect(html).not.toMatch(/<textarea/);
    expect(html).not.toContain('data-action="edit"');
  });

  it("escapeHtml: role name is escaped", () => {
    const html = renderRoleList([
      { name: "<b>Evil</b>", engineId: "copilot", skills: [] },
    ]);
    expect(html).not.toContain("<b>Evil</b>");
    expect(html).toContain("&lt;b&gt;");
  });
});

// ─── getLibraryHtml ───────────────────────────────────────────────────────────

describe("getLibraryHtml", () => {
  it("returns valid HTML boilerplate with CSP", () => {
    const html = getLibraryHtml("script.js", "style.css", "abc123", "vscode-webview:");
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("Content-Security-Policy");
    expect(html).toContain("nonce-abc123");
    expect(html).toContain("vscode-webview:");
  });

  it("embeds the script and style URIs", () => {
    const html = getLibraryHtml("my-script.js", "my-style.css", "nonce42", "csp-src");
    expect(html).toContain("my-script.js");
    expect(html).toContain("my-style.css");
  });

  it("includes a root div", () => {
    const html = getLibraryHtml("s.js", "s.css", "n", "c");
    expect(html).toContain('<div id="root">');
  });
});
