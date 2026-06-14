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

// Steer + send-back forms.
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

document.addEventListener("click", (e) => {
  const target = e.target;
  if (!(target instanceof HTMLElement)) return;
  const btn = target.closest<HTMLElement>("[data-action]");
  if (btn) {
    const id = btn.dataset["id"];
    const action = btn.dataset["action"];
    if (!id) return;
    if (action === "stop") {
      vscode.postMessage({ type: "stop", agentId: id });
    } else if (action === "merge") {
      vscode.postMessage({ type: "merge", agentId: id });
    } else if (action === "discard") {
      vscode.postMessage({ type: "discard", agentId: id });
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
    }
    return;
  }
  const card = target.closest<HTMLElement>(".card");
  const cardId = card?.dataset["id"];
  if (cardId) vscode.postMessage({ type: "focus", agentId: cardId });
});

vscode.postMessage({ type: "ready" });
