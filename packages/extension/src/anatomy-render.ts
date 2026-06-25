/**
 * Pure HTML builders for the anatomy editor webview (no DOM, no node imports).
 * All role-sourced strings go through escapeHtml before interpolation.
 * Colors are graphite class names only (R2: no var(--vscode-*)).
 *
 * Structure mirrors the approved Claude Design prototype agent form
 * (Maestro-prototype.html lines 644-793): a left "anatomy" sub-rail of status
 * dots and a single scroll canvas (NOT tabs) of Identity / Soul / Instructions /
 * Tools / Skills / Engine / Autonomy. Soul and Instructions are twin markdown
 * file-cards with contrasting "who it is" vs "what it does" helper eyebrows; the
 * Tools grid is grouped Built-in / MCP with a read (green) / write (amber, off by
 * default) split and an "N granted, M can write" summary.
 */

import { escapeHtml } from "./html.js";
import type { AnatomyVM } from "./anatomy-protocol.js";
import type { GrantGap } from "@maestro/config";

// ─── Built-in tool rows ───────────────────────────────────────────────────────

/** The five built-in tools the anatomy tools grid renders. */
const BUILTIN_READ_TOOLS = ["Read", "Search"] as const;
const BUILTIN_WRITE_TOOLS = ["Edit", "Run", "Git"] as const;
const ALL_BUILTIN_TOOLS = [...BUILTIN_READ_TOOLS, ...BUILTIN_WRITE_TOOLS] as const;

// ─── Engine choices (pills) ───────────────────────────────────────────────────

/** Engine ids offered as selectable pills. The active one is whatever vm.engineId holds.
 *  Matches the dispatch engine set (copilot/acp/gemini/claude/codex). */
const ENGINE_CHOICES = ["copilot", "acp", "gemini", "claude", "codex"] as const;

// The engine ids that actually have a registered adapter and can be written to a
// role. MUST mirror @maestro/config KNOWN_ENGINE_IDS. Kept local (not imported)
// so this webview-bundled module never pulls config runtime into the browser
// bundle. The other ENGINE_CHOICES are shown as "soon" and are not selectable.
const SUPPORTED_ENGINE_IDS = new Set<string>(["copilot", "acp"]);

// ─── Inline SVG glyphs (prototype) ────────────────────────────────────────────

/** Pulse/vitals icon shown before the identity vitals line (prototype line 675). */
const PULSE_SVG =
  '<svg class="anatomy-vitals-icon" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 12h4l2 6 4-14 2 8h6"/></svg>';

/** Small link/usage icon shown next to each skill chip (prototype line 761). */
const SKILL_USAGE_SVG =
  '<svg class="anatomy-skill-usage-icon" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M9 15l6-6"/><path d="M11 6l1-1a4 4 0 015.7 5.7l-1 1"/><path d="M13 18l-1 1a4 4 0 01-5.7-5.7l1-1"/></svg>';

// ─── Rail ─────────────────────────────────────────────────────────────────────

/** The seven sections in the anatomy rail, in order. */
const RAIL_SECTIONS = [
  { id: "identity", label: "Identity" },
  { id: "soul", label: "Soul" },
  { id: "instructions", label: "Instructions" },
  { id: "tools", label: "Tools" },
  { id: "skills", label: "Skills" },
  { id: "engine", label: "Engine" },
  { id: "autonomy", label: "Autonomy" },
] as const;

/**
 * Renders the left anatomy sub-rail: an "ANATOMY" mono eyebrow above one row per
 * section. Each row gets a status dot ("filled" class when that section has
 * content, hollow otherwise) and a label. The `data-section` attribute on each
 * row drives scroll-to-section in the client.
 */
