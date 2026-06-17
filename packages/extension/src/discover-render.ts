/**
 * Pure HTML builders for the Discover tab webview (no DOM, no node imports).
 * All discovered/user-supplied strings go through escapeHtml before interpolation.
 * Colors are graphite CSS class names only (no var(--vscode-*)).
 */

import { escapeHtml } from "./html.js";
import type { DiscoverVM, DiscoverCardVM } from "./discover-view.js";

// ─── Card renderer ────────────────────────────────────────────────────────────

/**
 * Renders a single discover card article.
 * The marketplace placeholder card (id === "__marketplace__") renders as
 * discover-card-marketplace with no action buttons.
 */
function renderDiscoverCard(card: DiscoverCardVM): string {
  const isMarketplace = card.id === "__marketplace__";
  const escapedId = escapeHtml(card.id);
  const escapedName = escapeHtml(card.name);
  const escapedDesc = escapeHtml(card.description);
  const escapedBadge = escapeHtml(card.sourceBadge);

  if (isMarketplace) {
    return `<article class="discover-card discover-card-marketplace" data-item-id="${escapedId}">
  <header class="discover-card-header">
    <span class="discover-card-name">${escapedName}</span>
    <span class="discover-source-badge">${escapedBadge}</span>
  </header>
  <p class="discover-card-desc">${escapedDesc}</p>
</article>`;
  }

  // Confidence indicator class
  const confidenceClass = `discover-confidence confidence-${card.confidence}`;

  // Skill chips (up to 4 shown, overflow shown as "+N more")
  const chipHtml = card.skillChips
    .map((chip) => `<span class="discover-skill-chip">${escapeHtml(chip)}</span>`)
    .join("");
  const overflowHtml =
    card.overflowSkills > 0
      ? `<span class="discover-overflow">+${card.overflowSkills} more</span>`
      : "";
  const skillsSection = `<div class="discover-skill-chips">${chipHtml}${overflowHtml}</div>`;

  // Action buttons
  const browseBtn = `<button class="discover-btn" data-action="browse-source" data-item-id="${escapedId}">Browse</button>`;

  const dispatchBtn = card.canDispatch
    ? `<button class="discover-btn discover-btn-dispatch" data-action="discover-dispatch" data-item-id="${escapedId}">Dispatch</button>`
    : "";

  const adoptAction = card.isSkill ? "adopt-skill" : "adopt-agent";
  const adoptBtn = card.canAdopt
    ? `<button class="discover-btn discover-btn-adopt" data-action="${adoptAction}" data-item-id="${escapedId}">Adopt</button>`
    : "";

  return `<article class="discover-card" data-item-id="${escapedId}">
  <header class="discover-card-header">
    <span class="discover-card-name">${escapedName}</span>
    <span class="discover-source-badge">${escapedBadge}</span>
    <span class="${confidenceClass}">&#9679;</span>
    <span class="discover-engine">${card.engineId}</span>
  </header>
  <p class="discover-card-desc">${escapedDesc}</p>
  ${skillsSection}
  <footer class="discover-card-actions">
    ${browseBtn}
    ${dispatchBtn}
    ${adoptBtn}
  </footer>
</article>`;
}

// ─── Group renderer ───────────────────────────────────────────────────────────

/**
 * Renders a collapsible group section with a summary showing label and count,
 * and all cards within.
 */
function renderDiscoverGroup(group: {
  group: string;
  label: string;
  count: number;
  cards: DiscoverCardVM[];
}): string {
  const cardsHtml = group.cards.map(renderDiscoverCard).join("");
  return `<details class="discover-group" open>
  <summary class="discover-group-summary">
    <span class="discover-group-label">${escapeHtml(group.label)}</span>
    <span class="discover-group-count">${group.count}</span>
  </summary>
  <div class="discover-group-cards">${cardsHtml}</div>
</details>`;
}

// ─── Tab renderer ─────────────────────────────────────────────────────────────

/**
 * Renders the full Discover tab HTML.
 *
 * Includes:
 * - A scanning banner when vm.scanning is true
 * - An error banner when vm.scanError is set
 * - A sticky header with Scan-repo button, four filter chips, and a text filter
 * - All groups that have cards (collapsible details/summary)
 */
export function renderDiscoverTab(vm: DiscoverVM): string {
  // Scanning banner
  const scanningBanner = vm.scanning
    ? `<div class="discover-scanning">Scanning repository...</div>`
    : "";

  // Error banner
  const errorBanner = vm.scanError
    ? `<div class="discover-error">${escapeHtml(vm.scanError)}</div>`
    : "";

  // Scan-repo button (disabled while scanning)
  const scanBtnDisabled = vm.scanning ? " disabled" : "";
  const scanBtn = `<button class="discover-scan-btn" data-action="scan-repo"${scanBtnDisabled}>Scan repo</button>`;

  // Filter chips
  const chips = [
    { label: "All", chip: "all", extra: "" },
    { label: "In this repo", chip: "in-repo", extra: "" },
    { label: "Plugins", chip: "plugins", extra: "" },
    { label: "Marketplace", chip: null, extra: " dimmed" },
  ]
    .map(({ label, chip, extra }) => {
      const dataChip = chip !== null ? ` data-chip="${chip}"` : "";
      return `<button class="discover-chip${extra}"${dataChip}>${label}</button>`;
    })
    .join("");

  // Text filter input
  const filterInput = `<input class="discover-filter" type="text" placeholder="Filter..." data-action="discover-filter" />`;

  // Sticky header
  const header = `<div class="discover-header">
  ${scanBtn}
  <div class="discover-chips">${chips}</div>
  ${filterInput}
</div>`;

  // Groups - render all groups that have cards
  const groupsHtml = vm.groups
    .filter((g) => g.cards.length > 0)
    .map(renderDiscoverGroup)
    .join("");

  return `<div class="discover-tab">
${scanningBanner}${errorBanner}${header}
<div class="discover-groups">${groupsHtml}</div>
</div>`;
}

// ─── Browse drawer ────────────────────────────────────────────────────────────

/**
 * Renders a minimal browse drawer showing a card's source details.
 */
export function renderBrowseDrawer(card: DiscoverCardVM): string {
  const skillsContent =
    card.skillChips.length > 0
      ? card.skillChips.map((chip) => `<span class="browse-skill-chip">${escapeHtml(chip)}</span>`).join("")
      : "None declared";

  return `<div class="browse-drawer">
  <h3 class="browse-title">${escapeHtml(card.name)}</h3>
  <div class="browse-source-path">${escapeHtml(card.sourceBadge)}</div>
  <div class="browse-desc">${escapeHtml(card.description)}</div>
  <div class="browse-skills">
    <strong>Declared tools:</strong>
    ${skillsContent}
  </div>
</div>`;
}
