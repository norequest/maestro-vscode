import type { CockpitState, HostToWebview, WebviewToHost } from "@maestro/cockpit";
import { renderCardHTML } from "../render.js";

interface VsCodeApi {
  postMessage(msg: WebviewToHost): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();
const root = document.getElementById("root");

function render(state: CockpitState): void {
  if (!root) return;
  root.innerHTML = state.cards.length
    ? state.cards.map(renderCardHTML).join("")
    : `<p class="empty">No agents yet. Use the Roster's + (Spawn Agent) to start one.</p>`;
}

window.addEventListener("message", (e: MessageEvent<HostToWebview>) => {
  if (e.data.type === "state") render(e.data.state);
});

document.addEventListener("click", (e) => {
  const target = e.target;
  if (!(target instanceof HTMLElement)) return;
  const btn = target.closest<HTMLElement>("[data-action]");
  if (btn) {
    const id = btn.dataset["id"];
    const action = btn.dataset["action"];
    if (!id) return;
    if (action === "stop") vscode.postMessage({ type: "stop", agentId: id });
    else if (action === "merge") vscode.postMessage({ type: "merge", agentId: id });
    else if (action === "discard") vscode.postMessage({ type: "discard", agentId: id });
    return;
  }
  const card = target.closest<HTMLElement>(".card");
  const cardId = card?.dataset["id"];
  if (cardId) vscode.postMessage({ type: "focus", agentId: cardId });
});

vscode.postMessage({ type: "ready" });
