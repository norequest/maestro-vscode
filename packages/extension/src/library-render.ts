/**
 * Pure HTML builders for the Library webview (no DOM, no node imports).
 * All skill-authored text (name, description, body, role names) goes through
 * escapeHtml before interpolation.
 * Colors live in library.css; these builders emit class names only (the
 * webview CSP forbids inline style, so every visual is a CSS class). The DOM
 * structure mirrors the approved prototype in docs/design-reference.
 */

import { escapeHtml } from "./html.js";
import type { LibraryTab, SkillCardVM, TeamEditVM } from "./library-protocol.js";

// ─── Tab bar ─────────────────────────────────────────────────────────────────

const TAB_LABELS: Record<LibraryTab, string> = {
  agents: "Agents",
  teams: "Teams",
  skills: "Skills",
  discover: "Discover",
};

const TAB_ORDER: readonly LibraryTab[] = ["agents", "teams", "skills", "discover"];

/**
 * Renders the four-tab navigation bar, marking `activeTab` with the
 * "active" class (the prototype's active-underline treatment).
 *
 * The tab buttons use the `lib-tab` class (NOT the bare `.tab` used by the
 * board's drawer) so the two tab bars never collide when both stylesheets are
 * merged onto one page.
 */
export function renderTabBar(activeTab: LibraryTab): string {
  const buttons = TAB_ORDER.map((tab) => {
    const cls = tab === activeTab ? "lib-tab active" : "lib-tab";
    return `<button class="${cls}" data-tab="${tab}">${TAB_LABELS[tab]}</button>`;
  }).join("");
  return `<nav class="tab-bar">${buttons}</nav>`;
}

// ─── Library shell header ─────────────────────────────────────────────────────

/**
 * Renders the library shell header: title block (Manrope 800) + subtitle, the
 * four-tab strip, and a Close action, matching the prototype shell.
 */
export function renderLibraryHeader(activeTab: LibraryTab): string {
  return `<header class="lib-shell-header">
  <div class="lib-shell-titlebox">
    <span class="lib-shell-mark" aria-hidden="true">&#9670;</span>
    <div class="lib-shell-titles">
      <div class="lib-shell-title">Agents &amp; Teams</div>
      <div class="lib-shell-subtitle">The reusable definitions behind the board</div>
    </div>
  </div>
  <div class="lib-shell-nav">
    ${renderTabBar(activeTab)}
    <button class="lib-shell-close" data-action="close-library">Close <span class="lib-shell-close-x" aria-hidden="true">&times;</span></button>
  </div>
</header>`;
}

// ─── Agent card (Agents tab) ──────────────────────────────────────────────────

const AUTONOMY_NOTCHES = 4;

/** Autonomy enum -> filled-notch count (manual:1, auto-approve-safe:2, yolo:3). */
const AUTONOMY_LEVELS: Record<string, number> = {
  manual: 1,
  "auto-approve-safe": 2,
  yolo: 3,
};

/** A small autonomy meter glyph: filled notches up to `level` of 4. */
function renderAutonomyMeter(level: number): string {
  const clamped = Math.max(0, Math.min(AUTONOMY_NOTCHES, level));
  const notches = Array.from({ length: AUTONOMY_NOTCHES }, (_, i) => {
    const cls = i < clamped ? "autonomy-notch filled" : "autonomy-notch";
    return `<span class="${cls}"></span>`;
  }).join("");
  return `<span class="autonomy-meter" aria-hidden="true">${notches}</span>`;
}

/** A renderable role for the Agents tab. */
export interface RoleListItem {
  name: string;
  engineId: string;
  skills: string[];
  /** The role's real instructions (used for the 3-line card snippet). */
  instructions?: string;
  /** "manual" | "auto-approve-safe" | "yolo"; drives the autonomy meter. */
  autonomy?: string;
  /** True when the role references a soul.md (renders the ☽ glyph). */
  hasSoul?: boolean;
  /** Count of granted tools (renders the 🔧 N glyph when > 0). */
  toolsCount?: number;
}

/**
 * Renders the read-only Agents tab: a "New agent" dashed card followed by the
 * prototype's agent cards (name, engine chip, autonomy meter reflecting the
 * role's real autonomy, the role's real instructions snippet clamped to 3
 * lines, and the compact anatomy row showing the soul glyph, tool count, and
 * skills, matching the board card's anatomy row).
 */