export function renderAnatomyRail(vm: AnatomyVM): string {
  const filled = new Set<string>();

  if (vm.roleName) filled.add("identity");
  if (vm.soulName) filled.add("soul");
  if (vm.instructions) filled.add("instructions");
  if (vm.toolsSummary.granted > 0) filled.add("tools");
  if (vm.skills.length > 0) filled.add("skills");
  if (vm.engineId) filled.add("engine");
  if (vm.autonomy) filled.add("autonomy");

  const rows = RAIL_SECTIONS.map((section) => {
    const dotClass = filled.has(section.id) ? "anatomy-dot filled" : "anatomy-dot";
    return `<div class="anatomy-rail-row" data-section="${section.id}">
  <span class="${dotClass}"></span>
  <span class="anatomy-rail-label">${section.label}</span>
</div>`;
  });

  return `<nav class="anatomy-rail">
  <div class="anatomy-rail-eyebrow">ANATOMY</div>
  <div class="anatomy-rail-rows">${rows.join("")}</div>
</nav>`;
}

// ─── Canvas helpers ───────────────────────────────────────────────────────────

/**
 * A section eyebrow: the uppercase mono label, plus an optional contextual
 * "hint" (who it is / what it does / what it can touch) and an optional right
 * aligned summary slot. None of these come from role data, so no escaping needed.
 */
function renderEyebrow(label: string, hint?: string, summaryHtml?: string): string {
  const hintHtml = hint ? `<span class="anatomy-eyebrow-hint">${hint}</span>` : "";
  const summary = summaryHtml ?? "";
  return `<div class="anatomy-eyebrow">
  <span class="anatomy-eyebrow-label">${label}</span>
  ${hintHtml}
  ${summary}
</div>`;
}

/**
 * Renders the sliding on/off toggle (track + knob) that controls a tool's read
 * grant, matching the prototype control metaphor (lines 725-729). The real grant
 * state lives on a nested checkbox so an existing router can still read the
 * input by name; the track/knob are CSS-driven off that checkbox's :checked.
 *
 * @param name - The tool or server identifier (used on data-tool).
 * @param checked - Whether read is granted (the toggle is on).
 * @param isMcp - When true, tags the input data-mcp="1" like the prior renderer.
 */
function renderReadToggle(name: string, checked: boolean, isMcp: boolean): string {
  const onClass = checked ? " on" : "";
  const checkedAttr = checked ? " checked" : "";
  const mcpAttr = isMcp ? ` data-mcp="1"` : "";
  return `<label class="anatomy-tool-toggle${onClass}">
    <input type="checkbox" class="anatomy-tool-read-input" data-tool="${name}" data-mode="read"${mcpAttr} title="Grant ${name} read"${checkedAttr} />
    <span class="anatomy-tool-toggle-track"><span class="anatomy-tool-toggle-knob"></span></span>
  </label>`;
}

/**
 * Renders the separate amber "write" badge that grants write independently of
 * read (prototype lines 728-729). When write is on it shows a small amber dot.
 * The grant state is held by a nested checkbox so the router can still read it.
 *
 * @param name - The tool or server identifier (used on data-tool).
 * @param checked - Whether write is granted.
 * @param isMcp - When true, tags the input data-mcp="1".
 */
function renderWriteBadge(name: string, checked: boolean, isMcp: boolean): string {
  const onClass = checked ? " on" : "";
  const checkedAttr = checked ? " checked" : "";
  const mcpAttr = isMcp ? ` data-mcp="1"` : "";
  return `<label class="anatomy-tool-write amber${onClass}">
    <input type="checkbox" class="anatomy-tool-write-input" data-tool="${name}" data-mode="write"${mcpAttr} title="Grant ${name} write"${checkedAttr} />
    <span class="anatomy-write-dot"></span>write
  </label>`;
}

/**
 * Sliding WRITE toggle: the same control metaphor as the read toggle, amber when
 * on. Used for write-capable built-ins (Edit/Run/Git), which have NO read grant
 * in the model (`read` accepts only Read/Search), so their single control is
 * write. The grant state is the nested checkbox; the track/knob are :checked-driven.
 */
function renderWriteToggle(name: string, checked: boolean, isMcp: boolean): string {
  const onClass = checked ? " on" : "";
  const checkedAttr = checked ? " checked" : "";
  const mcpAttr = isMcp ? ` data-mcp="1"` : "";
  return `<label class="anatomy-tool-toggle anatomy-tool-toggle--write${onClass}">
    <input type="checkbox" class="anatomy-tool-write-input" data-tool="${name}" data-mode="write"${mcpAttr} title="Grant ${name} write"${checkedAttr} />
    <span class="anatomy-tool-toggle-track"><span class="anatomy-tool-toggle-knob"></span></span>
  </label>`;
}

