/**
 * The single-page app router. ONE webview bundle that mounts board / library /
 * anatomy / review in-place inside `#root`, swapping views via a top-level
 * `view` variable. The host posts state for ALL views into this one panel; the
 * router caches each domain's last state so re-entering a view never blanks.
 *
 * This is a TRANSPORT rewire, not a UI rewrite. Every render call below reuses
 * the existing pure render functions, and every outbound message is the SAME
 * AppToHost (= WebviewToHost | LibraryToHost | AnatomyToHost) message the four
 * old mains posted. The delegation handlers BRANCH ON `view` FIRST so the board
 * drawer's `.tab` never cross-fires with the library `.lib-tab`, etc.
 */

import type {
  CockpitState,
  ComposerOptions,
  DispatchForm,
  CardVM,
} from "@hallucinate/cockpit";
import { buildDispatchMessage, canDispatch, ENGINE_FAMILIES } from "@hallucinate/cockpit";
import type { Autonomy } from "@hallucinate/core";
import { renderBoard, renderDrawer, renderAttentionBar } from "../render.js";
import { renderHistory } from "../render-history.js";
import { nextAttentionIndex } from "../attention-cycle.js";
import { nextIndexForRender, historyChanged, historySignature } from "../render-gate.js";
import { renderComposerHTML } from "../render-composer.js";
import {
  renderLibraryHeader,
  renderSkillsTab,
  renderSkillEditor,
  renderPickerRows,
  renderRoleList,
  renderTeamList,
  renderTeamEditor,
} from "../library-render.js";
import { selectDiscover } from "../discover-view.js";
import type { DiscoverGroup } from "../discover-view.js";
import { renderDiscoverTab } from "../discover-render.js";
import { renderAnatomyRail, renderAnatomyCanvas } from "../anatomy-render.js";
import { renderReviewBody } from "../review-render.js";
import { parseUnifiedDiff } from "../diff-parse.js";
import { escapeHtml } from "../html.js";
import type { LibrarySnapshot, LibraryTab } from "../library-protocol.js";
import type { AnatomyVM } from "../anatomy-protocol.js";
import type { ReviewOpenOpts } from "../review-render.js";
import type { DiscoveredItem, McpInventory } from "@hallucinate/config";
import type { AppToHost, HostToApp, AppView } from "../app-protocol.js";
import type { ToolGrant } from "@hallucinate/core";

type ReadTool = "Read" | "Search";
type WriteTool = "Edit" | "Run" | "Git";

interface VsCodeApi {
  postMessage(msg: AppToHost): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();
const root = document.getElementById("root");

// ─── View + per-domain caches ──────────────────────────────────────────────────

let view: AppView = "board";

// Pending-token guard for the "+ New task" funnel: the board posts new-task and
// the host later replies open-task-composer after an async disk read. If the user
// navigates away (and back) while that funnel is in flight, the late reply must
// NOT pop the task composer over the board. Set true at post time, consumed by
// the open-task-composer handler and cleared on any view change away from board.
let pendingNewTask = false;

// Board.
let lastCockpit: CockpitState = { cards: [], delegations: [] };
let composerForm: DispatchForm = { description: "" };
let activeComposerOptions: ComposerOptions | undefined;
let lastComposerOptions: ComposerOptions | undefined;
// Drawer client-state preserved across `state` re-renders (which blow away the
// DOM via root.innerHTML): the active tab the user picked, and the id of the
// drawer the user explicitly closed (so the next state tick does not re-open it).
let drawerTab = "instructions";
let closedDrawerId: string | null = null;
// Attention bar: which queue item the bar currently shows. Advanced by the
// auto-advance ticker (tickAttention) which re-renders ONLY the bar. PRESERVED
// across board re-renders while the queue is unchanged (lastAttentionSig), so a
// streaming agent's output ticks do not snap it back to index 0 (regression A).
let attentionIndex = 0;
// Signature of the attention queue the bar's index was last rendered for. A
// matching signature on the next board render means the queue is unchanged, so
// attentionIndex is kept (clamped); a differing one resets it to 0.
let lastAttentionSig: string | undefined;
// Signature of the in-session history the History view was last rendered for.
// Lets the live `state` listener skip rebuilding the timeline on output ticks
// (which record no history entry), preserving keyboard focus (regression B).
let lastHistorySig: string | undefined;
// Board layout: the Floor (size+warmth tiles) is the default; the status bar's
// "Status" toggle flips this to the lane columns. Webview-local only (no host
// round-trip), so a layout choice survives every `state` re-render.
let groupByStatus = false;

// Library.
let libraryTab: LibraryTab = "agents";
let lastLibrary: LibrarySnapshot | undefined;
// The tab the library body was LAST rendered for. Compared against the incoming
// tab so the enter-animation runs ONLY on a real tab switch (not on a skill-save
// / team-edit / discover-results refresh that re-renders the same tab).
let lastRenderedLibTab: LibraryTab | undefined;
// Task overlay: the captured submit callback for the shared roomy multi-line task
// entry (team launch). Set when the overlay opens; cleared when it closes.
let taskOverlaySubmit: ((task: string) => void) | undefined;
let editorBody = "";
// Team editor scratch state: the snapshot only carries the OPEN/CLOSED signal
// (editingTeam) and the initial values; the live name/goal/members are tracked
// here so re-renders within the editor do not lose unsaved edits.
let teamDraftName = "";
let teamDraftGoal = "";
let teamDraftMembers: string[] = [];
// Discover (sub-tab of library).
let discoverItems: DiscoveredItem[] = [];
let discoverFilter = "";
let discoverChip: DiscoverGroup | "all" = "all";
let discoverScanning = false;
let discoverMcp: McpInventory = { servers: [] };
let discoverAdopted: string[] = [];

// Anatomy.
let lastAnatomy: AnatomyVM | undefined;
let currentRoleName = "";
let currentEngineModel: string | undefined;

// Review.
let lastReviewCard: CardVM | undefined;
let lastReviewOpts: ReviewOpenOpts = {};

// ─── Render ─────────────────────────────────────────────────────────────────────

function render(): void {
  if (!root) return;
  root.dataset["view"] = view;
  switch (view) {
    case "board":
      renderBoardView();
      break;
    case "library":
      renderLibraryView();
      break;
    case "anatomy":
      renderAnatomyView();
      break;
    case "review":
      renderReviewView();
      break;
    case "history":
      renderHistoryView();
      break;
    default: {
      const _exhaustive: never = view;
      void _exhaustive;
      break;
    }
  }
}

function renderBoardView(): void {
  if (!root) return;
  // renderBoard hardcodes the attention bar at index 0, but a streaming agent
  // posts `state` continuously, so resetting the ticker's index here would snap
  // the bar back to item 1 on every output tick and the auto-advance would never
  // run (regression A). Preserve the index while the attention queue is unchanged
  // (matching signature, clamped to length); only a real queue change resets it.
  const attentionQueue = lastCockpit.attention ?? [];
  const nextAttention = nextIndexForRender(attentionIndex, lastAttentionSig, attentionQueue);
  attentionIndex = nextAttention.index;
  lastAttentionSig = nextAttention.signature;
  // The board shell (tab strip + header + empty lanes + status bar) always
  // renders so "+ New agent" stays reachable even with zero agents.
  root.innerHTML = `${renderBoard(lastCockpit, { groupByStatus })}${renderDrawer(lastCockpit)}`;
  // renderBoard emitted the bar at index 0; swap in the preserved index when it
  // is non-zero (same bar-only re-render tickAttention does, no full re-render).
  if (attentionIndex !== 0) {
    const bar = root.querySelector<HTMLElement>(".attention-bar");
    if (bar) bar.outerHTML = renderAttentionBar(attentionQueue, attentionIndex);
  }
  tickElapsed();
  // The drawer is re-rendered from state every tick (a streaming agent posts
  // `state` continuously). Re-apply the user's client-only drawer choices so a
  // tick never resets the active tab or re-opens a drawer the user just closed.
  if (closedDrawerId !== null && lastCockpit.focusedId === closedDrawerId) {
    // The user closed THIS exact drawer; keep it shut despite the re-render.
    root.querySelector(".drawer")?.remove();
  } else if (closedDrawerId !== null) {
    // Focus moved to a different card (or cleared): the suppression no longer
    // applies, so let the freshly rendered drawer stand.
    closedDrawerId = null;
  }
  applyDrawerTab(root);
  // Re-attach the composer overlay if it was open (innerHTML reset removes it,
  // but the overlay lives on document.body, not #root, so it survives — nothing
  // to do here; left as a note for clarity).
}

/**
 * Re-apply the active drawer tab after a board re-render. renderDrawer always
 * marks "instructions" active, so without this a streaming agent would reset the
 * user's chosen tab (Output / Diff) on every state tick. Mirrors the tab-click
 * handler: toggle `.tab` active + `.tab-body` hidden to match `drawerTab`.
 */
function applyDrawerTab(scope: HTMLElement): void {
  const drawer = scope.querySelector<HTMLElement>(".drawer");
  if (!drawer) return;
  drawer.querySelectorAll<HTMLElement>(".tab").forEach((t) => {
    t.classList.toggle("active", t.dataset["tab"] === drawerTab);
  });
  drawer.querySelectorAll<HTMLElement>(".tab-body").forEach((body) => {
    body.hidden = body.dataset["tab"] !== drawerTab;
  });
}

function renderLibraryView(): void {
  if (!root) return;
  const snap = lastLibrary;
  if (!snap) {
    // First navigation before data arrives: show the header only so the page is
    // never blank. The host's library-state fills in the body shortly. Seed the
    // last-rendered tab so the FIRST populated render does not falsely animate.
    root.innerHTML = `${renderLibraryHeader(libraryTab)}<div class="lib-body"></div>`;
    lastRenderedLibTab = libraryTab;
    return;
  }
  const header = renderLibraryHeader(snap.tab);
  let body = "";
  switch (snap.tab) {
    case "skills":
      body = renderSkillsTab(snap.skills);
      break;
    case "agents":
      body = renderRoleList(snap.roles);
      break;
    case "teams":
      body = renderTeamList(snap.teams);
      break;
    case "discover": {
      const vm = selectDiscover(
        discoverItems,
        discoverFilter,
        discoverChip,
        discoverScanning,
        undefined,
        discoverAdopted,
      );
      body = renderDiscoverTab(vm);
      break;
    }
    default: {
      const _exhaustive: never = snap.tab;
      void _exhaustive;
      body = "";
    }
  }
  const overlay =
    snap.editing !== undefined
      ? renderSkillEditor(snap.editing, editorBody)
      : snap.editingTeam !== undefined
        ? renderTeamEditor(
            { name: teamDraftName, roleNames: teamDraftMembers, goal: teamDraftGoal || undefined },
            snap.roles.map((r) => ({ name: r.name, engineId: r.engineId }))
          )
        : snap.picker !== undefined
          ? renderPickerRows(snap.skills, snap.picker.roleName)
          : "";
  // Animate the body ONLY when the tab actually changed (a real tab switch),
  // never on ordinary refreshes (skill-save, team edits, discover-results) that
  // re-render the SAME tab. An open overlay also suppresses it so opening an
  // editor/picker doesn't re-animate the grid behind it.
  const tabChanged = lastRenderedLibTab !== undefined && lastRenderedLibTab !== snap.tab;
  const overlayOpen =
    snap.editing !== undefined || snap.editingTeam !== undefined || snap.picker !== undefined;
  const bodyClass = tabChanged && !overlayOpen ? "lib-body hallucinate-enter" : "lib-body";
  root.innerHTML = `${header}<div class="${bodyClass}">${body}</div>${overlay}`;
  lastRenderedLibTab = snap.tab;
}

function renderAnatomyView(): void {
  if (!root) return;
  if (!lastAnatomy) {
    root.innerHTML = "";
    return;
  }
  // Preserve scroll across the full innerHTML swap. A re-render triggered by a
  // tool toggle (or any role-set-* round trip that re-posts anatomy-state)
  // otherwise recreates the scroll containers and snaps them back to the top.
  // Capture scrollTop from the OLD DOM (still mounted here), then restore it
  // onto the freshly rendered containers.
  const bodyScroll = root.querySelector<HTMLElement>(".anatomy-canvas-body")?.scrollTop ?? 0;
  const railScroll = root.querySelector<HTMLElement>(".anatomy-rail")?.scrollTop ?? 0;

  root.innerHTML = renderAnatomyRail(lastAnatomy) + renderAnatomyCanvas(lastAnatomy);
  currentRoleName = lastAnatomy.roleName;
  currentEngineModel = lastAnatomy.model;

  const nextBody = root.querySelector<HTMLElement>(".anatomy-canvas-body");
  if (nextBody) nextBody.scrollTop = bodyScroll;
  const nextRail = root.querySelector<HTMLElement>(".anatomy-rail");
  if (nextRail) nextRail.scrollTop = railScroll;
}

function renderReviewView(): void {
  if (!root) return;
  if (!lastReviewCard) {
    root.innerHTML = "";
    return;
  }
  const parsed = parseUnifiedDiff(lastReviewCard.diff?.patch ?? "");
  root.innerHTML = renderReviewBody(lastReviewCard, parsed, lastReviewOpts);
}

/**
 * The in-session History tab. A full-page view rendered from the ALREADY-CACHED
 * board state (lastCockpit): no new host message and no host fetch. Because the
 * timeline is derived from the live cockpit state, the `state` listener re-renders
 * this view too so new events stream in while it is open.
 *
 * Two pieces of DOM glue keep the streamed re-render calm. Scroll is preserved
 * across the innerHTML swap (mirrors renderAnatomyView) so a new event never yanks
 * the operator. And the pure render's `.history-time[data-at]` timestamps are
 * formatted here (render stays pure; formatting is DOM glue). A static HH:MM is
 * enough, so no repeating ticker is needed.
 */
function renderHistoryView(): void {
  if (!root) return;
  const bodyScroll = root.querySelector<HTMLElement>(".history-body")?.scrollTop ?? 0;
  root.innerHTML = renderHistory(lastCockpit);
  // Record what we just rendered so the live `state` listener can skip redundant
  // re-renders (regression B): an output tick adds no history entry, so an
  // unchanged signature means there is nothing new to show and focus is kept.
  lastHistorySig = historySignature(lastCockpit.history ?? []);
  // Format the captured timestamps (render stays pure; formatting is DOM glue).
  root.querySelectorAll<HTMLElement>(".history-time[data-at]").forEach((el) => {
    const ms = Number(el.dataset["at"]);
    if (Number.isFinite(ms) && ms > 0) {
      el.textContent = new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }
  });
  const nextBody = root.querySelector<HTMLElement>(".history-body");
  if (nextBody) nextBody.scrollTop = bodyScroll;
}

// ─── Board: composer overlay helpers (ported from main.ts) ──────────────────────

function fallbackComposerOptions(): ComposerOptions {
  return { presets: [], teams: [], engines: ENGINE_FAMILIES };
}

function getComposerOverlay(): HTMLElement | null {
  return document.getElementById("composer-overlay");
}

function openComposer(options: ComposerOptions): void {
  activeComposerOptions = options;
  lastComposerOptions = options;
  composerForm = { description: "" };

  let overlay = getComposerOverlay();
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "composer-overlay";
    overlay.className = "composer-overlay";
    document.body.appendChild(overlay);
  }
  overlay.innerHTML = `<div class="composer-scrim" data-action="close-composer-scrim"></div>${renderComposerHTML(options)}`;
  overlay.hidden = false;
  syncDispatchButton();
}