export function renderRoleList(roles: RoleListItem[]): string {
  const newCard = `<button class="agent-new-card" data-action="new-agent">
  <span class="agent-new-plus" aria-hidden="true">+</span>
  <span class="agent-new-label">New agent</span>
</button>`;

  const cards = roles.map((role) => {
    const skills = role.skills;
    const hasSkills = skills.length > 0;
    const hasSoul = role.hasSoul === true;
    const toolsCount = role.toolsCount ?? 0;
    const hasTools = toolsCount > 0;

    // Anatomy row: soul glyph + tool count + skills chip, mirroring the board card.
    const soulGlyph = hasSoul
      ? `<span class="agent-anatomy-soul" aria-hidden="true">&#9789;</span>`
      : "";
    const toolGlyph = hasTools
      ? `<span class="agent-anatomy-tools">&#128295; ${toolsCount}</span>`
      : "";
    const skillsChip = hasSkills
      ? `<span class="agent-anatomy-skill"><span class="agent-anatomy-diamond" aria-hidden="true">&#9670;</span> ${escapeHtml(
          skills[0]!
        )}</span>${
          skills.length > 1
            ? `<span class="agent-anatomy-overflow">+${skills.length - 1}</span>`
            : ""
        }`
      : "";
    const anatomyRow =
      hasSoul || hasTools || hasSkills
        ? `<div class="agent-anatomy">${soulGlyph}${toolGlyph}${skillsChip}</div>`
        : "";

    // Autonomy meter from the role's real autonomy value (default level 2).
    const level =
      role.autonomy !== undefined && role.autonomy in AUTONOMY_LEVELS
        ? AUTONOMY_LEVELS[role.autonomy]!
        : 2;

    // Snippet: the role's real instructions (3-line clamp), with a graceful
    // fallback to "<engine> agent" when the role carries no instructions.
    const snippet =
      role.instructions && role.instructions.trim() !== ""
        ? escapeHtml(role.instructions.trim())
        : `${escapeHtml(role.engineId)} agent`;

    return `<div class="agent-card" data-role="${escapeHtml(role.name)}" tabindex="0" role="button">
  <div class="agent-card-head">
    <span class="agent-name" title="${escapeHtml(role.name)}">${escapeHtml(role.name)}</span>
    <span class="agent-engine">${escapeHtml(role.engineId)}</span>
    <button class="agent-delete-btn" data-action="delete-role" data-role="${escapeHtml(
      role.name
    )}" aria-label="Delete agent" title="Delete agent">&times;</button>
  </div>
  ${anatomyRow}
  <div class="agent-autonomy-row">
    ${renderAutonomyMeter(level)}
    <span class="agent-autonomy-label">autonomy</span>
  </div>
  <div class="agent-snippet">${snippet}</div>
  <div class="agent-card-actions">
    <button class="agent-run-btn" data-action="run-role" data-role="${escapeHtml(
      role.name
    )}" title="Run this agent on a task"><span class="agent-run-plus" aria-hidden="true">&#9654;</span>Run</button>
  </div>
</div>`;
  });

  return `<div class="agent-grid">${newCard}${cards.join("")}</div>`;
}

// ─── Team card (Teams tab) ────────────────────────────────────────────────────

/** A renderable team for the Teams tab. */
export interface TeamListItem {
  name: string;
  roleNames: string[];
  /** The team's real shared-goal text; falls back to "Shared goal" when absent. */
  goal?: string;
}

/**
 * Renders the read-only Teams tab: a "New team" dashed card followed by the
 * prototype's team cards (name, agent-count badge, the team's real shared goal,
 * member chips, Launch/Edit actions).
 */
export function renderTeamList(teams: TeamListItem[]): string {
  const newCard = `<button class="team-new-card" data-action="new-team">
  <span class="team-new-plus" aria-hidden="true">+</span>
  <span class="team-new-label">New team</span>
</button>`;

  const cards = teams.map((team) => {
    const memberChips = team.roleNames
      .map((name) => {
        const initial = name.trim().charAt(0).toUpperCase() || "?";
        return `<span class="team-member-chip"><span class="team-member-initial">${escapeHtml(initial)}</span><span class="team-member-name">${escapeHtml(name)}</span></span>`;
      })
      .join("");

    return `<div class="team-card" data-team="${escapeHtml(team.name)}">
  <div class="team-card-head">
    <span class="team-name" data-action="edit-team" data-team="${escapeHtml(team.name)}" tabindex="0" role="button" title="${escapeHtml(team.name)}">${escapeHtml(team.name)}</span>
    <span class="team-count">${team.roleNames.length} agents</span>
  </div>
  <div class="team-goal">${
    team.goal && team.goal.trim() !== "" ? escapeHtml(team.goal.trim()) : "Shared goal"
  }</div>
  <div class="team-members">${memberChips}</div>
  <div class="team-actions">
    <button class="team-launch-btn" data-action="launch-team" data-team="${escapeHtml(team.name)}"><span class="team-launch-bars" aria-hidden="true"><span></span><span></span><span></span><span></span></span>Launch team</button>
    <button class="team-edit-btn" data-action="edit-team" data-team="${escapeHtml(team.name)}">Edit</button>
  </div>
</div>`;
  });

  return `<div class="team-grid">${newCard}${cards.join("")}</div>`;
}

