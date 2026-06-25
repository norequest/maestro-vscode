/**
 * Pure HTML builders for the Discover tab webview (no DOM, no node imports).
 * All discovered/user-supplied strings go through escapeHtml before interpolation.
 * Colors are graphite CSS class names only (no var(--vscode-*)); the webview CSP
 * forbids inline style, so every visual is a CSS class. The DOM structure mirrors
 * the approved Discover prototype in docs/design-reference.
 */

import { escapeHtml } from "./html.js";
import type { DiscoverVM, DiscoverCardVM, DiscoverGroup } from "./discover-view.js";

// ─── Group metadata (path hints + subtitles match the prototype) ──────────────

const GROUP_META: Record<
  DiscoverGroup,
  { pathHint: string; subtitle: string }
> = {
  "in-repo": {
    pathHint: ".claude/agents · .hallucinate/roles · AGENTS.md · copilot-instructions",
    subtitle: "Definitions committed in your workspace",
  },
  plugins: {
    pathHint: "Copilot plugins",
    subtitle: "Custom agents from plugins you've installed",
  },
  instructions: {
    pathHint: "AGENTS.md · copilot-instructions",
    subtitle: "Inferred from instruction files",
  },
  marketplace: {
    pathHint: "",
    subtitle: "Community-published agents, coming soon",
  },
};

const CONFIDENCE_LABELS: Record<DiscoverCardVM["confidence"], string> = {
  verified: "verified",
  likely: "likely",
  instructions: "instructions",
};

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
  <div class="discover-card-rail" aria-hidden="true"></div>
  <header class="discover-card-header">
    <span class="discover-card-name" title="${escapedName}">${escapedName}</span>
    <span class="discover-source-badge">${escapedBadge}</span>
  </header>
  <p class="discover-card-desc">${escapedDesc}</p>
</article>`;
  }

  // Confidence trio: green verified / amber likely / grey instructions.
  const confidenceClass = `discover-confidence confidence-${card.confidence}`;
  const confidenceLabel = CONFIDENCE_LABELS[card.confidence];
  // A green check precedes the label only for the verified tier.
  const confidenceTick =
    card.confidence === "verified"
      ? `<span class="discover-conf-tick" aria-hidden="true">&#10003;</span>`
      : "";

  // Source badge: plugin items show a square glyph, repo items a file glyph.
  const badgeGlyph = card.sourceBadge.startsWith("Plugin")
    ? `<span class="discover-badge-glyph plugin" aria-hidden="true"></span>`
    : `<span class="discover-badge-glyph file" aria-hidden="true"></span>`;

  // Skill chips (up to 4 shown, overflow shown as "+N more").
  const chipHtml = card.skillChips
    .map((chip) => `<span class="discover-skill-chip">${escapeHtml(chip)}</span>`)
    .join("");
  const overflowHtml =
    card.overflowSkills > 0
      ? `<span class="discover-overflow">+${card.overflowSkills} more</span>`
      : "";
  const skillsSection =
    card.skillChips.length > 0 || card.overflowSkills > 0
      ? `<div class="discover-skill-chips">${chipHtml}${overflowHtml}</div>`
      : `<div class="discover-skill-none">Skills, none bundled</div>`;

  // Action row: Adopt primary (green check on adopt), Dispatch secondary,
  // Browse borderless text button.
  const browseBtn = `<button class="discover-btn discover-btn-browse" data-action="browse-source" data-item-id="${escapedId}">Browse</button>`;

  const dispatchBtn = card.canDispatch
    ? `<button class="discover-btn discover-btn-dispatch" data-action="discover-dispatch" data-item-id="${escapedId}">Dispatch</button>`
    : "";

  // Adopt is a BORDERED/secondary button by default (matching Dispatch); once
  // adopted, the `.adopted` class gives the green tick + green treatment and the
  // button goes inert (no data-action, disabled) and reads "Adopted".
  const adoptAction = card.isSkill ? "adopt-skill" : "adopt-agent";
  const adoptBtn = card.canAdopt
    ? card.adopted
      ? `<button class="discover-btn discover-btn-adopt adopted" data-item-id="${escapedId}" disabled><span class="discover-adopt-check" aria-hidden="true">&#10003;</span>Adopted</button>`
      : `<button class="discover-btn discover-btn-adopt" data-action="${adoptAction}" data-item-id="${escapedId}"><span class="discover-adopt-check" aria-hidden="true">&#10003;</span>Adopt</button>`
    : "";

  return `<article class="discover-card" data-item-id="${escapedId}">
  <div class="discover-card-rail" aria-hidden="true"></div>
  <header class="discover-card-header">
    <span class="discover-card-name" title="${escapedName}">${escapedName}</span>
    <span class="discover-source-badge">${badgeGlyph}${escapedBadge}</span>
  </header>
  <div class="discover-card-engine-row">
    <span class="discover-engine">${escapeHtml(card.engineId)}</span>
    <span class="discover-card-confidence">${confidenceTick}<span class="${confidenceClass}" aria-hidden="true">&#9679;</span><span class="discover-conf-label">${confidenceLabel}</span></span>
  </div>
  <p class="discover-card-desc">${escapedDesc}</p>
  ${skillsSection}
  <footer class="discover-card-actions">
    ${adoptBtn}
    ${dispatchBtn}
    ${browseBtn}
  </footer>
</article>`;
}