function closeComposer(): void {
  const overlay = getComposerOverlay();
  if (overlay) overlay.hidden = true;
  activeComposerOptions = undefined;
  composerForm = { description: "" };
}

function syncDispatchButton(): void {
  const btn = document.querySelector<HTMLButtonElement>(".composer-dispatch");
  if (btn) btn.disabled = !canDispatch(composerForm);
}

// ─── Task overlay (shared roomy multi-line task entry) ──────────────────────────
// VS Code's native showInputBox is single-line, which is cramped for a big task.
// This modal (mounted on document.body like the composer) gives team launch a
// large auto-focused textarea. On submit (button or Cmd/Ctrl+Enter) the trimmed
// text is handed to the captured callback. Graphite palette only; no em dashes.

function getTaskOverlay(): HTMLElement | null {
  return document.getElementById("task-overlay");
}

/** The four static equaliser bars (Hallucinate's launch glyph). aria-hidden decorative. */
function taskGlyphBars(): string {
  return `<span class="task-glyph-bars" aria-hidden="true"><span></span><span></span><span></span><span></span></span>`;
}

/** A single circular initial avatar (reuses the team-member look). escapeHtml'd. */
function taskAvatar(name: string): string {
  const initial = name.trim().charAt(0).toUpperCase() || "?";
  return `<span class="task-avatar">${escapeHtml(initial)}</span>`;
}

/** One selectable chip in the task composer's single-select team picker. */
interface TaskSelectorChip {
  value: string; // the chip's identity (the team name)
  label: string; // primary label (the team name)
  sublabel: string; // secondary line (e.g. "3 specialists")
  accent: "team" | "agent"; // per-chip accent so picking flips the panel tint
}

interface TaskSelector {
  chips: TaskSelectorChip[];
  selectedValue: string; // which chip is selected on open (single-select)
  /** Called on submit with the SELECTED chip's value plus the typed task. */
  onSubmit: (selectedValue: string, task: string) => void;
}

interface TaskOverlayOptions {
  eyebrow: string; // e.g. "LAUNCH TEAM" / "RUN AGENT" (rendered uppercase, mono, faint)
  subject: string; // the team or agent NAME shown large (Manrope)
  goal?: string; // optional shared-goal line, muted; rendered only when present
  members?: string[]; // optional member names -> avatar chips; row rendered only when length > 0
  placeholder: string;
  submitLabel: string;
  accent?: "team" | "agent"; // tints the launch glyph + submit; default "team"
  // Either a plain task callback OR a chip selector (for the "+ New task" funnel).
  // With a selector, the typed task is routed to selector.onSubmit with the
  // currently-selected chip's value; otherwise opts.onSubmit gets just the task.
  onSubmit?: (task: string) => void;
  selector?: TaskSelector;
}

// The currently-selected chip value when the task overlay carries a selector. The
// chip-click handler updates this; submit reads it. Undefined when no selector.
let taskSelectorValue: string | undefined;