// ─── Team editor (modal) ──────────────────────────────────────────────────────

/** A role available for selection as a team member. */
export interface TeamEditorRole {
  name: string;
  engineId: string;
}

/**
 * Renders the team editor modal (create or edit mode), mirroring the approved
 * prototype's TEAM FORM (lines 794-839): a name field, a shared-goal field, and
 * a member multi-select sourced from the library's roles (each row toggles a
 * member in/out, showing the role initial, name, and engine). Save + Delete sit
 * in the footer; Delete shows only in edit mode. Every dynamic value is escaped.
 *
 * The selected members are read back from the DOM by app-main on Save, so each
 * row carries data-action="team-member-toggle" + data-role + an aria-pressed
 * state the client flips. Graphite tokens only, no inline style.
 */
export function renderTeamEditor(editingTeam: TeamEditVM, roles: TeamEditorRole[]): string {
  const isCreate = editingTeam.name === "";
  const headerName = isCreate ? "New team" : escapeHtml(editingTeam.name);
  const selected = new Set(editingTeam.roleNames);

  const memberRows =
    roles.length === 0
      ? `<div class="team-editor-empty">No agents yet. Create an agent first, then build a team.</div>`
      : roles
          .map((role) => {
            const isSel = selected.has(role.name);
            const rowCls = isSel ? "team-editor-member selected" : "team-editor-member";
            const initial = role.name.trim().charAt(0).toUpperCase() || "?";
            return `<div class="${rowCls}" data-action="team-member-toggle" data-role="${escapeHtml(
              role.name
            )}" aria-pressed="${isSel ? "true" : "false"}">
      <span class="team-editor-check" aria-hidden="true">&#10003;</span>
      <span class="team-editor-avatar">${escapeHtml(initial)}</span>
      <span class="team-editor-member-name">${escapeHtml(role.name)}</span>
      <span class="team-editor-member-engine">${escapeHtml(role.engineId)}</span>
    </div>`;
          })
          .join("");

  const selectedCount = editingTeam.roleNames.length;

  const deleteBtn = !isCreate
    ? `<button class="delete-btn" data-action="team-delete" data-team="${escapeHtml(
        editingTeam.name
      )}">Delete team</button>`
    : "";

  const goalValue = editingTeam.goal ? escapeHtml(editingTeam.goal) : "";

  return `<div class="team-editor-overlay">
  <div class="team-editor" data-team="${escapeHtml(editingTeam.name)}">
    <div class="editor-head">
      <div class="editor-head-title"><span class="editor-head-diamond" aria-hidden="true">&#9670;</span><span class="editor-head-name">${headerName}</span></div>
      <button class="editor-close" data-action="team-cancel" aria-label="Close">&times;</button>
    </div>
    <div class="team-editor-body">
      <div class="team-editor-field">
        <div class="team-editor-label">TEAM NAME</div>
        <input class="team-editor-name-input" data-action="team-name" value="${escapeHtml(
          editingTeam.name
        )}" placeholder="e.g. Checkout Hardening" />
      </div>
      <div class="team-editor-field">
        <div class="team-editor-label">SHARED GOAL</div>
        <input class="team-editor-goal-input" data-action="team-goal" value="${goalValue}" placeholder="so that..." />
      </div>
      <div class="team-editor-field">
        <div class="team-editor-label">MEMBERS · <span class="team-editor-count">${selectedCount}</span> selected</div>
        <div class="team-editor-members">${memberRows}</div>
      </div>
    </div>
    <div class="editor-actions">
      <div class="editor-actions-left">${deleteBtn}</div>
      <button class="save-btn" data-action="team-save">Save</button>
    </div>
  </div>
</div>`;
}

// ─── Skill card (Skills tab) ──────────────────────────────────────────────────

