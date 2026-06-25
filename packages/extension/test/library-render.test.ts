import { describe, expect, it } from "vitest";
import {
  renderTabBar,
  renderSkillCard,
  renderSkillEditor,
  renderPickerRows,
  renderRoleList,
  renderTeamList,
  renderTeamEditor,
} from "../src/library-render.js";
import type { SkillCardVM, TeamEditVM } from "../src/library-protocol.js";

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

  it("uses the lib-tab class (NOT the board drawer's bare .tab)", () => {
    const html = renderTabBar("skills");
    expect(html).toContain('class="lib-tab"');
    expect(html).toContain('class="lib-tab active"');
    // No bare `class="tab"` / `class="tab active"` that would collide with the
    // board drawer's `.tab`.
    expect(html).not.toMatch(/class="tab"/);
    expect(html).not.toMatch(/class="tab active"/);
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

  it("renders the literal 'requirements, not grants' note (prototype copy)", () => {
    expect(renderSkillEditor(baseCard, body)).toContain("Declared requirements, not grants");
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

  it("renders REQUIRED TOOLS as a 3-column TOOL / READ / WRITE table (prototype 891-904)", () => {
    const html = renderSkillEditor(baseCard, body);
    expect(html).toContain("editor-req-head");
    expect(html).toContain(">TOOL<");
    expect(html).toContain(">READ<");
    expect(html).toContain(">WRITE<");
  });

  it("renders a per-row read + write toggle cell with a data-action (wiring deferred)", () => {
    const html = renderSkillEditor(baseCard, body);
    expect(html).toContain('data-action="skill-req-toggle-read"');
    expect(html).toContain('data-action="skill-req-toggle-write"');
    expect(html).toContain('data-tool="Bash"');
    expect(html).toContain("editor-req-tick");
  });

  it("renders the section-navigation links above USED BY (prototype 857-859)", () => {
    const html = renderSkillEditor(baseCard, body);
    expect(html).toContain("editor-rail-nav");
    expect(html).toContain('data-sksec-link="identity"');
    expect(html).toContain('data-sksec-link="procedure"');
    expect(html).toContain('data-sksec-link="reqtools"');
    // The links sit above the USED BY block.
    expect(html.indexOf("editor-rail-nav")).toBeLessThan(html.indexOf("USED BY"));
  });
});

// ─── renderPickerRows ─────────────────────────────────────────────────────────

describe("renderPickerRows", () => {
  it("lists the skill with its declared allowedTools hint", () => {
    const html = renderPickerRows([baseCard], "Tester");
    expect(html).toContain("run-tests");
    expect(html).toContain("Bash");
  });

  it("renders the amber grant-gate expansion markup per row (prototype 945-953)", () => {
    const html = renderPickerRows([baseCard], "Tester");
    expect(html).toContain("picker-grant-gate");
    // Defaults hidden: the host reveals it only when the grant-gate fires.
    expect(html).toContain("picker-grant-gate hidden");
    // The three grant-gate affordances (markup only; wiring deferred).
    expect(html).toContain('data-action="grant-tool"');
    expect(html).toContain('data-action="attach-without-grant"');
    expect(html).toContain('data-action="grant-cancel"');
  });

  it("grant-gate is NOT wired: no bare data-action='grant' (R5)", () => {
    const html = renderPickerRows([baseCard], "Tester");
    expect(html).not.toContain('data-action="grant"');
  });

  it("escapeHtml: role + skill name in grant-gate are escaped", () => {
    const xssCard: SkillCardVM = { ...baseCard, name: "<b>evil</b>" };
    const html = renderPickerRows([xssCard], "<i>Role</i>");
    expect(html).not.toContain("<b>evil</b>");
    expect(html).not.toContain("<i>Role</i>");
    expect(html).toContain("&lt;b&gt;");
    expect(html).toContain("&lt;i&gt;");
  });

  it("renders the DISCOVERED IN REPO group when discovered items are passed (prototype 975-993)", () => {
    const html = renderPickerRows([baseCard], "Tester", [
      { name: "lint-fix", description: "Runs the linter and applies fixes", hint: ".claude/skills" },
    ]);
    expect(html).toContain("DISCOVERED IN REPO");
    expect(html).toContain("lint-fix");
    expect(html).toContain("not yet in library");
    expect(html).toContain('data-action="adopt-and-attach"');
  });

  it("omits the DISCOVERED IN REPO group when no discovered items are passed", () => {
    const html = renderPickerRows([baseCard], "Tester");
    expect(html).not.toContain("DISCOVERED IN REPO");
  });

  it("escapeHtml: discovered item name + hint are escaped", () => {
    const html = renderPickerRows([baseCard], "Tester", [
      { name: "<script>x</script>", description: "bad", hint: "<img src=x>" },
    ]);
    expect(html).not.toContain("<script>x</script>");
    expect(html).not.toContain("<img src=x>");
    expect(html).toContain("&lt;script&gt;");
  });
});

// ─── renderRoleList ───────────────────────────────────────────────────────────

describe("renderRoleList", () => {
  it("lists role name and engine", () => {
    const html = renderRoleList([{ name: "Tester", engineId: "copilot", skills: ["run-tests"] }]);
    expect(html).toContain("Tester");
    expect(html).toContain("copilot");
  });

  it("gives each agent card a Run action carrying the role name", () => {
    const html = renderRoleList([{ name: "Tester", engineId: "copilot", skills: [] }]);
    expect(html).toContain('data-action="run-role"');
    expect(html).toContain('data-role="Tester"');
    expect(html).toContain(">Run</button>");
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

  it("renders the role's REAL instructions snippet (not the hardcoded '<engine> agent')", () => {
    const html = renderRoleList([
      {
        name: "Tester",
        engineId: "copilot",
        skills: [],
        instructions: "Run the full suite and report only the failures.",
      },
    ]);
    expect(html).toContain("Run the full suite and report only the failures.");
    // The card no longer ends with the hardcoded "copilot agent" snippet.
    expect(html).not.toContain(">copilot agent<");
  });

  it("falls back to '<engine> agent' when the role has no instructions", () => {
    const html = renderRoleList([{ name: "Tester", engineId: "copilot", skills: [] }]);
    expect(html).toContain("copilot agent");
  });

  it("escapeHtml: instructions snippet is escaped", () => {
    const html = renderRoleList([
      { name: "T", engineId: "copilot", skills: [], instructions: "<script>evil()</script>" },
    ]);
    expect(html).not.toContain("<script>evil()</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("autonomy meter reflects the real autonomy value (yolo fills 3 notches)", () => {
    const manual = renderRoleList([
      { name: "M", engineId: "copilot", skills: [], autonomy: "manual" },
    ]);
    const yolo = renderRoleList([
      { name: "Y", engineId: "copilot", skills: [], autonomy: "yolo" },
    ]);
    const filledCount = (html: string) =>
      (html.match(/autonomy-notch filled/g) ?? []).length;
    expect(filledCount(manual)).toBe(1);
    expect(filledCount(yolo)).toBe(3);
  });

  it("defaults the autonomy meter to level 2 when autonomy is absent", () => {
    const html = renderRoleList([{ name: "D", engineId: "copilot", skills: [] }]);
    expect((html.match(/autonomy-notch filled/g) ?? []).length).toBe(2);
  });

  it("renders the soul glyph (☽) only when the role has a soul", () => {
    const withSoul = renderRoleList([
      { name: "S", engineId: "copilot", skills: [], hasSoul: true },
    ]);
    const withoutSoul = renderRoleList([
      { name: "S", engineId: "copilot", skills: [], hasSoul: false },
    ]);
    expect(withSoul).toContain("agent-anatomy-soul");
    expect(withSoul).toContain("&#9789;");
    expect(withoutSoul).not.toContain("agent-anatomy-soul");
  });

  it("renders the tool count (🔧 N) only when the role has tools", () => {
    const withTools = renderRoleList([
      { name: "T", engineId: "copilot", skills: [], toolsCount: 3 },
    ]);
    const withoutTools = renderRoleList([
      { name: "T", engineId: "copilot", skills: [], toolsCount: 0 },
    ]);
    expect(withTools).toContain("agent-anatomy-tools");
    expect(withTools).toContain("&#128295; 3");
    expect(withoutTools).not.toContain("agent-anatomy-tools");
  });

  it("renders the skills chip in the anatomy row when skills are present", () => {
    const html = renderRoleList([
      { name: "T", engineId: "copilot", skills: ["run-tests", "lint"] },
    ]);
    expect(html).toContain("agent-anatomy-skill");
    expect(html).toContain("run-tests");
    expect(html).toContain("+1");
  });

  it("renders a delete affordance carrying delete-role + the role name", () => {
    const html = renderRoleList([{ name: "Tester", engineId: "copilot", skills: [] }]);
    expect(html).toContain('data-action="delete-role"');
    expect(html).toMatch(/data-action="delete-role"[^>]*data-role="Tester"|data-role="Tester"[^>]*data-action="delete-role"/);
  });

  it("escapeHtml: the delete affordance role name is escaped", () => {
    const html = renderRoleList([{ name: '<b>X</b>', engineId: "copilot", skills: [] }]);
    // The delete button's data-role attribute carries the escaped name.
    expect(html).toContain("&lt;b&gt;X&lt;/b&gt;");
    expect(html).not.toMatch(/data-role="<b>/);
  });
});

// ─── renderTeamEditor ─────────────────────────────────────────────────────────

describe("renderTeamEditor", () => {
  const roles = [
    { name: "Tester", engineId: "copilot" },
    { name: "Reviewer", engineId: "acp" },
  ];

  const editing: TeamEditVM = { name: "Squad", roleNames: ["Tester"], goal: "Ship checkout" };

  it("renders a name field carrying the team name", () => {
    const html = renderTeamEditor(editing, roles);
    expect(html).toContain('data-action="team-name"');
    expect(html).toContain('value="Squad"');
  });

  it("renders a shared-goal field carrying the goal text", () => {
    const html = renderTeamEditor(editing, roles);
    expect(html).toContain('data-action="team-goal"');
    expect(html).toContain("Ship checkout");
  });

  it("renders one member toggle row per available role", () => {
    const html = renderTeamEditor(editing, roles);
    expect((html.match(/data-action="team-member-toggle"/g) ?? []).length).toBe(2);
    expect(html).toContain('data-role="Tester"');
    expect(html).toContain('data-role="Reviewer"');
  });

  it("marks selected members with the selected class + aria-pressed=true", () => {
    const html = renderTeamEditor(editing, roles);
    // Tester is selected; Reviewer is not.
    expect(html).toMatch(/team-editor-member selected[^>]*data-role="Tester"/);
    expect(html).toMatch(/data-role="Reviewer"[^>]*aria-pressed="false"|aria-pressed="false"[^>]*data-role="Reviewer"/);
  });

  it("shows the selected member count", () => {
    const html = renderTeamEditor(editing, roles);
    expect(html).toContain('class="team-editor-count">1<');
  });

  it("renders a Save action", () => {
    const html = renderTeamEditor(editing, roles);
    expect(html).toContain('data-action="team-save"');
  });

  it("renders a Delete action in edit mode (name set)", () => {
    const html = renderTeamEditor(editing, roles);
    expect(html).toContain('data-action="team-delete"');
    expect(html).toContain('data-team="Squad"');
  });

  it("omits Delete in create mode (name === '')", () => {
    const html = renderTeamEditor({ name: "", roleNames: [] }, roles);
    expect(html).not.toContain('data-action="team-delete"');
    expect(html).toContain("New team");
  });

  it("shows an empty-state when there are no roles", () => {
    const html = renderTeamEditor({ name: "", roleNames: [] }, []);
    expect(html).toContain("team-editor-empty");
    expect(html).not.toContain('data-action="team-member-toggle"');
  });

  it("escapeHtml: team name, goal, and member role names are escaped", () => {
    const html = renderTeamEditor(
      { name: '<img src=x onerror=alert(1)>', roleNames: [], goal: "<script>bad</script>" },
      [{ name: "<b>Role</b>", engineId: "copilot" }]
    );
    expect(html).not.toContain("<img src=x onerror=alert(1)>");
    expect(html).not.toContain("<script>bad</script>");
    expect(html).not.toContain("<b>Role</b>");
    expect(html).toContain("&lt;img");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;b&gt;");
  });

  it("uses no em dashes in its copy", () => {
    const html = renderTeamEditor({ name: "", roleNames: [] }, []);
    expect(html).not.toContain("—");
  });
});

// ─── renderTeamList ───────────────────────────────────────────────────────────

describe("renderTeamList", () => {
  it("lists the team name and agent count", () => {
    const html = renderTeamList([{ name: "Squad", roleNames: ["A", "B"] }]);
    expect(html).toContain("Squad");
    expect(html).toContain("2 agents");
  });

  it("renders the team's REAL goal text when provided (not the literal 'Shared goal')", () => {
    const html = renderTeamList([
      { name: "Squad", roleNames: ["A"], goal: "Ship the checkout flow this week." },
    ]);
    expect(html).toContain("Ship the checkout flow this week.");
    expect(html).not.toContain(">Shared goal<");
  });

  it("falls back to 'Shared goal' when the team has no goal", () => {
    const html = renderTeamList([{ name: "Squad", roleNames: ["A"] }]);
    expect(html).toContain("Shared goal");
  });

  it("escapeHtml: team goal is escaped", () => {
    const html = renderTeamList([
      { name: "Squad", roleNames: ["A"], goal: "<img onerror=alert(1) src=x>" },
    ]);
    expect(html).not.toContain("<img onerror=alert(1) src=x>");
    expect(html).toContain("&lt;img");
  });
});