function openTaskOverlay(opts: TaskOverlayOptions): void {
  const selector = opts.selector;
  // Wire the captured submit. With a selector, route the typed task to it using
  // the live selected chip value (submitTaskOverlay reads taskSelectorValue while
  // the overlay is still open, before closing it); without a selector, fall
  // through to the plain task callback.
  taskSelectorValue = selector ? selector.selectedValue : undefined;
  taskOverlaySubmit = selector
    ? (task: string) => selector.onSubmit(taskSelectorValue ?? selector.selectedValue, task)
    : opts.onSubmit;
  const accent = opts.accent ?? "team";
  let overlay = getTaskOverlay();
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "task-overlay";
    overlay.className = "task-overlay";
    document.body.appendChild(overlay);
  }

  // Members row: a small lead label + circular initial avatars with names, only
  // when at least one member is present. Each name is escaped.
  const members = (opts.members ?? []).filter((m) => m.trim() !== "");
  const leadLabel = accent === "agent" ? "Agent" : "Team";
  const membersRow =
    members.length > 0
      ? `<div class="task-members">
      <span class="task-members-lead">${escapeHtml(leadLabel)}</span>
      ${members
        .map(
          (name) =>
            `<span class="task-member">${taskAvatar(name)}<span class="task-member-name">${escapeHtml(name)}</span></span>`,
        )
        .join("")}
    </div>`
      : "";

  // Goal line: one muted line, only when a non-empty goal was provided.
  const goal = opts.goal?.trim() ?? "";
  const goalRow =
    goal !== ""
      ? `<p class="task-goal"><span class="task-goal-label">Goal</span><span class="task-goal-text">${escapeHtml(goal)}</span></p>`
      : "";

  // Chip selector (the in-page team picker for "+ New task"). Single-select; the
  // selected chip carries `.selected`. Reuses the composer role-chip language
  // (graphite chip, soft-blue selected accent).
  const selectorRow = selector ? renderTaskSelector(selector) : "";

  overlay.innerHTML = `<div class="task-scrim" data-action="close-task-scrim"></div>
  <div class="task-panel task-panel--${escapeHtml(accent)}" role="dialog" aria-modal="true" aria-label="${escapeHtml(`${opts.eyebrow}: ${opts.subject}`)}">
    <header class="task-header">
      <span class="task-glyph" aria-hidden="true">${taskGlyphBars()}</span>
      <span class="task-identity">
        <span class="task-eyebrow">${escapeHtml(opts.eyebrow)}</span>
        <span class="task-subject">${escapeHtml(opts.subject)}</span>
      </span>
      <button class="task-close" data-action="close-task" type="button" aria-label="Close">&#215;</button>
    </header>
    <div class="task-body">
      ${selectorRow}
      ${membersRow}
      ${goalRow}
      <textarea class="task-textarea" data-action="task-overlay-input" rows="6" placeholder="${escapeHtml(opts.placeholder)}"></textarea>
    </div>
    <footer class="task-footer">
      <button class="task-submit" data-action="submit-task" type="button" disabled>${taskGlyphBars()}<span class="task-submit-label">${escapeHtml(opts.submitLabel)}</span></button>
      <button class="task-cancel" data-action="close-task" type="button">Cancel</button>
      <span class="task-hint"><kbd class="task-kbd">&#8984; &#8629;</kbd> to ${escapeHtml(opts.submitLabel.toLowerCase())}</span>
    </footer>
  </div>`;
  overlay.hidden = false;
  overlay.querySelector<HTMLTextAreaElement>(".task-textarea")?.focus();
}

/** Render the single-select team chips (one per team). */
function renderTaskSelector(selector: TaskSelector): string {
  const chips = selector.chips
    .map((chip) => {
      const selected = chip.value === selector.selectedValue ? " selected" : "";
      return `<button type="button" class="task-target-chip${selected}" data-action="task-target" data-target="${escapeHtml(chip.value)}" data-accent="${escapeHtml(chip.accent)}" aria-pressed="${chip.value === selector.selectedValue ? "true" : "false"}">
        <span class="task-target-label">${escapeHtml(chip.label)}</span>
        <span class="task-target-sub">${escapeHtml(chip.sublabel)}</span>
      </button>`;
    })
    .join("");
  return `<div class="task-targets">
      <span class="task-targets-lead">Run with</span>
      <div class="task-targets-chips">${chips}</div>
    </div>`;
}

/** Mark a target chip selected (single-select) and re-tint the panel accent. */
function selectTaskTarget(value: string, accent: "team" | "agent"): void {
  taskSelectorValue = value;
  const overlay = getTaskOverlay();
  if (!overlay) return;
  overlay.querySelectorAll<HTMLElement>(".task-target-chip").forEach((chip) => {
    const isSel = chip.dataset["target"] === value;
    chip.classList.toggle("selected", isSel);
    chip.setAttribute("aria-pressed", isSel ? "true" : "false");
  });
  // Flip the panel accent so the launch glyph + submit tint match the target.
  const panel = overlay.querySelector<HTMLElement>(".task-panel");
  if (panel) {
    panel.classList.toggle("task-panel--team", accent === "team");
    panel.classList.toggle("task-panel--agent", accent === "agent");
  }
}

function closeTaskOverlay(): void {
  const overlay = getTaskOverlay();
  if (overlay) overlay.hidden = true;
  taskOverlaySubmit = undefined;
  taskSelectorValue = undefined;
  // The new-task funnel is done the moment its overlay is dismissed (closed or
  // submitted), so consume the pending token here too.
  pendingNewTask = false;
}

function syncTaskSubmitButton(): void {
  const overlay = getTaskOverlay();
  if (!overlay) return;
  const ta = overlay.querySelector<HTMLTextAreaElement>(".task-textarea");
  const btn = overlay.querySelector<HTMLButtonElement>(".task-submit");
  if (btn) btn.disabled = (ta?.value.trim() ?? "") === "";
}

/**
 * The no-teams CTA for the "+ New task" funnel. TEAMS are the unit of a task run,
 * so with zero teams there is nothing to launch and NO fallback to a default
 * agent. Reuse the task-overlay element (so the shared close-task / scrim
 * handlers dismiss it) but render a short message plus a "Create a team" button
 * that navigates to the Library Teams view to build one.
 */
function openNoTeamsOverlay(): void {
  // No selector/submit: this overlay only navigates. Clear any prior captured
  // submit so a stale callback can't fire.
  taskOverlaySubmit = undefined;
  taskSelectorValue = undefined;
  let overlay = getTaskOverlay();
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "task-overlay";
    overlay.className = "task-overlay";
    document.body.appendChild(overlay);
  }
  overlay.innerHTML = `<div class="task-scrim" data-action="close-task-scrim"></div>
  <div class="task-panel task-panel--team" role="dialog" aria-modal="true" aria-label="New task: no teams yet">
    <header class="task-header">
      <span class="task-glyph" aria-hidden="true">${taskGlyphBars()}</span>
      <span class="task-identity">
        <span class="task-eyebrow">NEW TASK</span>
        <span class="task-subject">No teams yet</span>
      </span>
      <button class="task-close" data-action="close-task" type="button" aria-label="Close">&#215;</button>
    </header>
    <div class="task-body">
      <p class="task-empty">No teams yet. Create a team to run a task.</p>
    </div>
    <footer class="task-footer">
      <button class="task-submit" data-action="create-team-cta" type="button">${taskGlyphBars()}<span class="task-submit-label">Create a team</span></button>
      <button class="task-cancel" data-action="close-task" type="button">Cancel</button>
    </footer>
  </div>`;
  overlay.hidden = false;
  overlay.querySelector<HTMLButtonElement>('[data-action="create-team-cta"]')?.focus();
}

function submitTaskOverlay(): void {
  const overlay = getTaskOverlay();
  const text = overlay?.querySelector<HTMLTextAreaElement>(".task-textarea")?.value.trim() ?? "";
  if (!text || !taskOverlaySubmit) return;
  const submit = taskOverlaySubmit;
  // Invoke the captured submit BEFORE closing: closeTaskOverlay resets
  // taskSelectorValue (and taskOverlaySubmit), and the selector callback reads
  // taskSelectorValue, so a close-first order would drop a team selection. The
  // callback only posts a message, so running it before the close is safe.
  submit(text);
  closeTaskOverlay();
}

/** Task-overlay clicks (view-independent; overlay lives on document.body). */
function handleTaskOverlayClick(target: HTMLElement): boolean {
  if (
    target.closest<HTMLElement>('[data-action="close-task-scrim"]') ||
    target.closest<HTMLElement>('[data-action="close-task"]')
  ) {
    closeTaskOverlay();
    return true;
  }
  // The no-teams CTA: dismiss the overlay and navigate to the Library Teams view
  // so the user can build a team. No launch is posted.
  if (target.closest<HTMLElement>('[data-action="create-team-cta"]')) {
    closeTaskOverlay();
    navigateToLibrary("teams");
    return true;
  }
  // Team chip in the "+ New task" composer: single-select, updating
  // taskSelectorValue read by submit.
  const targetChip = target.closest<HTMLElement>('[data-action="task-target"][data-target]');
  if (targetChip) {
    const value = targetChip.dataset["target"] ?? "";
    const accent = targetChip.dataset["accent"] === "team" ? "team" : "agent";
    selectTaskTarget(value, accent);
    return true;
  }
  if (target.closest<HTMLElement>('[data-action="submit-task"]')) {
    submitTaskOverlay();
    return true;
  }
  return false;
}