/**
 * Renders a single skill card for the skill grid, matching the prototype card:
 * diamond glyph + name (Manrope), source badge, 2-line description, and the
 * blast-radius footer with a "used by N" pill that goes amber at N >= 3, plus
 * the required-tools hint.
 * Every user-supplied string is escaped.
 */
export function renderSkillCard(card: SkillCardVM): string {
  const isAmber = card.usedBy.length >= 3;
  const amberClass = isAmber ? " amber" : "";

  const pluginBadge =
    card.source === "plugin"
      ? `<span class="plugin-badge">From plugin</span>`
      : "";

  const toolsHint =
    card.allowedTools && card.allowedTools.length > 0
      ? `<span class="tools-hint">${card.allowedTools.map(escapeHtml).join(", ")}</span>`
      : "";

  const usedByClass = isAmber ? "used-by amber" : "used-by";
  const usedByPill = `<span class="${usedByClass}">used by ${card.usedBy.length}</span>`;

  return `<article class="skill-card${amberClass}" data-skill="${escapeHtml(card.name)}">
  <header class="skill-header">
    <span class="skill-diamond" aria-hidden="true">&#9670;</span>
    <span class="skill-name">${escapeHtml(card.name)}</span>
    ${pluginBadge}
  </header>
  <p class="skill-desc">${escapeHtml(card.description)}</p>
  <footer class="skill-footer">
    ${usedByPill}
    ${toolsHint}
  </footer>
</article>`;
}

/**
 * Renders the full Skills tab body: the section header with the "+ New skill"
 * action and the skill grid (or an empty state).
 */
export function renderSkillsTab(skills: SkillCardVM[]): string {
  const header = `<div class="skills-tab-header">
  <div class="skills-tab-title"><span class="skills-tab-diamond" aria-hidden="true">&#9670;</span><span>Skills</span></div>
  <button class="skill-new-btn" data-action="skill-create"><span class="skill-new-plus" aria-hidden="true">+</span>New skill</button>
</div>`;

  const grid = skills.length
    ? `<div class="skill-grid">${skills.map(renderSkillCard).join("")}</div>`
    : `<p class="lib-empty">No skills yet. Click "New skill" to create one.</p>`;

  return `<div class="skills-tab">${header}${grid}</div>`;
}

// ─── Skill editor ─────────────────────────────────────────────────────────────

/**
 * Renders the skill editor panel (create or edit mode), mirroring the
 * prototype's modal: a header (diamond + name), a used-by sub-rail with verified
 * dots, and a canvas with IDENTITY, PROCEDURE, and REQUIRED TOOLS sections. The
 * REQUIRED TOOLS section carries the literal "declared requirements, not grants"
 * note and an amber caution naming the dependent agents when usedBy >= 3. A
 * Delete affordance whose copy names the dependent roles sits in the footer.
 */
