/**
 * Pure HTML builders for the Library webview (no DOM, no node imports).
 * All skill-authored text (name, description, body, role names) goes through
 * escapeHtml before interpolation.
 * Colors live in library.css (Task 13); these builders emit class names only.
 */

import { escapeHtml } from "./html.js";
import type { LibraryTab, SkillCardVM } from "./library-protocol.js";

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
 * "active" class.
 */
export function renderTabBar(activeTab: LibraryTab): string {
  const buttons = TAB_ORDER.map((tab) => {
    const cls = tab === activeTab ? "tab active" : "tab";
    return `<button class="${cls}" data-tab="${tab}">${TAB_LABELS[tab]}</button>`;
  }).join("");
  return `<nav class="tab-bar">${buttons}</nav>`;
}

// ─── Skill card ───────────────────────────────────────────────────────────────

/**
 * Renders a single skill card for the skill grid.
 * Emits the "amber" class when usedBy.length >= 3 (blast-radius warning).
 * Emits a "plugin-badge" span with "From plugin" text when source === "plugin".
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
      ? `<div class="tools-hint">${card.allowedTools.map(escapeHtml).join(", ")}</div>`
      : "";

  const usedByCount = `<span class="used-by">used by ${card.usedBy.length}</span>`;

  return `<article class="skill-card${amberClass}" data-skill="${escapeHtml(card.name)}">
  <header class="skill-header">
    <span class="skill-name">${escapeHtml(card.name)}</span>
    ${pluginBadge}
  </header>
  <p class="skill-desc">${escapeHtml(card.description)}</p>
  ${toolsHint}
  ${usedByCount}
</article>`;
}

// ─── Skill editor ─────────────────────────────────────────────────────────────

/**
 * Renders the skill editor panel (create or edit mode).
 * Shows:
 * - The skill body text (raw, inside a <pre> or textarea)
 * - The literal label "declared requirements, not grants" for the tools section
 * - Used-by chips listing each role that uses this skill
 * - An "updates all N" caution when usedBy.length >= 3
 * - A Delete affordance whose modal copy names the dependent roles
 */
export function renderSkillEditor(card: SkillCardVM, body: string): string {
  const isCreate = card.name === "";

  const usedByChips = card.usedBy
    .map(
      (u) =>
        `<span class="used-by-chip">${escapeHtml(u.roleName)} <span class="engine-id">${escapeHtml(u.engineId)}</span></span>`
    )
    .join("");

  const blastCaution =
    card.usedBy.length >= 3
      ? `<div class="blast-caution">Saving updates all ${card.usedBy.length} roles that use this skill.</div>`
      : "";

  const toolsHint =
    card.allowedTools && card.allowedTools.length > 0
      ? `<div class="tools-hint">${card.allowedTools.map(escapeHtml).join(", ")}</div>`
      : "";

  // Build delete modal copy naming all dependent roles
  const dependentRoleNames = card.usedBy.map((u) => escapeHtml(u.roleName)).join(", ");
  const deleteModal =
    !isCreate
      ? `<div class="delete-section">
  <button class="delete-btn" data-action="skill-delete" data-skill="${escapeHtml(card.name)}">Delete skill</button>
  <p class="delete-warning">Deleting "${escapeHtml(card.name)}" will remove it from: ${dependentRoleNames}</p>
</div>`
      : "";

  return `<div class="skill-editor">
  <section class="editor-body-section">
    <label class="editor-label">Skill body</label>
    <textarea class="editor-body" data-action="edit-body">${escapeHtml(body)}</textarea>
  </section>
  <section class="editor-tools-section">
    <label class="editor-label">Allowed tools <span class="tools-note">declared requirements, not grants</span></label>
    ${toolsHint}
  </section>
  <section class="editor-used-by-section">
    <label class="editor-label">Used by</label>
    <div class="used-by-chips">${usedByChips}</div>
    ${blastCaution}
  </section>
  ${deleteModal}
  <footer class="editor-actions">
    <button class="save-btn" data-action="skill-save">Save</button>
    <button class="cancel-btn" data-action="skill-cancel">Cancel</button>
  </footer>
</div>`;
}

// ─── Picker rows ──────────────────────────────────────────────────────────────

/**
 * Renders the Add-skill picker rows for a given role.
 * Shows each skill's name and DECLARED allowedTools hint.
 * Has NO grant flow / no data-action="grant" (R5: grant-gate is P4, not here).
 */
export function renderPickerRows(skills: SkillCardVM[], roleName: string): string {
  if (skills.length === 0) {
    return `<div class="picker-empty">No skills available.</div>`;
  }

  const rows = skills.map((card) => {
    const toolsHint =
      card.allowedTools && card.allowedTools.length > 0
        ? `<span class="tools-hint">${card.allowedTools.map(escapeHtml).join(", ")}</span>`
        : "";

    return `<div class="picker-row" data-skill="${escapeHtml(card.name)}">
  <span class="picker-skill-name">${escapeHtml(card.name)}</span>
  ${toolsHint}
  <button class="attach-btn" data-action="attach-skill" data-role="${escapeHtml(roleName)}" data-skill="${escapeHtml(card.name)}">Add</button>
</div>`;
  });

  return `<div class="skill-picker">${rows.join("")}</div>`;
}

// ─── Role list ────────────────────────────────────────────────────────────────

/**
 * Renders the read-only Agents tab role list.
 * Shows name and engine for each role. No editor controls.
 */
export function renderRoleList(
  roles: { name: string; engineId: string; skills: string[] }[]
): string {
  if (roles.length === 0) {
    return `<div class="role-list-empty">No roles configured.</div>`;
  }

  const items = roles.map((role) => {
    const skillList =
      role.skills.length > 0
        ? `<div class="role-skills">${role.skills.map(escapeHtml).join(", ")}</div>`
        : "";
    return `<div class="role-item">
  <span class="role-name">${escapeHtml(role.name)}</span>
  <span class="role-engine">${escapeHtml(role.engineId)}</span>
  ${skillList}
</div>`;
  });

  return `<div class="role-list">${items.join("")}</div>`;
}
