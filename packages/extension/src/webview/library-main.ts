import type { HostToLibrary, LibrarySnapshot, LibraryToHost } from "../library-protocol.js";
import {
  renderTabBar,
  renderSkillCard,
  renderSkillEditor,
  renderPickerRows,
  renderRoleList,
} from "../library-render.js";
import { selectDiscover } from "../discover-view.js";
import type { DiscoverGroup } from "../discover-view.js";
import { renderDiscoverTab } from "../discover-render.js";
import type { DiscoveredItem, McpInventory } from "@maestro/config";

interface VsCodeApi {
  postMessage(msg: LibraryToHost): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();
const root = document.getElementById("root");

// ─── Editor state (body textarea content tracked locally) ─────────────────────

let editorBody = "";

// ─── Discover tab state ───────────────────────────────────────────────────────

let discoverItems: DiscoveredItem[] = [];
let discoverFilter = "";
let discoverChip: DiscoverGroup | "all" = "all";
let discoverScanning = false;
let discoverMcp: McpInventory = { servers: [] };
let lastSnapshot: LibrarySnapshot | undefined;

// ─── Render ───────────────────────────────────────────────────────────────────

function render(snap: LibrarySnapshot): void {
  if (!root) return;

  const tabBar = renderTabBar(snap.tab);
  let body = "";

  if (snap.editing !== undefined) {
    body = renderSkillEditor(snap.editing, editorBody);
  } else if (snap.picker !== undefined) {
    body = renderPickerRows(snap.skills, snap.picker.roleName);
  } else {
    switch (snap.tab) {
      case "skills":
        body = snap.skills.length
          ? `<div class="skill-grid">${snap.skills.map(renderSkillCard).join("")}</div>`
          : `<p class="lib-empty">No skills yet. Click "New skill" to create one.</p>`;
        break;
      case "agents":
        body = renderRoleList(snap.roles);
        break;
      case "teams":
        body = renderTeamList(snap.teams);
        break;
      case "discover": {
        const vm = selectDiscover(discoverItems, discoverFilter, discoverChip, discoverScanning);
        body = renderDiscoverTab(vm);
        break;
      }
      default: {
        const _exhaustive: never = snap.tab;
        void _exhaustive;
        body = "";
      }
    }
  }

  const newSkillBtn =
    snap.tab === "skills" && snap.editing === undefined && snap.picker === undefined
      ? `<div class="lib-toolbar"><button class="lib-new-btn" data-action="skill-create">+ New skill</button></div>`
      : "";

  root.innerHTML = `${tabBar}${newSkillBtn}<div class="lib-body">${body}</div>`;
}

function renderTeamList(teams: { name: string; roleNames: string[] }[]): string {
  if (teams.length === 0) {
    return `<div class="role-list-empty">No teams configured.</div>`;
  }
  return `<div class="role-list">${teams
    .map(
      (t) => `<div class="role-item"><span class="role-name">${escHtml(t.name)}</span><span class="role-engine">${t.roleNames.map(escHtml).join(", ")}</span></div>`,
    )
    .join("")}</div>`;
}

function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ─── Host message listener ─────────────────────────────────────────────────────

window.addEventListener("message", (e: MessageEvent<HostToLibrary>) => {
  const data = e.data;
  switch (data.type) {
    case "library-state":
      // Reset editor body when entering or leaving edit mode
      if (data.snapshot.editing !== undefined && data.snapshot.editing.name !== "") {
        // editing existing: keep existing body (will be populated via textarea)
        // We don't get the body from the snapshot VM; it comes from the host on open.
        // For now editorBody starts empty; the controller pushes the body via the snapshot.
        // Note: The controller does NOT carry the body in the snapshot (that's the SKILL.md body).
        // The body is a separate field not in SkillCardVM. For P3 the editor textarea starts empty.
        // The user types the body. This is intentional (P4 wires the body read).
      }
      lastSnapshot = data.snapshot;
      // When switching TO the discover tab for the first time, auto-scan
      if (data.snapshot.tab === "discover" && discoverItems.length === 0 && !discoverScanning) {
        discoverScanning = true;
        vscode.postMessage({ type: "scan-repo" });
      }
      render(data.snapshot);
      break;
    case "discover-results":
      discoverItems = data.items;
      discoverMcp = data.mcp;
      discoverScanning = false;
      if (lastSnapshot) render(lastSnapshot);
      break;
    default: {
      const _exhaustive: never = data;
      void _exhaustive;
      break;
    }
  }
});

// ─── Click delegation ─────────────────────────────────────────────────────────

document.addEventListener("click", (e) => {
  const target = e.target;
  if (!(target instanceof HTMLElement)) return;

  // Tab switch
  const tabBtn = target.closest<HTMLElement>(".tab[data-tab]");
  if (tabBtn) {
    const tab = tabBtn.dataset["tab"];
    if (tab) {
      vscode.postMessage({ type: "switch-library-tab", tab: tab as LibrarySnapshot["tab"] });
    }
    return;
  }

  // New skill button
  if (target.closest<HTMLElement>('[data-action="skill-create"]')) {
    editorBody = "";
    vscode.postMessage({ type: "skill-create" });
    return;
  }

  // Skill card click -> open editor (send skill-create with name? No -- we open via a synthetic edit.)
  // The controller opens the editor when it receives skill-create, with an empty card for create-mode.
  // For editing an existing skill we post a special message. But the protocol doesn't have "open-edit".
  // Per the task spec: "skill card click -> open editor (the host pushes a snapshot with `editing`)".
  // We reuse skill-create here for P3 (P4 will add skill-open). For now clicking an existing card
  // in the grid just triggers create-mode (blank editor). This is acceptable for P3.
  const skillCard = target.closest<HTMLElement>(".skill-card[data-skill]");
  if (skillCard) {
    editorBody = "";
    vscode.postMessage({ type: "skill-create" });
    return;
  }

  // Editor Save button
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

  // Editor Cancel button
  if (target.closest<HTMLElement>('[data-action="skill-cancel"]')) {
    // Cancel: switch back to skills tab (reload)
    vscode.postMessage({ type: "switch-library-tab", tab: "skills" });
    return;
  }

  // Delete skill button
  const deleteBtn = target.closest<HTMLElement>('[data-action="skill-delete"][data-skill]');
  if (deleteBtn) {
    const skillName = deleteBtn.dataset["skill"];
    if (skillName && confirm(`Delete skill "${skillName}"? This cannot be undone.`)) {
      vscode.postMessage({ type: "skill-delete", name: skillName });
    }
    return;
  }

  // Attach skill (picker row)
  const attachBtn = target.closest<HTMLElement>('[data-action="attach-skill"][data-role][data-skill]');
  if (attachBtn) {
    const roleName = attachBtn.dataset["role"];
    const skillName = attachBtn.dataset["skill"];
    if (roleName && skillName) {
      vscode.postMessage({ type: "attach-skill", roleName, skillName });
    }
    return;
  }

  // Detach skill (chip remove)
  const detachBtn = target.closest<HTMLElement>('[data-action="detach-skill"][data-role][data-skill]');
  if (detachBtn) {
    const roleName = detachBtn.dataset["role"];
    const skillName = detachBtn.dataset["skill"];
    if (roleName && skillName) {
      vscode.postMessage({ type: "detach-skill", roleName, skillName });
    }
    return;
  }

  // scan-repo button
  if (target.closest<HTMLElement>('[data-action="scan-repo"]')) {
    discoverScanning = true;
    if (lastSnapshot) render(lastSnapshot);
    vscode.postMessage({ type: "scan-repo" });
    return;
  }

  // discover filter chip
  const chipBtn = target.closest<HTMLElement>('[data-chip]');
  if (chipBtn && chipBtn.dataset["chip"]) {
    discoverChip = chipBtn.dataset["chip"] as DiscoverGroup | "all";
    if (lastSnapshot) render(lastSnapshot);
    return;
  }

  // browse-source
  const browseBtn = target.closest<HTMLElement>('[data-action="browse-source"][data-item-id]');
  if (browseBtn) {
    const itemId = browseBtn.dataset["itemId"];
    if (itemId) vscode.postMessage({ type: "browse-source", itemId });
    return;
  }

  // adopt-agent
  const adoptAgentBtn = target.closest<HTMLElement>('[data-action="adopt-agent"][data-item-id]');
  if (adoptAgentBtn) {
    const itemId = adoptAgentBtn.dataset["itemId"];
    if (itemId) vscode.postMessage({ type: "adopt-agent", itemId });
    return;
  }

  // adopt-skill
  const adoptSkillBtn = target.closest<HTMLElement>('[data-action="adopt-skill"][data-item-id]');
  if (adoptSkillBtn) {
    const itemId = adoptSkillBtn.dataset["itemId"];
    if (itemId) vscode.postMessage({ type: "adopt-skill", itemId });
    return;
  }

  // discover-dispatch (deferred: post browse-source as no-op for now)
  const dispatchBtn2 = target.closest<HTMLElement>('[data-action="discover-dispatch"][data-item-id]');
  if (dispatchBtn2) {
    const itemId = dispatchBtn2.dataset["itemId"];
    if (itemId) vscode.postMessage({ type: "browse-source", itemId }); // deferred to P2 composer
    return;
  }
});

// ─── Input tracking ───────────────────────────────────────────────────────────

document.addEventListener("input", (e) => {
  const target = e.target;
  if (!(target instanceof HTMLElement)) return;
  const action = (target as HTMLInputElement | HTMLTextAreaElement).dataset["action"];
  if (action === "edit-body") {
    editorBody = (target as HTMLTextAreaElement).value;
  }
  if (action === "discover-filter") {
    discoverFilter = (target as HTMLInputElement).value;
    if (lastSnapshot) render(lastSnapshot);
  }
});

// ─── Tell host we are ready ───────────────────────────────────────────────────

vscode.postMessage({ type: "open-library" });
