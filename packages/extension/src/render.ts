import type { CardVM } from "@maestro/cockpit";
import { escapeHtml } from "./html.js";

function approvalPanel(card: CardVM): string {
  if (
    card.state !== "awaiting-approval" ||
    !card.pendingApprovalId ||
    !card.engineCapabilities?.approvals
  ) {
    return "";
  }
  const id = escapeHtml(card.id);
  const approvalId = escapeHtml(card.pendingApprovalId);
  const detailHtml = card.approvalDetail
    ? `<div class="approval-detail"><span class="approval-tool">${escapeHtml(card.approvalDetail.tool)}</span><span class="approval-summary">${escapeHtml(card.approvalDetail.description)}</span></div>`
    : "";
  return `<div class="approval-panel">${detailHtml}<button data-action="approve" data-id="${id}" data-approval-id="${approvalId}">Allow</button><button data-action="deny" data-id="${id}" data-approval-id="${approvalId}">Deny</button></div>`;
}

function steerBox(card: CardVM): string {
  if (!card.engineCapabilities?.steerable) return "";
  if (card.state !== "working" && card.state !== "awaiting-approval") return "";
  const id = escapeHtml(card.id);
  return `<form class="steer-form" data-action="steer" data-id="${id}"><input type="text" class="steer-input" placeholder="Send guidance..." aria-label="Steer agent" /><button type="submit">Send</button></form>`;
}

function sendBackBox(card: CardVM): string {
  if (card.state !== "done" && card.state !== "conflict") return "";
  const id = escapeHtml(card.id);
  return `<form class="sendback-form" data-action="sendBack" data-id="${id}"><textarea class="sendback-input" rows="2" placeholder="Feedback for another attempt..." aria-label="Send back with feedback"></textarea><button type="submit">Send back</button></form>`;
}

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

/** Pure HTML for one agent card. Every engine-supplied string is escaped. */
export function renderCardHTML(card: CardVM): string {
  const canApprove = card.engineCapabilities?.approvals ?? false;
  const autoBadge =
    !canApprove && card.state !== "merged" && card.state !== "discarded"
      ? `<span class="badge">auto</span>`
      : "";
  return `<section class="card state-${card.state}${card.attention ? " attention" : ""}" data-id="${escapeHtml(card.id)}">
  <header><span class="role">${escapeHtml(card.roleName)}</span><span class="engine">${escapeHtml(card.engineId)}</span>${autoBadge}<span class="status">${card.state}</span></header>
  <pre class="output">${escapeHtml(card.output)}</pre>
  ${detail(card)}
  ${approvalPanel(card)}
  ${steerBox(card)}
  ${sendBackBox(card)}
  <footer>${actions(card)}</footer>
</section>`;
}