function markPresetSelected(roleName: string): void {
  document.querySelectorAll<HTMLElement>(".composer-chip").forEach((chip) => {
    chip.classList.toggle("selected", chip.dataset["role"] === roleName);
  });
}

function markEnginePillSelected(engineId: string, model?: string): void {
  document.querySelectorAll<HTMLElement>(".composer-engine-pill").forEach((pill) => {
    const pillEngine = pill.dataset["engine"];
    const pillModel = pill.dataset["model"];
    const match = pillEngine === engineId && (model === undefined ? pillModel === undefined : pillModel === model);
    pill.classList.toggle("selected", match);
  });
}

function tickElapsed(): void {
  const now = Date.now();
  document.querySelectorAll<HTMLElement>(".elapsed[data-started]").forEach((el) => {
    const started = Number(el.dataset["started"]);
    if (!Number.isFinite(started)) return;
    const s = Math.max(0, Math.floor((now - started) / 1000));
    el.textContent = `${Math.floor(s / 60)}m ${s % 60}s`;
  });
}

setInterval(tickElapsed, 1000);

/**
 * Auto-advance the attention bar through its queue. Like `tickElapsed`, this
 * mutates ONLY the bar's DOM (replaces the `.attention-bar` element via
 * `renderAttentionBar`), never the whole board, so the user's drawer / scroll /
 * composer state is untouched. It advances only when there is more than one item
 * and the user is not reading: PAUSE while the pointer hovers the bar, or while
 * an agent's inspector/drawer is open (an agent is focused).
 */
function tickAttention(): void {
  if (view !== "board") return;
  const bar = document.querySelector<HTMLElement>(".attention-bar");
  if (!bar) return;
  const queue = lastCockpit.attention ?? [];
  if (queue.length <= 1) return;
  // Respect reduced-motion: a JS-driven content swap bypasses CSS media rules,
  // so freeze on the most-urgent item for users who opt out of motion.
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  // Pause: pointer over the bar, keyboard focus inside it (rotating would yank
  // focus mid-action), or the focused-agent inspector is open.
  if (bar.matches(":hover")) return;
  if (bar.contains(document.activeElement)) return;
  if (document.querySelector(".drawer")) return;
  attentionIndex = nextAttentionIndex(attentionIndex, queue.length);
  bar.outerHTML = renderAttentionBar(queue, attentionIndex);
}

setInterval(tickAttention, 4500);

// ─── Navigation ──────────────────────────────────────────────────────────────

/** Switch views, closing any body-mounted overlay first so it never strands
 *  over the wrong view (the composer and task overlay live on document.body). */
function setView(next: AppView): void {
  if (next !== view) {
    closeComposer();
    closeTaskOverlay();
    pendingNewTask = false;
  }
  view = next;
  render();
}

/** Switch to the library, optionally on a specific tab. Fetches data lazily. */
function navigateToLibrary(tab?: LibraryTab): void {
  if (tab) libraryTab = tab;
  // Fetch data on first navigation (mirrors library-main posting open-library at
  // startup). If we already have a snapshot, just switch the tab.
  if (!lastLibrary) {
    vscode.postMessage({ type: "open-library" });
    if (tab) vscode.postMessage({ type: "switch-library-tab", tab });
  } else if (tab && lastLibrary.tab !== tab) {
    vscode.postMessage({ type: "switch-library-tab", tab });
  }
  setView("library");
}

/** Return to the board (the "back" affordance shared by every other view). */
function backToBoard(): void {
  setView("board");
}

// ─── Host message listener ────────────────────────────────────────────────────

window.addEventListener("message", (e: MessageEvent<HostToApp>) => {
  const data = e.data;
  switch (data.type) {
    case "state":
      lastCockpit = data.state;
      // Keep the live views fresh as events stream in, but skip redundant work.
      // The board always re-renders (cards/floor/drawer move with the stream),
      // with the attention index preserved inside renderBoardView (regression A).
      // The History view re-renders ONLY when the timeline actually changed: an
      // output tick records no history entry, so rebuilding the list would throw
      // keyboard focus off the focused entry on every tick (regression B).
      if (view === "board") {
        render();
      } else if (view === "history" && historyChanged(lastHistorySig, lastCockpit.history ?? [])) {
        render();
      }
      break;
    case "composer-options":
      // Opening the dispatch modal is a board affordance; jump to the board.
      // setView("board") runs FIRST so any stale overlay from another view is
      // closed before we open the fresh composer below (when already on the
      // board it no-ops, leaving the just-opened composer intact).
      setView("board");
      openComposer(data.options);
      break;
    case "library-state": {
      const wasEditingTeam = lastLibrary?.editingTeam !== undefined;
      lastLibrary = data.snapshot;
      libraryTab = data.snapshot.tab;
      // Seed the team-editor scratch state the first time a team editor opens
      // (transition from no-editor to editor). On subsequent re-renders while the
      // editor stays open the live draft is preserved (the user's unsaved edits).
      if (data.snapshot.editingTeam !== undefined && !wasEditingTeam) {
        teamDraftName = data.snapshot.editingTeam.name;
        teamDraftGoal = data.snapshot.editingTeam.goal ?? "";
        teamDraftMembers = [...data.snapshot.editingTeam.roleNames];
      }
      // Auto-scan on first entry to the discover tab (mirrors library-main).
      if (data.snapshot.tab === "discover" && discoverItems.length === 0 && !discoverScanning) {
        discoverScanning = true;
        vscode.postMessage({ type: "scan-repo" });
      }
      if (view === "library") render();
      break;
    }
    case "discover-results":
      discoverItems = data.items;
      discoverMcp = data.mcp;
      discoverAdopted = data.adoptedSources ?? [];
      discoverScanning = false;
      if (view === "library" && libraryTab === "discover") render();
      break;
    case "anatomy-state":
      lastAnatomy = data.vm;
      setView("anatomy");
      break;
    case "review-state":
      lastReviewCard = data.card;
      lastReviewOpts = data.opts;
      setView("review");
      break;
    case "set-view":
      setView(data.view);
      break;
    case "open-task-composer": {
      // The "+ New task" funnel. The host read .hallucinate/ fresh and sent the
      // hand-built teams. TEAMS are the unit of a task run: open ONE in-page
      // composer offering ONLY team selection (no native OS dropdown, no
      // standalone default agent). Picking a team launches it with the lead
      // scoped to that team. On submit a team chip posts launch-team.
      //
      // Guard against the async race: this reply can arrive AFTER the user has
      // navigated away from the board (and possibly back). Only honor it when a
      // new-task is genuinely pending AND we are still on the board, so a stale
      // reply never pops the composer over the wrong view. Consume the token.
      if (!pendingNewTask || view !== "board") {
        pendingNewTask = false;
        break;
      }
      pendingNewTask = false;
      const teams = data.teams;
      // No teams yet: show an in-page create-team CTA instead of an empty chip
      // row. There is no fallback to a default agent; the user must create a team.
      if (teams.length === 0) {
        openNoTeamsOverlay();
        break;
      }
      const chips: TaskSelectorChip[] = teams.map((t) => ({
        value: t.name,
        label: t.name,
        sublabel: `${t.specialists} ${t.specialists === 1 ? "specialist" : "specialists"}`,
        accent: "team" as const,
      }));
      openTaskOverlay({
        eyebrow: "NEW TASK",
        subject: "Select a team",
        accent: "team",
        placeholder: "Describe the task. The team's lead delegates as needed...",
        submitLabel: "Launch",
        selector: {
          chips,
          // Preselect the FIRST team so there is always a valid selection.
          selectedValue: teams[0]!.name,
          // Every value is a team name: launch-team scoped to that team.
          onSubmit: (value, task) =>
            vscode.postMessage({ type: "launch-team", name: value, task }),
        },
      });
      break;
    }
    default: {
      // Exhaustiveness guard: a new HostToApp variant without a handler is a
      // compile error.
      const _exhaustive: never = data;
      void _exhaustive;
      break;
    }
  }
});

// ─── Submit delegation (steer + send-back: board & review share the markup) ─────

document.addEventListener("submit", (e) => {
  const form = e.target;
  if (!(form instanceof HTMLFormElement)) return;
  const action = form.dataset["action"];
  const id = form.dataset["id"];
  if (!id) return;
  if (action === "steer") {
    e.preventDefault();
    const input = form.querySelector<HTMLInputElement>(".steer-input");
    const text = input?.value.trim();
    if (!text) return;
    vscode.postMessage({ type: "steer", agentId: id, input: text });
    if (input) input.value = "";
  } else if (action === "sendBack") {
    e.preventDefault();
    const textarea = form.querySelector<HTMLTextAreaElement>(".sendback-input");
    const text = textarea?.value.trim();
    if (!text) return;
    vscode.postMessage({ type: "sendBack", agentId: id, feedback: text });
    if (textarea) textarea.value = "";
  }
});

// ─── Keyboard: one priority-ordered handler ────────────────────────────────────
// A single keydown listener so a single Escape does ONE thing even when overlays
// stack (e.g. the review view with the task overlay open). Precedence: the task
// overlay (most-foreground, view-independent) wins, then the board composer, then
// the review-view Back twin. Cmd/Ctrl+Enter still submits an open task overlay.