export function renderSkillEditor(card: SkillCardVM, body: string): string {
  const isCreate = card.name === "";
  const headerName = isCreate ? "New skill" : escapeHtml(card.name);

  // Used-by sub-rail: each dependent role with a verified dot.
  const usedDots = card.usedBy
    .map(
      (u) =>
        `<div class="editor-used-dot"><span class="editor-dot" aria-hidden="true"></span><span class="editor-dot-name">${escapeHtml(u.roleName)}</span></div>`
    )
    .join("");

  const usedByChips = card.usedBy
    .map(
      (u) =>
        `<span class="used-by-chip">${escapeHtml(u.roleName)} <span class="engine-id">${escapeHtml(u.engineId)}</span></span>`
    )
    .join("");

  // Required tools: declared requirements, never grants. Rendered as the
  // prototype's 3-column TOOL / READ / WRITE table with per-row toggle cells.
  // The toggles are presentation-only for now (R5: wiring is a later pass), so
  // each cell carries a data-action the host will bind when toggling lands.
  // TODO(P4): wire skill-req-toggle-read / skill-req-toggle-write to the host so
  // the ✓ indicators reflect and mutate the skill's declared read/write scope.
  const reqRows =
    card.allowedTools && card.allowedTools.length > 0
      ? card.allowedTools
          .map(
            (t) =>
              `<div class="editor-req-row">
        <span class="editor-req-name">${escapeHtml(t)}</span>
        <span class="editor-req-cell" data-action="skill-req-toggle-read" data-tool="${escapeHtml(
          t
        )}"><span class="editor-req-tick"></span></span>
        <span class="editor-req-cell" data-action="skill-req-toggle-write" data-tool="${escapeHtml(
          t
        )}"><span class="editor-req-tick"></span></span>
      </div>`
          )
          .join("")
      : `<div class="editor-req-empty">No required tools declared.</div>`;

  const isAmber = card.usedBy.length >= 3;
  const blastCaution = isAmber
    ? `<div class="blast-caution"><span class="blast-caution-icon" aria-hidden="true">&#9650;</span><span>Saving updates all ${card.usedBy.length} roles that use this skill.</span></div>`
    : "";

  // Delete affordance copy names every dependent role.
  const dependentRoleNames = card.usedBy.map((u) => escapeHtml(u.roleName)).join(", ");
  const deleteBtn = !isCreate
    ? `<button class="delete-btn" data-action="skill-delete" data-skill="${escapeHtml(card.name)}">Delete skill</button>
    <p class="delete-warning">Deleting "${escapeHtml(card.name)}" will remove it from: ${dependentRoleNames}</p>`
    : "";

  return `<div class="skill-editor-overlay">
  <div class="skill-editor" data-skill="${escapeHtml(card.name)}">
    <div class="editor-head">
      <div class="editor-head-title"><span class="editor-head-diamond" aria-hidden="true">&#9670;</span><span class="editor-head-name">${headerName}</span></div>
      <button class="editor-close" data-action="skill-cancel" aria-label="Close">&times;</button>
    </div>
    <div class="editor-body-wrap">
      <aside class="editor-rail">
        <nav class="editor-rail-nav">
          <a class="editor-rail-link" href="#editor-sec-identity" data-sksec-link="identity">Identity</a>
          <a class="editor-rail-link" href="#editor-sec-procedure" data-sksec-link="procedure">Procedure</a>
          <a class="editor-rail-link" href="#editor-sec-reqtools" data-sksec-link="reqtools">Required tools</a>
        </nav>
        <div class="editor-rail-divider" aria-hidden="true"></div>
        <div class="editor-rail-label">USED BY</div>
        <div class="editor-used-dots">${usedDots}</div>
      </aside>
      <div class="editor-canvas">
        <section class="editor-section" id="editor-sec-identity" data-sksec="identity">
          <div class="editor-section-label">IDENTITY</div>
          <input class="editor-name-input" data-action="edit-name" value="${escapeHtml(card.name)}" placeholder="skill-name" />
          <input class="editor-desc-input" data-action="edit-desc" value="${escapeHtml(card.description)}" placeholder="One-line description" />
        </section>
        <section class="editor-section" id="editor-sec-procedure" data-sksec="procedure">
          <div class="editor-section-label">PROCEDURE</div>
          <textarea class="editor-body" data-action="edit-body" placeholder="# steps...">${escapeHtml(body)}</textarea>
        </section>
        <section class="editor-section" id="editor-sec-reqtools" data-sksec="reqtools">
          <div class="editor-section-label">REQUIRED TOOLS</div>
          <div class="editor-tools-note">Declared requirements, not grants. Each agent grants these itself.</div>
          <div class="editor-req-table">
            <div class="editor-req-head">
              <span class="editor-req-head-tool">TOOL</span>
              <span class="editor-req-head-col">READ</span>
              <span class="editor-req-head-col">WRITE</span>
            </div>
            ${reqRows}
          </div>
          ${blastCaution}
          <div class="used-by-chips">${usedByChips}</div>
        </section>
      </div>
    </div>
    <div class="editor-actions">
      <div class="editor-actions-left">${deleteBtn}</div>
      <button class="save-btn" data-action="skill-save">Save</button>
    </div>
  </div>
</div>`;
}

// ─── Add-skill picker ─────────────────────────────────────────────────────────

/** A skill discovered in the repo but not yet adopted into the library. */
export interface PickerDiscoveredItem {
  name: string;
  description: string;
  /** A short source/path hint shown on the right of the row. */
  hint?: string;
}

/**
 * Renders the Add-skill picker for a given role, mirroring the prototype modal:
 * a header ("Add skill to <agent>") with a search box, an "IN LIBRARY" group,
 * a row per skill, and a "DISCOVERED IN REPO" group for skills found in the
 * workspace but not yet in the library. A row whose declared tools the agent
 * lacks shows the amber grant-gate expansion (Grant / Attach without granting /
 * Cancel).
 * NO grant flow is wired here (R5: grant-gate is P4); the grant-gate is purely
 * a structural placeholder controlled by the host.
 */