/**
 * Renders one built-in tool row. Each built-in has exactly ONE capability:
 * Read/Search are read-only (green read toggle), Edit/Run/Git are write-only
 * (amber write toggle). A write-only tool MUST NOT offer a read grant — the
 * config model rejects e.g. "Edit" under `read` ("Edit is not a valid read
 * builtin") — so it renders a WRITE toggle, never a read toggle. The trailing
 * placeholder keeps the 4-column grid aligned.
 */
function renderBuiltinToolRow(
  name: string,
  isWriteTool: boolean,
  hasRead: boolean,
  hasWrite: boolean
): string {
  if (isWriteTool) {
    return `<div class="anatomy-tool-row" data-tool="${name}">
  ${renderWriteToggle(name, hasWrite, false)}
  <span class="anatomy-tool-name">${escapeHtml(name)}</span>
  <span class="anatomy-tool-write-badge">write</span>
  <span class="anatomy-tool-write-placeholder"></span>
</div>`;
  }
  return `<div class="anatomy-tool-row" data-tool="${name}">
  ${renderReadToggle(name, hasRead, false)}
  <span class="anatomy-tool-name">${escapeHtml(name)}</span>
  <span class="anatomy-tool-read-badge green">read</span>
  <span class="anatomy-tool-write-placeholder"></span>
</div>`;
}

// ─── Canvas ───────────────────────────────────────────────────────────────────

/**
 * Renders the single scroll canvas (NOT tabs): Identity, Soul, Instructions,
 * Tools, Skills, Engine, and Autonomy sections in order.
 * Every role-sourced string is escaped.
 */