// ─── Group renderer ───────────────────────────────────────────────────────────

/**
 * Renders a collapsible group section with the prototype's header row
 * (chevron + label + count + path hint), a subtitle, and the card grid.
 * The marketplace group is rendered with a SOON badge and a dashed placeholder.
 */
function renderDiscoverGroup(group: {
  group: DiscoverGroup;
  label: string;
  count: number;
  cards: DiscoverCardVM[];
}): string {
  const meta = GROUP_META[group.group];
  const isMarketplace = group.group === "marketplace";
  const cardsHtml = group.cards.map(renderDiscoverCard).join("");

  if (isMarketplace) {
    return `<details class="discover-group discover-group-marketplace" data-group="${group.group}" open>
  <summary class="discover-group-summary">
    <span class="discover-group-chevron" aria-hidden="true"></span>
    <span class="discover-group-label">${escapeHtml(group.label)}</span>
    <span class="discover-group-soon">SOON</span>
  </summary>
  <div class="discover-group-subtitle">${escapeHtml(meta.subtitle)}</div>
  <div class="discover-group-cards">${cardsHtml}</div>
</details>`;
  }

  const pathHint = meta.pathHint
    ? `<span class="discover-group-path">${escapeHtml(meta.pathHint)}</span>`
    : "";

  return `<details class="discover-group" data-group="${group.group}" open>
  <summary class="discover-group-summary">
    <span class="discover-group-chevron" aria-hidden="true"></span>
    <span class="discover-group-label">${escapeHtml(group.label)}</span>
    <span class="discover-group-count">${group.count}</span>
    ${pathHint}
  </summary>
  <div class="discover-group-subtitle">${escapeHtml(meta.subtitle)}</div>
  <div class="discover-group-cards">${cardsHtml}</div>
</details>`;
}

// ─── Tab renderer ─────────────────────────────────────────────────────────────

/**
 * Renders the full Discover tab HTML, matching the prototype:
 * - A scanning banner when vm.scanning is true
 * - An error banner when vm.scanError is set
 * - A sticky header: "Discover agents" title (Manrope 700) + subtitle on the
 *   left, "Scanned" timestamp + Scan-repo button on the right, then the source
 *   chips (All / In this repo / Plugins / Marketplace dimmed) + a text filter
 * - All groups that have cards (collapsible), plus the always-present marketplace
 */
