import type { ComposerOptions } from "@hallucinate/cockpit";
import { escapeHtml } from "./html.js";

/** The brand equaliser mark (prototype eqbar) used on the modal header + Dispatch button. */
function eqMark(extraClass = ""): string {
  const cls = extraClass ? `composer-eq ${extraClass}` : "composer-eq";
  return `<span class="${cls}" aria-hidden="true"><i></i><i></i><i></i><i></i></span>`;
}

/**
 * Renders the role preset chips. Compact single-line pills (prototype lines
 * 357-361): the role name only, with the engine carried on data attributes for
 * the picker. The instructions snippet rides a title tooltip so the pill stays
 * on one line.
 */
function renderPresets(options: ComposerOptions): string {
  if (options.presets.length === 0) {
    return `<p class="composer-no-presets">No roles defined in .hallucinate/roles/. Enter a name below to create an ad-hoc role.</p>`;
  }
  const chips = options.presets
    .map(
      (p) =>
        `<button class="composer-chip" data-action="preset" data-role="${escapeHtml(p.roleName)}" data-engine="${escapeHtml(p.engineId)}"${p.model !== undefined ? ` data-model="${escapeHtml(p.model)}"` : ""} title="${escapeHtml(p.instructionsSnippet)}" type="button"><span class="chip-role">${escapeHtml(p.roleName)}</span><span class="chip-engine">${escapeHtml(p.engineId)}</span></button>`,
    )
    .join("");
  return `<div class="composer-presets">${chips}</div>`;
}

/** Renders the engine family + model variant pills. */
function renderEnginePills(options: ComposerOptions): string {
  const pills = options.engines
    .flatMap((family) => {
      // Family pill (no model)
      const familyPill = `<button class="composer-engine-pill" data-action="engine" data-engine="${escapeHtml(family.id)}" type="button">${escapeHtml(family.label)}</button>`;
      // Model variant pills
      const modelPills = family.models.map(
        (m) =>
          `<button class="composer-engine-pill composer-engine-pill--model" data-action="engine" data-engine="${escapeHtml(family.id)}" data-model="${escapeHtml(m)}" type="button">${escapeHtml(family.label)} / ${escapeHtml(m)}</button>`,
      );
      return [familyPill, ...modelPills];
    })
    .join("");
  return `<div class="composer-engine-pills">${pills}</div>`;
}

/**
 * Pure HTML-string renderer for the composer overlay panel.
 * Every role-sourced string (role name, instructions snippet) is run through
 * escapeHtml before being embedded in markup, in both text and attribute context.
 */
export function renderComposerHTML(options: ComposerOptions): string {
  return `<div class="composer-panel" role="dialog" aria-modal="true" aria-label="Dispatch a new agent">
  <header class="composer-header">
    <div class="composer-headline">
      ${eqMark("composer-eq--brand")}
      <div class="composer-heading-text">
        <h2 class="composer-title">Dispatch a new agent</h2>
        <p class="composer-subtitle">Joins the Working lane on branch <span class="composer-branch">main</span></p>
      </div>
    </div>
    <button class="composer-close" data-action="close-composer" type="button" aria-label="Close">&#215;</button>
  </header>

  <div class="composer-body">
    <section class="composer-section">
      <label class="composer-label">Role preset</label>
      ${renderPresets(options)}
      <div class="composer-new-role-row">
        <label class="composer-label composer-label--sub" for="composer-new-role">Or enter an ad-hoc role name</label>
        <input id="composer-new-role" class="composer-input" type="text" placeholder="e.g. Security Reviewer" data-action="new-role" />
      </div>
    </section>

    <section class="composer-section">
      <label class="composer-label">Engine</label>
      ${renderEnginePills(options)}
    </section>

    <section class="composer-section">
      <label class="composer-label" for="composer-goal">Goal <span class="composer-hint">(the why, "so that ...")</span></label>
      <input id="composer-goal" class="composer-input" type="text" placeholder="so that the refactor cannot silently break checkout" data-action="goal" />
    </section>

    <section class="composer-section">
      <label class="composer-label" for="composer-task">Task <span class="composer-required">*</span></label>
      <textarea id="composer-task" class="composer-textarea" rows="4" placeholder="Describe what this agent should do..." data-action="task"></textarea>
    </section>
  </div>

  <footer class="composer-footer">
    <button class="composer-dispatch" data-action="dispatch" type="button" disabled>${eqMark("composer-eq--accent")}Dispatch</button>
    <button class="composer-cancel" data-action="close-composer" type="button">Cancel</button>
  </footer>
</div>`;
}