export function renderAnatomyCanvas(vm: AnatomyVM): string {
  // ── Identity block: name (Manrope) + a mono vitals line led by a pulse icon
  const identityBlock = `<section class="anatomy-section" data-section="identity">
  ${renderEyebrow("IDENTITY")}
  <div class="anatomy-identity-name">${escapeHtml(vm.roleName)}</div>
  <div class="anatomy-identity-meta">
    ${PULSE_SVG}
    <span class="anatomy-vitals-text">${escapeHtml(vm.engineId)} · ${escapeHtml(vm.autonomy)}</span>
  </div>
</section>`;

  // ── Soul: "who it is" twin editor (constant, travels with the agent)
  const soulBlock = `<section class="anatomy-section" data-section="soul">
  ${renderEyebrow("SOUL", "who it is")}
  <p class="anatomy-helper">Soul is the constant. It travels with the agent across every task: principles, voice, red lines. Leave the task to Instructions.</p>
  <div class="anatomy-textarea-card">
    <div class="anatomy-textarea-card-bar">
      <span class="anatomy-file-glyph">&#9789;</span>
      <span class="anatomy-file-name">soul.md</span>
    </div>
    <textarea class="anatomy-textarea" data-action="role-set-soul" placeholder="# Principles&#10;- ...">${escapeHtml(vm.soulBody)}</textarea>
  </div>
  <div class="anatomy-file-footer">saved as soul.md</div>
</section>`;

  // ── Instructions: "what it does" twin editor (changes per job)
  const instructionsBlock = `<section class="anatomy-section" data-section="instructions">
  ${renderEyebrow("INSTRUCTIONS", "what it does")}
  <p class="anatomy-helper">Instructions are the task. They change per job. Who it is lives in Soul.</p>
  <div class="anatomy-textarea-card">
    <div class="anatomy-textarea-card-bar">
      <span class="anatomy-file-glyph">&#9636;</span>
      <span class="anatomy-file-name">instructions.md</span>
    </div>
    <textarea class="anatomy-textarea" data-action="role-set-instructions" placeholder="What should this agent do this time?">${escapeHtml(vm.instructions)}</textarea>
  </div>
  <div class="anatomy-file-footer">saved as instructions.md</div>
</section>`;

  // ── Tools grid: grouped Built-in / MCP, read (green) + write (amber, off by default)
  const readSet = new Set<string>(vm.tools?.builtins?.read ?? []);
  const writeSet = new Set<string>(vm.tools?.builtins?.write ?? []);

  const toolRows = ALL_BUILTIN_TOOLS.map((name) => {
    const isWriteTool = (BUILTIN_WRITE_TOOLS as readonly string[]).includes(name);
    const hasRead = readSet.has(name);
    const hasWrite = writeSet.has(name);
    return renderBuiltinToolRow(name, isWriteTool, hasRead, hasWrite);
  });

  // MCP rows from the granted mcp entries (if any). Mono names, same toggle/write split.
  const mcpEntries = vm.tools?.mcp ?? [];
  const mcpRows = mcpEntries.map((entry) => {
    const server = escapeHtml(entry.server);
    return `<div class="anatomy-tool-row mcp" data-tool="${server}">
  ${renderReadToggle(server, Boolean(entry.read), true)}
  <span class="anatomy-tool-name mono">${server}</span>
  <span class="anatomy-tool-read-badge green">read</span>
  ${renderWriteBadge(server, Boolean(entry.write), true)}
</div>`;
  });

  const mcpGroup =
    mcpRows.length > 0
      ? `<div class="anatomy-tools-group-label">MCP SERVERS</div>${mcpRows.join("")}`
      : "";

  const canWriteClass = vm.toolsSummary.canWrite > 0 ? " amber" : "";
  const summarySlot = `<div class="anatomy-tools-summary">
  <span class="anatomy-tools-granted">${vm.toolsSummary.granted} granted</span>
  <span class="anatomy-tools-separator"> · </span>
  <span class="anatomy-tools-can-write${canWriteClass}">${vm.toolsSummary.canWrite} can write</span>
</div>`;

  const toolsBlock = `<section class="anatomy-section" data-section="tools">
  ${renderEyebrow("TOOLS", "what it can touch", summarySlot)}
  <div class="anatomy-tools-grid">
    <div class="anatomy-tools-group-label">BUILT-IN</div>
    ${toolRows.join("")}
    ${mcpGroup}
    <div class="anatomy-tools-connect">
      <span class="anatomy-tools-connect-plus">+</span>
      <span class="anatomy-tools-connect-label">Connect a server...</span>
    </div>
  </div>
  <p class="anatomy-helper anatomy-tools-note">Off by default is safe. Write is granted separately from read.</p>
</section>`;

  // ── Skills: removable chips (diamond glyph) + a per-skill usage link + Add action
  const skillChips = vm.skills.map((s) => {
    const escName = escapeHtml(s.name);
    // Usage link/count affordance the prototype shows next to each chip (line 761).
    // The numeric count is not on the VM yet, so the icon links to usage without
    // a hardcoded number. data-action is a placeholder until wiring lands.
    const usageLink = `<span class="anatomy-skill-usage" data-action="skill-usage" data-skill="${escName}" title="Where ${escName} is used">${SKILL_USAGE_SVG}</span>`; // TODO(next-pass): wire skill-usage
    return `<span class="anatomy-skill-chip" data-skill="${escName}">
  <span class="anatomy-skill-glyph">&#9670;</span>
  <span class="anatomy-skill-name">${escName}</span>
  ${usageLink}
  <span class="anatomy-skill-remove" data-action="remove-skill" data-skill="${escName}" title="Remove ${escName}">&#10005;</span>
</span>`;
  });

  const skillsSummary = `<span class="anatomy-skills-count">${vm.skills.length} attached</span>`;

  // In-editor skill picker: a HIDDEN container toggled open under "+ Add skill",
  // listing every known skill NOT yet attached to this role (vm.availableSkills).
  // Each row attaches on click; the empty state is a single muted, non-clickable
  // row. Names and tool hints are escaped before interpolation.
  const available = vm.availableSkills ?? [];
  let pickerRows: string;
  if (available.length === 0) {
    // No attachable skills: nothing exists to attach, or all known skills are
    // already on this role. A muted, non-clickable row tells the user which.
    const emptyText = vm.skills.length > 0 ? "All skills attached." : "No skills available.";
    pickerRows = `<div class="anatomy-skill-picker-empty">${emptyText}</div>`;
  } else {
    pickerRows = available
      .map((s) => {
        const escName = escapeHtml(s.name);
        const tools = s.allowedTools ?? [];
        const hint =
          tools.length > 0
            ? `<span class="anatomy-skill-picker-hint">${escapeHtml(tools.join(", "))}</span>`
            : "";
        return `<div class="anatomy-skill-picker-row" data-action="anatomy-attach-skill" data-skill="${escName}">
  <span class="anatomy-skill-picker-glyph">&#9670;</span>
  <span class="anatomy-skill-picker-name">${escName}</span>
  ${hint}
</div>`;
      })
      .join("");
  }

  const skillsBlock = `<section class="anatomy-section" data-section="skills">
  ${renderEyebrow("SKILLS", "reusable procedures", skillsSummary)}
  <div class="anatomy-skills-list">
    ${skillChips.join("")}
    <span class="anatomy-skill-add" data-action="add-skill">+ Add skill</span>
  </div>
  <div class="anatomy-skill-picker" data-skill-picker hidden>
    ${pickerRows}
  </div>
</section>`;

  // ── Engine pills: one pill per known engine, active = vm.engineId. Only engines
  // with a registered adapter (SUPPORTED_ENGINE_IDS) are selectable; the rest are
  // rendered disabled with a "soon" badge so a click never reaches the host's
  // refuse-to-write guard.
  const enginePills = ENGINE_CHOICES.map((id) => {
    if (!SUPPORTED_ENGINE_IDS.has(id)) {
      // Not a registered engine yet: render disabled with a "soon" badge so a
      // click does nothing instead of triggering the host's refuse-to-write error.
      return `<button class="anatomy-engine-pill anatomy-engine-pill--soon" type="button" disabled aria-disabled="true" title="${id} is not available yet">${id}<span class="anatomy-engine-soon">soon</span></button>`;
    }
    const activeClass = vm.engineId === id ? " active" : "";
    const label = vm.engineId === id && vm.model ? `${id} / ${escapeHtml(vm.model)}` : id;
    return `<button class="anatomy-engine-pill${activeClass}" type="button" data-action="role-set-engine" data-engine="${id}">${label}</button>`;
  });

  // If the active engine is not in the known list, still show it so it is never lost.
  // A saved-but-unsupported engine cannot be re-written either, so render it as a
  // non-clickable display pill (no data-action/data-engine) instead of triggering
  // the host's refuse-to-write error. A supported-but-undisplayed engine stays
  // interactive.
  if (!(ENGINE_CHOICES as readonly string[]).includes(vm.engineId)) {
    const label = vm.model ? `${escapeHtml(vm.engineId)} / ${escapeHtml(vm.model)}` : escapeHtml(vm.engineId);
    const supported = SUPPORTED_ENGINE_IDS.has(vm.engineId);
    enginePills.unshift(
      supported
        ? `<button class="anatomy-engine-pill active" type="button" data-action="role-set-engine" data-engine="${escapeHtml(vm.engineId)}">${label}</button>`
        : `<button class="anatomy-engine-pill active anatomy-engine-pill--soon" type="button" disabled aria-disabled="true" title="${escapeHtml(vm.engineId)} is not available yet">${label}</button>`
    );
  }

  const engineBlock = `<section class="anatomy-section" data-section="engine">
  ${renderEyebrow("ENGINE")}
  <div class="anatomy-engine-pills">${enginePills.join("")}</div>
</section>`;

  // ── Autonomy: segmented control
  const autonomyOptions: Array<{ value: string; label: string }> = [
    { value: "manual", label: "Manual" },
    { value: "auto-approve-safe", label: "Auto-approve safe" },
    { value: "yolo", label: "Yolo" },
  ];

  const autonomyButtons = autonomyOptions.map((opt) => {
    const activeClass = vm.autonomy === opt.value ? " active" : "";
    return `<button class="anatomy-autonomy-btn${activeClass}" data-action="role-set-autonomy" data-value="${opt.value}">${opt.label}</button>`;
  });

  const autonomyBlock = `<section class="anatomy-section" data-section="autonomy">
  ${renderEyebrow("AUTONOMY")}
  <div class="anatomy-autonomy-control">${autonomyButtons.join("")}</div>
  <p class="anatomy-helper">Auto-approve safe runs read-only tools without asking, and pauses for anything that can write.</p>
</section>`;

  // ── Modal chrome: a header (title + close) and a Cancel / Save footer bar.
  // The prototype frames the anatomy form as a modal (lines 648-789). There are
  // no existing close/save verbs in the anatomy protocol, so these carry
  // placeholder data-action verbs to be wired in a later pass.
  const titleText = vm.roleName ? `${escapeHtml(vm.roleName)} anatomy` : "Agent anatomy";
  const header = `<header class="anatomy-header">
  <span class="anatomy-header-title">${titleText}</span>
  <button class="anatomy-header-close" data-action="anatomy-close" title="Close" aria-label="Close">&#215;</button>
</header>`; // TODO(next-pass): wire anatomy-close

  const footer = `<footer class="anatomy-footer">
  <button class="anatomy-footer-cancel" data-action="anatomy-cancel">Cancel</button>
  <button class="anatomy-footer-save" data-action="anatomy-save">Save agent</button>
</footer>`; // TODO(next-pass): wire anatomy-cancel / anatomy-save

  return `<div class="anatomy-canvas">
${header}
<div class="anatomy-canvas-body">
${identityBlock}
${soulBlock}
${instructionsBlock}
${toolsBlock}
${skillsBlock}
${engineBlock}
${autonomyBlock}
</div>
${footer}
</div>`;
}