export function renderDiscoverTab(vm: DiscoverVM): string {
  // Scanning banner.
  const scanningBanner = vm.scanning
    ? `<div class="discover-scanning">Scanning repository...</div>`
    : "";

  // Error banner.
  const errorBanner = vm.scanError
    ? `<div class="discover-error">${escapeHtml(vm.scanError)}</div>`
    : "";

  // Scan-repo button (disabled while scanning).
  const scanBtnDisabled = vm.scanning ? " disabled" : "";
  const scanBtn = `<button class="discover-scan-btn" data-action="scan-repo"${scanBtnDisabled}><span class="discover-scan-bars" aria-hidden="true"><span></span><span></span><span></span><span></span></span>Scan repo</button>`;

  // Title block (Manrope 700) + subtitle.
  const titleBlock = `<div class="discover-titlebox">
    <div class="discover-title">Discover agents</div>
    <div class="discover-subtitle">Ready-made agents Hallucinate found. Adopt them, or run one now.</div>
  </div>`;

  // Filter chips, with live counts per the prototype ("All N", "In this repo N",
  // "Plugins N"). Counts come from the VM's group card counts.
  const countOf = (group: DiscoverGroup): number =>
    vm.groups.find((g) => g.group === group)?.cards.length ?? 0;
  const repoCount = countOf("in-repo");
  const pluginsCount = countOf("plugins");
  const instructionsCount = countOf("instructions");
  // "All" spans every real (non-marketplace) group.
  const allCount = repoCount + pluginsCount + instructionsCount;

  const chips = [
    { label: "All", count: allCount, chip: "all", extra: "" },
    { label: "In this repo", count: repoCount, chip: "in-repo", extra: "" },
    { label: "Plugins", count: pluginsCount, chip: "plugins", extra: "" },
    { label: "Marketplace", count: null, chip: null, extra: " dimmed" },
  ]
    .map(({ label, count, chip, extra }) => {
      const dataChip = chip !== null ? ` data-chip="${chip}"` : "";
      const countSpan =
        count !== null ? ` <span class="discover-chip-count">${count}</span>` : "";
      return `<button class="discover-chip${extra}"${dataChip}>${label}${countSpan}</button>`;
    })
    .join("");

  // Text filter input.
  const filterInput = `<input class="discover-filter" type="text" placeholder="Filter..." data-action="discover-filter" />`;

  // Scanned-at label. Use a real scannedAt value from the VM when one is
  // available; otherwise fall back to "just now".
  // TODO: thread a real scannedAt timestamp through selectDiscover/DiscoverVM
  // (the selector does not currently carry one) so this reflects the last scan.
  const scannedAtRaw = (vm as { scannedAt?: string }).scannedAt;
  const scannedAtLabel =
    scannedAtRaw && scannedAtRaw.trim() !== "" ? escapeHtml(scannedAtRaw) : "just now";

  // Sticky header: title row + chip row.
  const header = `<div class="discover-header">
  <div class="discover-header-top">
    ${titleBlock}
    <div class="discover-header-actions">
      <span class="discover-scanned-at">Scanned ${scannedAtLabel}</span>
      ${scanBtn}
    </div>
  </div>
  <div class="discover-header-chips">
    <div class="discover-chips">${chips}</div>
    ${filterInput}
  </div>
</div>`;

  // Groups: render all groups that have cards.
  const visibleGroups = vm.groups.filter((g) => g.cards.length > 0);
  const groupsHtml = visibleGroups.map(renderDiscoverGroup).join("");

  // Empty state: when no REAL (non-marketplace) group has any cards, the user is
  // left looking at only the marketplace placeholder (or nothing). Surface an
  // explicit explanation rather than a blank area. The renderer cannot tell a
  // genuine empty scan apart from a too-strict filter (the VM carries neither the
  // filter string nor a scan-ran flag), so use one neutral message.
  const hasRealCards = vm.groups.some(
    (g) => g.group !== "marketplace" && g.cards.length > 0
  );
  const emptyState = hasRealCards
    ? ""
    : `<div class="discover-empty">No agents to show. Try Scan repo, or clear the filter.</div>`;

  return `<div class="discover-tab">
${scanningBanner}${errorBanner}${header}
<div class="discover-groups">${emptyState}${groupsHtml}</div>
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