document.addEventListener("keydown", (e) => {
  const taskOverlay = getTaskOverlay();
  const taskOpen = !!taskOverlay && !taskOverlay.hidden;

  // Cmd/Ctrl+Enter submits the task overlay when it is open (preserved behavior).
  if (taskOpen && e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    submitTaskOverlay();
    return;
  }

  if (e.key !== "Escape") return;

  // (1) Task overlay open: dismiss it and stop here (no view navigation).
  if (taskOpen) {
    e.preventDefault();
    e.stopPropagation();
    closeTaskOverlay();
    return;
  }

  // (2) Board composer open: close it.
  if (view === "board") {
    const composer = getComposerOverlay();
    if (composer && !composer.hidden) {
      closeComposer();
      return;
    }
  }

  // (3) Full-page review: Escape is the keyboard twin of the Back button, so the
  // user is never stranded off the Board.
  if (view === "review") {
    backToBoard();
  }

  // (4) Full-page history: Escape is the keyboard twin of the close button, so the
  // user is never stranded off the Board (mirrors the review branch).
  if (view === "history") {
    backToBoard();
  }
});

/**
 * Flip the board layout between the Floor and the status lane columns (webview-
 * local: no host round-trip). The already-active layout is a no-op; a REAL flip
 * re-renders and plays the board enter animation so the change reads as
 * deliberate. Shared by the status-bar toggle click and its arrow-key nav.
 */
function setBoardLayout(next: boolean): void {
  if (next === groupByStatus) return;
  groupByStatus = next;
  render();
  root?.querySelector<HTMLElement>(".floor, .lanes")?.classList.add("hallucinate-enter");
}

// Roving arrow-key navigation for the board-layout segmented control (a
// radiogroup, board only). Left/Up select the first option (Floor), Right/Down
// the second (Status); selection moves and focus follows it (the active tab
// carries tabindex=0). Scoped to a focused toggle tab so it never hijacks other
// arrow-key use on the board.
document.addEventListener("keydown", (e) => {
  if (view !== "board") return;
  if (!(e.target instanceof HTMLElement)) return;
  if (!e.target.closest(".board-layout-toggle")) return;
  let next: boolean;
  if (e.key === "ArrowRight" || e.key === "ArrowDown") next = true; // Status
  else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = false; // Floor
  else return;
  e.preventDefault();
  setBoardLayout(next);
  // Move focus onto the now-active tab (roving tabindex put tabindex=0 on it).
  root
    ?.querySelector<HTMLElement>(`.layout-tab[data-layout="${next ? "status" : "floor"}"]`)
    ?.focus();
});

// ─── Click delegation (branches on `view` FIRST) ───────────────────────────────

document.addEventListener("click", (e) => {
  const target = e.target;
  if (!(target instanceof HTMLElement)) return;

  // Composer overlay clicks are board-scoped: the overlay only exists in board
  // view. Handle them before the per-view branch so a stray overlay never leaks.
  if (handleComposerClick(target)) return;
  // Task overlay is view-independent (lives on document.body, opened from the
  // Teams tab), so handle its clicks before the per-view branch too.
  if (handleTaskOverlayClick(target)) return;

  switch (view) {
    case "board":
      handleBoardClick(target);
      break;
    case "library":
      handleLibraryClick(target);
      break;
    case "anatomy":
      handleAnatomyClick(target);
      break;
    case "review":
      handleReviewClick(target);
      break;
    case "history":
      handleHistoryClick(target);
      break;
  }
});

/** Composer overlay clicks (board only). Returns true if handled. */
function handleComposerClick(target: HTMLElement): boolean {
  if (target.closest<HTMLElement>('[data-action="close-composer-scrim"]')) {
    closeComposer();
    return true;
  }
  if (target.closest<HTMLElement>('[data-action="close-composer"]')) {
    closeComposer();
    return true;
  }
  if (target.closest<HTMLElement>('[data-action="dispatch"]')) {
    const msg = buildDispatchMessage(composerForm);
    if (msg) {
      vscode.postMessage(msg);
      closeComposer();
    }
    return true;
  }
  const presetChip = target.closest<HTMLElement>('[data-action="preset"]');
  if (presetChip) {
    const roleName = presetChip.dataset["role"];
    const engineId = presetChip.dataset["engine"];
    const model = presetChip.dataset["model"];
    if (roleName) {
      composerForm.roleName = roleName;
      delete composerForm.newRoleName;
    }
    if (engineId) {
      composerForm.engineId = engineId;
      composerForm.model = model;
    }
    const newRoleInput = document.querySelector<HTMLInputElement>('[data-action="new-role"]');
    if (newRoleInput) newRoleInput.value = "";
    if (roleName) markPresetSelected(roleName);
    if (engineId) markEnginePillSelected(engineId, model);
    syncDispatchButton();
    return true;
  }
  const enginePill = target.closest<HTMLElement>('.composer-engine-pill[data-action="engine"]');
  if (enginePill) {
    const engineId = enginePill.dataset["engine"];
    const model = enginePill.dataset["model"];
    if (engineId) {
      composerForm.engineId = engineId;
      composerForm.model = model;
      markEnginePillSelected(engineId, model);
    }
    syncDispatchButton();
    return true;
  }
  return false;
}

// ─── Board click delegation (ported from main.ts) ──────────────────────────────

function handleBoardClick(target: HTMLElement): void {
  // "+ New task" button: the host reads .hallucinate/ fresh and replies with
  // open-task-composer carrying the hand-built teams. We then open the in-page
  // task composer (team chip selector + task textarea), or a create-team CTA
  // when there are no teams.
  if (target.closest<HTMLElement>('[data-action="new-task"]')) {
    pendingNewTask = true;
    vscode.postMessage({ type: "new-task" });
    return;
  }

  // Tab-strip / header Library buttons: navigate in-page to the library, on the
  // tab the chip carries (data-lib-tab).
  const libBtn = target.closest<HTMLElement>('[data-action="open-library"]');
  if (libBtn) {
    const tab = libBtn.dataset["libTab"] as LibraryTab | undefined;
    navigateToLibrary(tab);
    return;
  }

  // [History] button: open the in-session History tab. The timeline reads the
  // already-cached lastCockpit, so this is webview-local (NO host post, no fetch).
  // It carries no data-id, so it must be handled BEFORE the id-bound branch below
  // (which early-returns on a missing data-id).
  if (target.closest<HTMLElement>('[data-action="open-history"]')) {
    setView("history");
    return;
  }

  // Drawer tab switching.
  const tabBtn = target.closest<HTMLElement>(".tab[data-tab]");
  if (tabBtn) {
    const tabName = tabBtn.dataset["tab"];
    const drawer = tabBtn.closest<HTMLElement>(".drawer");
    if (drawer && tabName) {
      // Remember the choice so a `state` re-render re-applies it instead of
      // snapping back to the default "instructions" tab on every stream tick.
      drawerTab = tabName;
      drawer.querySelectorAll<HTMLElement>(".tab").forEach((t) => t.classList.remove("active"));
      tabBtn.classList.add("active");
      drawer.querySelectorAll<HTMLElement>(".tab-body").forEach((body) => {
        body.hidden = body.dataset["tab"] !== tabName;
      });
    }
    return;
  }

  // close-drawer (the × header button carries data-action="close-drawer"). The
  // docked inspector has no scrim, so the header button is the only close path.
  const closeBtn = target.closest<HTMLElement>('[data-action="close-drawer"]');
  if (closeBtn) {
    // Record which drawer the user closed so the next `state` tick (which re-adds
    // the drawer from state.focusedId) keeps it shut. Remove the docked drawer.
    // Reset the tab so a later re-open starts on the default.
    closedDrawerId = lastCockpit.focusedId ?? null;
    document.querySelector(".drawer")?.remove();
    drawerTab = "instructions";
    return;
  }

  // Lane-header "Clear all" (the Done lane): a bulk discard of every
  // ready-to-review run. It carries NO id, so it must be handled BEFORE the
  // id-bound branch below (which early-returns on a missing data-id). The host
  // confirms (destructive) then discards each done agent.
  if (target.closest<HTMLElement>('[data-action="clear-done-lane"]')) {
    vscode.postMessage({ type: "clear-done-lane" });
    return;
  }

  // Board-layout toggle (status bar): Floor vs Status. Webview-local (no host
  // message), and it carries NO data-id, so it is handled BEFORE the id-bound
  // branch below (which early-returns on a missing data-id). Re-render only when
  // the layout actually changes, and play the board enter animation on the new
  // layout so the flip reads as deliberate (the already-active tab is a no-op).
  const layoutBtn = target.closest<HTMLElement>('[data-action="set-board-layout"]');
  if (layoutBtn) {
    setBoardLayout(layoutBtn.dataset["layout"] === "status");
    return;
  }

  // Host-bound action delegation.
  const btn = target.closest<HTMLElement>("[data-action]");
  if (btn) {
    const id = btn.dataset["id"];
    const action = btn.dataset["action"];
    if (!id) return;
    if (action === "stop") {
      vscode.postMessage({ type: "stop", agentId: id });
    } else if (action === "merge") {
      vscode.postMessage({ type: "merge", agentId: id });
    } else if (action === "discard" || action === "remove") {
      // Per-card "Remove" on a done card reuses the existing discard verb: it
      // drops the worktree + branch and forgets the log, then the resolved-state
      // auto-clear in the cockpit reducer takes the card off the board. Mapping
      // Remove to discard (not a silent hide) avoids orphaning the worktree.
      vscode.postMessage({ type: "discard", agentId: id });
    } else if (action === "resume") {
      // Resume a stopped agent: relaunch in its existing worktree. It rides the
      // sendBack verb with empty feedback (the task is kept intact host-side).
      vscode.postMessage({ type: "sendBack", agentId: id, feedback: "" });
    } else if (action === "approve" || action === "deny") {
      const approvalId = btn.dataset["approvalId"];
      if (approvalId) {
        vscode.postMessage({
          type: "approve",
          agentId: id,
          approvalId,
          decision: action === "approve" ? "allow" : "deny",
        });
      }
    } else if (action === "resolve-conflict") {
      vscode.postMessage({ type: "resolve-conflict", agentId: id });
    } else if (action === "finish-merge") {
      vscode.postMessage({ type: "finish-merge", agentId: id });
    } else if (action === "create-pr") {
      vscode.postMessage({ type: "create-pr", agentId: id });
    } else if (action === "retry-cleanup") {
      vscode.postMessage({ type: "retry-cleanup", agentId: id });
    } else if (action === "open-review") {
      // In-page review: ask the host for the card; it replies with review-state,
      // which flips the view. Post the same open-review message as before.
      vscode.postMessage({ type: "open-review", agentId: id });
    } else if (action === "focus") {
      // The attention bar's label jumps to the agent, reusing the same focus
      // path a card click uses: open its inspector fresh (clear the close
      // suppression, reset to the default tab).
      closedDrawerId = null;
      drawerTab = "instructions";
      vscode.postMessage({ type: "focus", agentId: id });
    } else if (action === "approve-delegation") {
      // `id` here is the DELEGATION id (not an agent id): the lead asked to bring
      // a teammate in; approving spawns it host-side.
      vscode.postMessage({ type: "approve-delegation", id });
    } else if (action === "deny-delegation") {
      vscode.postMessage({ type: "deny-delegation", id });
    }
    return;
  }

  // Focus on card click.
  const card = target.closest<HTMLElement>(".card");
  const cardId = card?.dataset["id"];
  if (cardId) {
    // Clicking any card (re-)opens its drawer fresh: clear the close suppression
    // and reset to the default tab so the just-opened drawer is never withheld
    // and always lands on Instructions.
    closedDrawerId = null;
    drawerTab = "instructions";
    vscode.postMessage({ type: "focus", agentId: cardId });
  }
}

