import type { CardVM } from "@maestro/cockpit";
import { escapeHtml } from "./html.js";

function actions(card: CardVM): string {
  const id = escapeHtml(card.id);
  const stop = `<button data-action="stop" data-id="${id}">Stop</button>`;
  const merge = `<button data-action="merge" data-id="${id}">Merge</button>`;
  const discard = `<button data-action="discard" data-id="${id}">Discard</button>`;
  switch (card.state) {
    case "working":
    case "awaiting-approval":
    case "preparing":
      return stop;
    case "done":
      return `${merge} ${discard}`;
    case "conflict":
    case "error":
    case "stopped":
      return discard;
    case "merged":
    case "discarded":
      return "";
  }
}

function detail(card: CardVM): string {
  if (card.state === "done" && card.diff) {
    const files = card.diff.files.map((f) => `<li>${escapeHtml(f)}</li>`).join("");
    return `<div class="summary">${escapeHtml(card.summary ?? "")}</div><ul class="files">${files}</ul>`;
  }
  if (card.state === "conflict" && card.conflictFiles) {
    const files = card.conflictFiles.map((f) => `<li>${escapeHtml(f)}</li>`).join("");
    return `<div class="conflict">Merge conflict in:</div><ul class="files">${files}</ul>`;
  }
  if (card.state === "error" && card.error) {
    return `<pre class="error">${escapeHtml(card.error)}</pre>`;
  }
  return "";
}

/** Pure HTML for one agent card. Engine output is always escaped. */
export function renderCardHTML(card: CardVM): string {
  const auto = !card.attention && card.engineId === "copilot" ? `<span class="badge">auto</span>` : "";
  return `<section class="card state-${card.state}${card.attention ? " attention" : ""}" data-id="${escapeHtml(card.id)}">
  <header><span class="role">${escapeHtml(card.roleName)}</span><span class="engine">${escapeHtml(card.engineId)}</span>${auto}<span class="status">${card.state}</span></header>
  <pre class="output">${escapeHtml(card.output)}</pre>
  ${detail(card)}
  <footer>${actions(card)}</footer>
</section>`;
}