export function renderPickerRows(
  skills: SkillCardVM[],
  roleName: string,
  discovered: PickerDiscoveredItem[] = []
): string {
  const escapedRole = escapeHtml(roleName);

  const rows =
    skills.length === 0
      ? `<div class="picker-empty">No skills available.</div>`
      : skills
          .map((card) => {
            const escapedSkill = escapeHtml(card.name);
            const toolsHint =
              card.allowedTools && card.allowedTools.length > 0
                ? `<span class="picker-hint">${card.allowedTools.map(escapeHtml).join(", ")}</span>`
                : "";
            const sharedPill =
              card.usedBy.length > 0
                ? `<span class="picker-shared">shared by ${card.usedBy.length}</span>`
                : "";

            // Amber grant-gate expansion: shown by the host only when the agent
            // lacks a tool this skill declares. Markup + style only here; the
            // host toggles the `expanded` class and wires the buttons.
            // TODO(P4): the host shows .picker-grant-gate (removes `hidden`) when
            // grant-gate fires, and binds grant-tool / attach-without-grant to
            // the real grant flow. No grant logic lives in this renderer (R5).
            const grantGate = `<div class="picker-grant-gate hidden" data-skill="${escapedSkill}">
      <div class="picker-grant-warn">This skill needs a tool ${escapedRole} has not been granted.</div>
      <div class="picker-grant-actions">
        <button class="picker-grant-btn" data-action="grant-tool" data-role="${escapedRole}" data-skill="${escapedSkill}">Grant and attach</button>
        <button class="picker-grant-attach" data-action="attach-without-grant" data-role="${escapedRole}" data-skill="${escapedSkill}">Attach without granting</button>
        <button class="picker-grant-cancel" data-action="grant-cancel" data-skill="${escapedSkill}">Cancel</button>
      </div>
    </div>`;

            return `<div class="picker-row" data-skill="${escapedSkill}">
    <div class="picker-row-main" data-action="attach-skill" data-role="${escapedRole}" data-skill="${escapedSkill}">
      <span class="picker-diamond" aria-hidden="true">&#9670;</span>
      <div class="picker-row-text">
        <span class="picker-skill-name">${escapeHtml(card.name)}</span>
        <span class="picker-skill-desc">${escapeHtml(card.description)}</span>
      </div>
      <div class="picker-row-meta">
        ${sharedPill}
        ${toolsHint}
      </div>
    </div>
    ${grantGate}
  </div>`;
          })
          .join("");

  // DISCOVERED IN REPO group: skills found in the workspace, not yet adopted.
  // Markup + style only (wiring deferred). The "Adopt and attach" affordance
  // carries an adopt-and-attach data-action the host will bind later.
  // TODO(P4): wire adopt-and-attach to adopt the discovered skill into the
  // library and attach it to the role in one step.
  const discoveredGroup =
    discovered.length === 0
      ? ""
      : `<div class="picker-group-label picker-group-discovered">DISCOVERED IN REPO</div>
      <div class="picker-rows">${discovered
        .map((d) => {
          const escapedName = escapeHtml(d.name);
          const hint = d.hint ? `<span class="picker-disc-hint">${escapeHtml(d.hint)}</span>` : "";
          return `<div class="picker-disc-row" data-skill="${escapedName}">
          <span class="picker-diamond" aria-hidden="true">&#9670;</span>
          <div class="picker-row-text">
            <span class="picker-disc-head"><span class="picker-skill-name">${escapedName}</span><span class="picker-disc-tag">not yet in library</span></span>
            <span class="picker-skill-desc">${escapeHtml(d.description)}</span>
            <span class="picker-disc-adopt" data-action="adopt-and-attach" data-role="${escapedRole}" data-skill="${escapedName}">Adopt and attach</span>
          </div>
          ${hint}
        </div>`;
        })
        .join("")}</div>`;

  return `<div class="picker-overlay">
  <div class="skill-picker">
    <div class="picker-head">
      <div class="picker-head-row">
        <span class="picker-title">Add skill to ${escapedRole}</span>
        <button class="picker-close" data-action="picker-cancel" aria-label="Close">&times;</button>
      </div>
      <input class="picker-search" data-action="picker-search" placeholder="Search skills..." />
    </div>
    <div class="picker-list">
      <div class="picker-group-label">IN LIBRARY</div>
      <div class="picker-rows">${rows}</div>
      ${discoveredGroup}
    </div>
  </div>
</div>`;
}