// ─── Library click delegation (ported from library-main.ts) ────────────────────

function handleLibraryClick(target: HTMLElement): void {
  // Library Close: back to the board.
  if (target.closest<HTMLElement>('[data-action="close-library"]')) {
    backToBoard();
    return;
  }

  // Tab switch.
  const tabBtn = target.closest<HTMLElement>(".lib-tab[data-tab]");
  if (tabBtn) {
    const tab = tabBtn.dataset["tab"];
    if (tab) {
      vscode.postMessage({ type: "switch-library-tab", tab: tab as LibrarySnapshot["tab"] });
    }
    return;
  }

  // New skill button.
  if (target.closest<HTMLElement>('[data-action="skill-create"]')) {
    editorBody = "";
    vscode.postMessage({ type: "skill-create" });
    return;
  }

  // Skill card click -> open editor (create-mode for now, matching library-main).
  const skillCard = target.closest<HTMLElement>(".skill-card[data-skill]");
  if (skillCard) {
    editorBody = "";
    vscode.postMessage({ type: "skill-create" });
    return;
  }

  // Editor Save button.
  if (target.closest<HTMLElement>('[data-action="skill-save"]')) {
    const nameInput = document.querySelector<HTMLInputElement>(".editor-name-input");
    const descInput = document.querySelector<HTMLInputElement>(".editor-desc-input");
    const bodyInput = document.querySelector<HTMLTextAreaElement>(".editor-body");
    const name = nameInput?.value.trim() ?? "";
    const description = descInput?.value.trim() ?? "";
    const body = bodyInput?.value ?? editorBody;
    if (name && description) {
      vscode.postMessage({ type: "skill-save", name, description, body });
    }
    return;
  }

  // Editor Cancel / close button.
  if (target.closest<HTMLElement>('[data-action="skill-cancel"]')) {
    vscode.postMessage({ type: "switch-library-tab", tab: "skills" });
    return;
  }

  // Picker close button.
  if (target.closest<HTMLElement>('[data-action="picker-cancel"]')) {
    if (lastLibrary) vscode.postMessage({ type: "switch-library-tab", tab: lastLibrary.tab });
    return;
  }

  // ── Group 1: New agent (Agents tab) ──────────────────────────────────────
  // VS Code webviews do not support window.prompt(), so the NAME is collected by
  // the host via a native input box. We just request a new agent; the host
  // prompts, seeds the default role file, then opens the anatomy editor on it.
  if (target.closest<HTMLElement>('[data-action="new-agent"]')) {
    vscode.postMessage({ type: "new-role" });
    return;
  }

  // ── Group 1: Delete agent (Agents tab) ───────────────────────────────────
  // Handled BEFORE the agent-card click so the × never opens the editor.
  // Confirmation is a native modal on the host (webviews can't use confirm()).
  const deleteRoleBtn = target.closest<HTMLElement>('[data-action="delete-role"][data-role]');
  if (deleteRoleBtn) {
    const roleName = deleteRoleBtn.dataset["role"];
    if (roleName) vscode.postMessage({ type: "delete-role", name: roleName });
    return;
  }

  // ── Group 1: Run agent (Agents tab) ──────────────────────────────────────
  // Handled BEFORE the agent-card click so Run never opens the editor. Collect
  // the task in the roomy overlay, then dispatch THIS saved agent on it (the host
  // loads + registers the role's full anatomy on a roleName dispatch), and flip
  // to the board to watch it run.
  const runRoleBtn = target.closest<HTMLElement>('[data-action="run-role"][data-role]');
  if (runRoleBtn) {
    const roleName = runRoleBtn.dataset["role"];
    if (roleName) {
      openTaskOverlay({
        eyebrow: "RUN AGENT",
        subject: roleName,
        members: [roleName],
        accent: "agent",
        placeholder: "Describe what this agent should do...",
        submitLabel: "Run",
        onSubmit: (task) => {
          vscode.postMessage({ type: "dispatch", roleName, description: task });
          backToBoard();
        },
      });
    }
    return;
  }

  // ── Group 1: Edit agent (Agents tab) ─────────────────────────────────────
  // Clicking an agent card opens the anatomy editor for that role. open-anatomy
  // is an ANATOMY message (routed to the anatomy controller, which posts
  // anatomy-state and flips the router to the anatomy view).
  const agentCard = target.closest<HTMLElement>(".agent-card[data-role]");
  if (agentCard) {
    const roleName = agentCard.dataset["role"];
    if (roleName) vscode.postMessage({ type: "open-anatomy", roleName });
    return;
  }

  // ── Group 2: New team (Teams tab) ────────────────────────────────────────
  if (target.closest<HTMLElement>('[data-action="new-team"]')) {
    vscode.postMessage({ type: "team-create" });
    return;
  }

  // ── Group 2: Edit team (Teams tab) ───────────────────────────────────────
  // Open the editor pre-filled with this team's current members. The snapshot's
  // team carries name + roleNames; seed the draft and open via team-create-like
  // flow is not enough (we need the existing values), so seed directly here and
  // re-render. We do NOT round-trip the host because the read-only snapshot
  // already holds everything the editor needs.
  const editTeamBtn = target.closest<HTMLElement>('[data-action="edit-team"][data-team]');
  if (editTeamBtn) {
    const teamName = editTeamBtn.dataset["team"];
    if (teamName && lastLibrary) {
      const team = lastLibrary.teams.find((t) => t.name === teamName);
      if (team) {
        teamDraftName = team.name;
        teamDraftGoal = "";
        teamDraftMembers = [...team.roleNames];
        lastLibrary = {
          ...lastLibrary,
          editing: undefined,
          picker: undefined,
          editingTeam: { name: team.name, roleNames: [...team.roleNames] },
        };
        render();
      }
    }
    return;
  }

  // ── Group 3: Launch team (Teams tab) ─────────────────────────────────────
  // launch-team is intercepted by the extension host (it owns the orchestrator).
  // Collect the (possibly large) task in a roomy in-webview overlay, then post
  // launch-team WITH the task so the host skips its single-line input box.
  const launchTeamBtn = target.closest<HTMLElement>('[data-action="launch-team"][data-team]');
  if (launchTeamBtn) {
    const teamName = launchTeamBtn.dataset["team"];
    if (teamName) {
      // The snapshot already holds this team's members, so the composer can be
      // team-aware (member avatars) without a host round-trip. The snapshot does
      // not carry a per-team goal, so the composer simply omits the goal line.
      const team = lastLibrary?.teams.find((t) => t.name === teamName);
      openTaskOverlay({
        eyebrow: "LAUNCH TEAM",
        subject: teamName,
        ...(team ? { members: team.roleNames } : {}),
        accent: "team",
        placeholder: "Describe what this team should do...",
        submitLabel: "Launch",
        onSubmit: (task) => vscode.postMessage({ type: "launch-team", name: teamName, task }),
      });
    }
    return;
  }

  // ── Group 2: Team editor interactions ────────────────────────────────────
  if (handleTeamEditorClick(target)) return;

  // Delete skill button.
  const deleteBtn = target.closest<HTMLElement>('[data-action="skill-delete"][data-skill]');
  if (deleteBtn) {
    const skillName = deleteBtn.dataset["skill"];
    if (skillName) vscode.postMessage({ type: "skill-delete", name: skillName });
    return;
  }

  // Attach skill (picker row).
  const attachBtn = target.closest<HTMLElement>('[data-action="attach-skill"][data-role][data-skill]');
  if (attachBtn) {
    const roleName = attachBtn.dataset["role"];
    const skillName = attachBtn.dataset["skill"];
    if (roleName && skillName) {
      vscode.postMessage({ type: "attach-skill", roleName, skillName });
    }
    return;
  }

  // Detach skill (chip remove).
  const detachBtn = target.closest<HTMLElement>('[data-action="detach-skill"][data-role][data-skill]');
  if (detachBtn) {
    const roleName = detachBtn.dataset["role"];
    const skillName = detachBtn.dataset["skill"];
    if (roleName && skillName) {
      vscode.postMessage({ type: "detach-skill", roleName, skillName });
    }
    return;
  }

  // scan-repo button.
  if (target.closest<HTMLElement>('[data-action="scan-repo"]')) {
    discoverScanning = true;
    render();
    vscode.postMessage({ type: "scan-repo" });
    return;
  }

  // discover filter chip.
  const chipBtn = target.closest<HTMLElement>("[data-chip]");
  if (chipBtn && chipBtn.dataset["chip"]) {
    discoverChip = chipBtn.dataset["chip"] as DiscoverGroup | "all";
    render();
    return;
  }

  // browse-source.
  const browseBtn = target.closest<HTMLElement>('[data-action="browse-source"][data-item-id]');
  if (browseBtn) {
    const itemId = browseBtn.dataset["itemId"];
    if (itemId) vscode.postMessage({ type: "browse-source", itemId });
    return;
  }

  // adopt-agent.
  const adoptAgentBtn = target.closest<HTMLElement>('[data-action="adopt-agent"][data-item-id]');
  if (adoptAgentBtn) {
    const itemId = adoptAgentBtn.dataset["itemId"];
    if (itemId) vscode.postMessage({ type: "adopt-agent", itemId });
    return;
  }

  // adopt-skill.
  const adoptSkillBtn = target.closest<HTMLElement>('[data-action="adopt-skill"][data-item-id]');
  if (adoptSkillBtn) {
    const itemId = adoptSkillBtn.dataset["itemId"];
    if (itemId) vscode.postMessage({ type: "adopt-skill", itemId });
    return;
  }

  // ── Group 4: Discover Dispatch ───────────────────────────────────────────
  // Open the dispatch composer PRE-FILLED with the discovered agent: look the
  // item up in the cache by id (== item.source), seed the composer with its name
  // as newRoleName + its resolved engine. The composer's existing Dispatch path
  // then posts the real board {type:"dispatch", newRoleName, engineId,
  // description} message.
  const dispatchBtn2 = target.closest<HTMLElement>('[data-action="discover-dispatch"][data-item-id]');
  if (dispatchBtn2) {
    const itemId = dispatchBtn2.dataset["itemId"];
    if (itemId) openDispatchForDiscovered(itemId);
    return;
  }
}