// ─── Grant gate ───────────────────────────────────────────────────────────────

/**
 * Renders the inline amber grant-gate expansion for a skill whose attach needs a
 * tool grant. Shows what is missing and offers three explicit choices: grant,
 * attach-without-granting, or cancel. NO silent grant.
 *
 * @param skillName - The skill that needs a grant.
 * @param gap - The computed GrantGap (caller guarantees gap is non-null).
 * @param roleName - The role receiving the skill (used on data-role).
 */
export function renderGrantGate(skillName: string, gap: GrantGap, roleName: string): string {
  // Build copy describing the missing grants (write is the most critical gap)
  const allMissing = [
    ...gap.missingWrite.map((t) => `${t}(write)`),
    ...gap.missingRead,
    ...gap.missingMcp.map((s) => `mcp:${s}`),
  ];

  const missingList = allMissing.map(escapeHtml).join(", ");

  // The primary grant button targets the first missing write tool (most likely single)
  const primaryTool = gap.missingWrite[0] ?? gap.missingRead[0] ?? gap.missingMcp[0] ?? "";
  const isWrite = gap.missingWrite.length > 0;
  const grantLabel = isWrite
    ? `Grant ${escapeHtml(primaryTool)}(write)`
    : `Grant ${escapeHtml(primaryTool)}`;

  return `<div class="anatomy-grant-gate amber-border" data-skill="${escapeHtml(skillName)}" data-role="${escapeHtml(roleName)}">
  <div class="anatomy-grant-gate-head">
    <span class="anatomy-grant-gate-glyph">&#9670;</span>
    <span class="anatomy-grant-gate-title">Grant required</span>
  </div>
  <p class="anatomy-grant-gate-copy">
    <strong>${escapeHtml(skillName)}</strong> needs ${escapeHtml(missingList)}.
    This agent does not have it yet.
  </p>
  <div class="anatomy-grant-gate-actions">
    <button class="anatomy-grant-btn" data-action="grant" data-skill="${escapeHtml(skillName)}" data-tool="${escapeHtml(primaryTool)}" data-write="${isWrite}">${grantLabel}</button>
    <button class="anatomy-attach-btn" data-action="attach-anyway" data-skill="${escapeHtml(skillName)}">Attach without granting</button>
    <button class="anatomy-cancel-btn" data-action="cancel-grant" data-skill="${escapeHtml(skillName)}">Cancel</button>
  </div>
</div>`;
}