/**
 * Group 2: clicks inside the team editor modal. Returns true if handled.
 *
 * Member toggle flips a role in/out of teamDraftMembers and re-renders; Save
 * posts team-save with the live name + members; Delete posts team-delete;
 * Cancel closes the editor by switching back to the Teams tab.
 */
function handleTeamEditorClick(target: HTMLElement): boolean {
  // Member toggle row.
  const memberRow = target.closest<HTMLElement>('[data-action="team-member-toggle"][data-role]');
  if (memberRow) {
    const roleName = memberRow.dataset["role"];
    if (roleName) {
      teamDraftMembers = teamDraftMembers.includes(roleName)
        ? teamDraftMembers.filter((r) => r !== roleName)
        : [...teamDraftMembers, roleName];
      render();
    }
    return true;
  }

  // Save: read the live name from the input (the most authoritative value),
  // then post the team. A team with no name is not saved.
  if (target.closest<HTMLElement>('[data-action="team-save"]')) {
    const nameInput = document.querySelector<HTMLInputElement>(".team-editor-name-input");
    const name = nameInput?.value.trim() ?? teamDraftName.trim();
    if (name) {
      const goal = teamDraftGoal.trim();
      vscode.postMessage({
        type: "team-save",
        name,
        roleNames: teamDraftMembers,
        ...(goal ? { goal } : {}),
      });
    }
    return true;
  }

  // Delete (edit mode only).
  const teamDeleteBtn = target.closest<HTMLElement>('[data-action="team-delete"][data-team]');
  if (teamDeleteBtn) {
    const teamName = teamDeleteBtn.dataset["team"];
    if (teamName) vscode.postMessage({ type: "team-delete", name: teamName });
    return true;
  }

  // Cancel / close: drop the editor and return to the Teams tab.
  if (target.closest<HTMLElement>('[data-action="team-cancel"]')) {
    vscode.postMessage({ type: "switch-library-tab", tab: "teams" });
    return true;
  }

  return false;
}

/**
 * Group 4: open the dispatch composer pre-filled for a discovered agent. The
 * itemId equals the discovered item's `source`. We resolve the item from the
 * cache, derive its engine the same way the discover mapper does (so it lands on
 * a KNOWN_ENGINE_IDS value), and seed the composer's form with the agent name as
 * a free-text newRoleName + that engine. The existing Dispatch button then fires
 * the real board dispatch message via buildDispatchMessage.
 */
function openDispatchForDiscovered(itemId: string): void {
  const item = discoverItems.find((i) => i.source === itemId);
  if (!item) return;
  // Mirror discover-view's deriveEngineId: copilot for copilot/plugin agent
  // kinds or a copilot engineHint; acp otherwise. Both are KNOWN_ENGINE_IDS.
  const engineId =
    item.kind === "copilot-agent" ||
    item.kind === "copilot-chatmode" ||
    item.kind === "plugin-agent" ||
    (item.engineHint !== undefined && item.engineHint.startsWith("copilot"))
      ? "copilot"
      : "acp";

  // The composer is a board affordance; open it from cached options and seed the
  // form. Jump to the board first (closing any stale overlay) so the fresh
  // composer is the only one mounted, then open it.
  setView("board");
  openComposer(lastComposerOptions ?? fallbackComposerOptions());
  composerForm = { description: "", newRoleName: item.name, engineId };
  // Reflect the seed in the open composer's inputs.
  const newRoleInput = document.querySelector<HTMLInputElement>('[data-action="new-role"]');
  if (newRoleInput) newRoleInput.value = item.name;
  markEnginePillSelected(engineId, undefined);
  syncDispatchButton();
}

// ─── Anatomy click delegation (ported from anatomy-main.ts) ────────────────────

function handleAnatomyClick(target: HTMLElement): void {
  // Back to board: the anatomy modal close (× header button) and Cancel footer.
  // The anatomy protocol has no close/save verb, so leaving the editor is a
  // pure client-side navigation back to the board.
  if (
    target.closest<HTMLElement>('[data-action="anatomy-close"]') ||
    target.closest<HTMLElement>('[data-action="anatomy-cancel"]')
  ) {
    backToBoard();
    return;
  }

  // "+ Add skill": toggle the in-editor skill picker open/closed.
  if (target.closest<HTMLElement>('[data-action="add-skill"]')) {
    const picker = document.querySelector<HTMLElement>(".anatomy-canvas [data-skill-picker]");
    if (picker) picker.hidden = !picker.hidden;
    return;
  }

  // Picker row: attach the chosen (not-yet-attached) skill to the open role.
  const attachRow = target.closest<HTMLElement>(
    '[data-action="anatomy-attach-skill"][data-skill]',
  );
  if (attachRow) {
    const skillName = attachRow.dataset["skill"];
    if (skillName) {
      vscode.postMessage({ type: "role-attach-skill", roleName: currentRoleName, skillName });
    }
    return;
  }

  // Skill chip "×": detach the skill from the open role.
  const removeChip = target.closest<HTMLElement>('[data-action="remove-skill"][data-skill]');
  if (removeChip) {
    const skillName = removeChip.dataset["skill"];
    if (skillName) {
      vscode.postMessage({ type: "role-detach-skill", roleName: currentRoleName, skillName });
    }
    return;
  }

  // Rail row click: scroll matching canvas section into view.
  const railRow = target.closest<HTMLElement>(".anatomy-rail-row[data-section]");
  if (railRow) {
    const section = railRow.dataset["section"];
    if (section) {
      const canvasSection = document.querySelector<HTMLElement>(
        `.anatomy-canvas [data-section="${CSS.escape(section)}"]`,
      );
      canvasSection?.scrollIntoView({ behavior: "smooth" });
    }
    return;
  }

  // Engine pill: set the active engine (preserve the current model sub-label).
  const enginePill = target.closest<HTMLElement>(
    '.anatomy-engine-pill[data-action="role-set-engine"][data-engine]',
  );
  if (enginePill) {
    const engineId = enginePill.dataset["engine"] ?? "";
    if (engineId) {
      vscode.postMessage({
        type: "role-set-engine",
        roleName: currentRoleName,
        engineId,
        ...(currentEngineModel !== undefined ? { model: currentEngineModel } : {}),
      });
    }
    return;
  }

  // Autonomy button.
  const autonomyBtn = target.closest<HTMLElement>(
    '.anatomy-autonomy-btn[data-action="role-set-autonomy"][data-value]',
  );
  if (autonomyBtn) {
    const value = autonomyBtn.dataset["value"] as Autonomy;
    vscode.postMessage({ type: "role-set-autonomy", roleName: currentRoleName, autonomy: value });
    return;
  }

  // Grant "grant" button.
  const grantBtn = target.closest<HTMLElement>(
    '[data-action="grant"][data-skill][data-tool][data-write]',
  );
  if (grantBtn) {
    const tool = grantBtn.dataset["tool"] ?? "";
    const write = grantBtn.dataset["write"] === "true";
    vscode.postMessage({ type: "grant-tool", roleName: currentRoleName, tool, write });
    return;
  }

  // "attach-anyway" button: remove closest grant gate from DOM.
  if (target.closest<HTMLElement>('[data-action="attach-anyway"]')) {
    target.closest(".anatomy-grant-gate")?.remove();
    return;
  }

  // "cancel-grant" button: remove closest grant gate from DOM.
  if (target.closest<HTMLElement>('[data-action="cancel-grant"]')) {
    target.closest(".anatomy-grant-gate")?.remove();
    return;
  }
}

// ─── Review click delegation (ported from review-main.ts) ──────────────────────

function handleReviewClick(target: HTMLElement): void {
  // Back to board: the review screen's close affordance (none in the markup
  // today, but reachable via the board tab strip; keep a guarded hook).
  if (target.closest<HTMLElement>('[data-action="review-close"], .rv-close')) {
    backToBoard();
    return;
  }

  const btn = target.closest<HTMLElement>("[data-action]");
  if (!btn) return;

  const id = btn.dataset["id"];
  const action = btn.dataset["action"];
  if (!id) return;

  if (action === "merge") {
    vscode.postMessage({ type: "merge", agentId: id });
  } else if (action === "discard") {
    // Discard always removes the card, so leave the full-page review immediately
    // for instant feedback (mirrors resume below); the host also navigates back
    // when the card resolves away, as a safety net for the async/Merge path.
    vscode.postMessage({ type: "discard", agentId: id });
    backToBoard();
  } else if (action === "resume") {
    // Resume a stopped agent in its worktree (sendBack verb, empty feedback).
    vscode.postMessage({ type: "sendBack", agentId: id, feedback: "" });
    backToBoard();
  } else if (action === "stop") {
    vscode.postMessage({ type: "stop", agentId: id });
  } else if (action === "resolve-conflict") {
    vscode.postMessage({ type: "resolve-conflict", agentId: id });
  } else if (action === "finish-merge") {
    vscode.postMessage({ type: "finish-merge", agentId: id });
  } else if (action === "create-pr") {
    vscode.postMessage({ type: "create-pr", agentId: id });
  } else if (action === "retry-cleanup") {
    vscode.postMessage({ type: "retry-cleanup", agentId: id });
  } else if (action === "sendBack") {
    const footer = btn.closest("footer");
    const textarea = footer?.querySelector<HTMLTextAreaElement>("textarea");
    const text = textarea?.value.trim();
    if (text) {
      vscode.postMessage({ type: "sendBack", agentId: id, feedback: text });
      if (textarea) textarea.value = "";
    }
  }
}

// ─── History click delegation ──────────────────────────────────────────────────

/**
 * Clicks inside the in-session History tab. The close button returns to the
 * board; a focusable timeline entry focuses its agent on the board, reusing the
 * SAME focus path a card click uses (clear the close suppression, reset to the
 * default drawer tab). Tolerant when no entry carries a data-id.
 */
function handleHistoryClick(target: HTMLElement): void {
  // Close: back to the board.
  if (target.closest<HTMLElement>('[data-action="close-history"]')) {
    backToBoard();
    return;
  }

  // A focusable timeline entry: focus its agent on the board. Match whichever
  // element carries the data-id (an explicit focus action or a history entry).
  const entry = target.closest<HTMLElement>('[data-action="focus"], .history-entry[data-id]');
  const id = entry?.dataset["id"];
  if (id) {
    backToBoard();
    closedDrawerId = null;
    drawerTab = "instructions";
    vscode.postMessage({ type: "focus", agentId: id });
  }
}

// ─── Input delegation (branches on `view`) ─────────────────────────────────────

document.addEventListener("input", (e) => {
  const target = e.target;
  if (!(target instanceof HTMLElement)) return;
  const action = (target as HTMLInputElement | HTMLTextAreaElement).dataset["action"];
  if (!action) return;

  // Task overlay is view-independent; enable/disable its submit as the user types.
  if (action === "task-overlay-input") {
    syncTaskSubmitButton();
    return;
  }

  // Composer inputs are board-scoped (the overlay lives in board view).
  if (view === "board") {
    if (action === "new-role") {
      const value = (target as HTMLInputElement).value;
      composerForm.newRoleName = value || undefined;
      if (value) {
        delete composerForm.roleName;
        document.querySelectorAll<HTMLElement>(".composer-chip").forEach((chip) => chip.classList.remove("selected"));
      }
      syncDispatchButton();
      return;
    }
    if (action === "goal") {
      composerForm.goal = (target as HTMLInputElement).value || undefined;
      return;
    }
    if (action === "task") {
      composerForm.description = (target as HTMLTextAreaElement).value;
      syncDispatchButton();
      return;
    }
  }

  if (view === "library") {
    if (action === "edit-body") {
      editorBody = (target as HTMLTextAreaElement).value;
      return;
    }
    if (action === "discover-filter") {
      discoverFilter = (target as HTMLInputElement).value;
      render();
      return;
    }
    // Team editor inputs: track the live name/goal so Save uses the latest
    // value and a re-render (e.g. toggling a member) never loses typed text.
    if (action === "team-name") {
      teamDraftName = (target as HTMLInputElement).value;
      return;
    }
    if (action === "team-goal") {
      teamDraftGoal = (target as HTMLInputElement).value;
      return;
    }
  }
});

// ─── Change delegation (anatomy tool toggles) ──────────────────────────────────

document.addEventListener("change", (e) => {
  if (view !== "anatomy") return;
  const target = e.target;
  if (!(target instanceof HTMLInputElement)) return;
  if (
    !target.classList.contains("anatomy-tool-read-input") &&
    !target.classList.contains("anatomy-tool-write-input")
  ) {
    return;
  }

  const grid = target.closest(".anatomy-tools-grid");
  if (!grid) return;

  const checkboxes = grid.querySelectorAll<HTMLInputElement>(
    "input[type='checkbox'].anatomy-tool-read-input, input[type='checkbox'].anatomy-tool-write-input",
  );

  const readTools: ReadTool[] = [];
  const writeTools: WriteTool[] = [];
  const mcpState = new Map<string, { read: boolean; write: boolean }>();

  checkboxes.forEach((cb) => {
    const toolName = cb.dataset["tool"];
    if (!toolName) return;
    const isWrite = cb.dataset["mode"] === "write";

    if (cb.dataset["mcp"] === "1") {
      const entry = mcpState.get(toolName) ?? { read: false, write: false };
      if (isWrite) entry.write = cb.checked;
      else entry.read = cb.checked;
      mcpState.set(toolName, entry);
      return;
    }

    if (!cb.checked) return;
    if (isWrite) {
      writeTools.push(toolName as WriteTool);
    } else {
      readTools.push(toolName as ReadTool);
    }
  });

  const tools: ToolGrant = { builtins: { read: readTools, write: writeTools } };
  if (mcpState.size > 0) {
    tools.mcp = [...mcpState.entries()].map(([server, g]) => ({
      server,
      read: g.read,
      write: g.write,
    }));
  }
  vscode.postMessage({ type: "role-set-tools", roleName: currentRoleName, tools });
});

// ─── Blur delegation (anatomy soul + instructions textareas) ───────────────────

document.addEventListener(
  "blur",
  (e) => {
    if (view !== "anatomy") return;
    const target = e.target;
    if (!(target instanceof HTMLTextAreaElement)) return;

    const action = target.dataset["action"];
    if (action === "role-set-soul") {
      vscode.postMessage({ type: "role-set-soul", roleName: currentRoleName, soul: target.value });
    } else if (action === "role-set-instructions") {
      vscode.postMessage({
        type: "role-set-instructions",
        roleName: currentRoleName,
        instructions: target.value,
      });
    }
  },
  { capture: true },
);

// ─── Ready handshake ───────────────────────────────────────────────────────────
// Post once on load; the host replies with `state` (and replays any cached
// library/anatomy/review snapshot it has). Library/anatomy/review data is
// otherwise fetched lazily on first navigation.

render();
vscode.postMessage({ type: "ready" });
