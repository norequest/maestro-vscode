import { describe, expect, it } from "vitest";
import { isWebviewMessage } from "@hallucinate/cockpit";
import { isLibraryMessage } from "../src/library-protocol.js";
import { isAnatomyMessage } from "../src/anatomy-protocol.js";
import {
  isAppMessage,
  type AppView,
  type HostToApp,
  type OpenTaskComposerMessage,
} from "../src/app-protocol.js";

describe("isAppMessage", () => {
  // ─── accepts a representative of EACH host-bound protocol ───────────────────

  it("accepts a valid board (cockpit) message: ready", () => {
    expect(isAppMessage({ type: "ready" })).toBe(true);
  });

  it("accepts a valid board (cockpit) message: focus", () => {
    expect(isAppMessage({ type: "focus", agentId: "a1" })).toBe(true);
  });

  it("accepts a valid board (cockpit) message: dispatch", () => {
    expect(isAppMessage({ type: "dispatch", description: "do the thing" })).toBe(true);
  });

  it("accepts a valid library message: open-library", () => {
    expect(isAppMessage({ type: "open-library" })).toBe(true);
  });

  it("accepts a valid library message: switch-library-tab", () => {
    expect(isAppMessage({ type: "switch-library-tab", tab: "skills" })).toBe(true);
  });

  it("accepts a valid library message: launch-team", () => {
    expect(isAppMessage({ type: "launch-team", name: "Squad", task: "ship it" })).toBe(true);
  });

  it("rejects the removed launch-default message (standalone default agent gone)", () => {
    expect(isAppMessage({ type: "launch-default", task: "ship it" })).toBe(false);
  });

  it("accepts a valid anatomy message: open-anatomy", () => {
    expect(isAppMessage({ type: "open-anatomy", roleName: "Tester" })).toBe(true);
  });

  it("accepts a valid anatomy message: grant-tool", () => {
    expect(
      isAppMessage({ type: "grant-tool", roleName: "Tester", tool: "Git", write: true })
    ).toBe(true);
  });

  // ─── rejects junk ──────────────────────────────────────────────────────────

  it("rejects an unknown type", () => {
    expect(isAppMessage({ type: "nonsense" })).toBe(false);
  });

  it("rejects null", () => {
    expect(isAppMessage(null)).toBe(false);
  });

  it("rejects a number", () => {
    expect(isAppMessage(42)).toBe(false);
  });

  it("rejects an empty object (no type field)", () => {
    expect(isAppMessage({})).toBe(false);
  });

  // ─── still enforces per-field validation of the composed guards ────────────

  it("rejects a board message with the wrong field type (focus missing agentId)", () => {
    expect(isAppMessage({ type: "focus" })).toBe(false);
  });

  it("rejects a library message that is malformed (switch-library-tab bad tab)", () => {
    expect(isAppMessage({ type: "switch-library-tab", tab: "not-a-tab" })).toBe(false);
  });

  it("rejects an anatomy message that is malformed (grant-tool non-boolean write)", () => {
    expect(
      isAppMessage({ type: "grant-tool", roleName: "Tester", tool: "Git", write: "yes" })
    ).toBe(false);
  });

  // ─── disjointness: a library message is rejected by isWebviewMessage but
  //     accepted by isAppMessage (the composition is what makes it pass) ──────

  it("a valid library message is rejected by isWebviewMessage but accepted by isAppMessage", () => {
    const libMsg = { type: "open-library" };
    expect(isWebviewMessage(libMsg)).toBe(false);
    expect(isLibraryMessage(libMsg)).toBe(true);
    expect(isAppMessage(libMsg)).toBe(true);
  });

  it("a valid anatomy message is rejected by isWebviewMessage and isLibraryMessage but accepted by isAppMessage", () => {
    const anatomyMsg = { type: "open-anatomy", roleName: "Tester" };
    expect(isWebviewMessage(anatomyMsg)).toBe(false);
    expect(isLibraryMessage(anatomyMsg)).toBe(false);
    expect(isAnatomyMessage(anatomyMsg)).toBe(true);
    expect(isAppMessage(anatomyMsg)).toBe(true);
  });

  it("a valid board message is rejected by isLibraryMessage and isAnatomyMessage but accepted by isAppMessage", () => {
    const boardMsg = { type: "merge", agentId: "a1" };
    expect(isLibraryMessage(boardMsg)).toBe(false);
    expect(isAnatomyMessage(boardMsg)).toBe(false);
    expect(isWebviewMessage(boardMsg)).toBe(true);
    expect(isAppMessage(boardMsg)).toBe(true);
  });

  // ─── open-task-composer is host->webview, NOT a webview->host message ───────
  // It travels HostToApp (host to the in-page composer), so isAppMessage (the
  // inbound webview->host guard) must NOT accept it: the directions stay disjoint.

  it("rejects open-task-composer (it is a host->webview message, not webview->host)", () => {
    expect(isAppMessage({ type: "open-task-composer", teams: [] })).toBe(false);
    expect(
      isAppMessage({ type: "open-task-composer", teams: [{ name: "dev", specialists: 2 }] })
    ).toBe(false);
  });
});

// ─── open-task-composer message shape (HostToApp host->webview variant) ────────
// There is no runtime guard for the host->webview direction (the host is trusted),
// so these assert the structural contract: a valid message carries a teams array
// (possibly empty) of { name, specialists } and is a member of the HostToApp union.

describe("OpenTaskComposerMessage shape", () => {
  function isOpenTaskComposer(m: unknown): m is OpenTaskComposerMessage {
    if (typeof m !== "object" || m === null) return false;
    const r = m as Record<string, unknown>;
    if (r["type"] !== "open-task-composer") return false;
    if (!Array.isArray(r["teams"])) return false;
    return r["teams"].every(
      (t) =>
        typeof t === "object" &&
        t !== null &&
        typeof (t as Record<string, unknown>)["name"] === "string" &&
        typeof (t as Record<string, unknown>)["specialists"] === "number"
    );
  }

  it("accepts a message with a populated teams array", () => {
    const msg: HostToApp = {
      type: "open-task-composer",
      teams: [
        { name: "dev", specialists: 2 },
        { name: "design", specialists: 1 },
      ],
    };
    expect(isOpenTaskComposer(msg)).toBe(true);
  });

  it("accepts a message with an empty teams array (Default-agent-only composer)", () => {
    const msg: HostToApp = { type: "open-task-composer", teams: [] };
    expect(isOpenTaskComposer(msg)).toBe(true);
  });

  it("rejects a malformed message (teams not an array)", () => {
    expect(isOpenTaskComposer({ type: "open-task-composer", teams: "nope" })).toBe(false);
  });

  it("rejects a malformed message (a team missing specialists)", () => {
    expect(
      isOpenTaskComposer({ type: "open-task-composer", teams: [{ name: "dev" }] })
    ).toBe(false);
  });
});

// ─── AppView surfaces ──────────────────────────────────────────────────────────
// The router mounts one of a fixed set of surfaces. The in-session History tab
// (M10 Phase F) is one of them, so the AppView union must admit "history".

describe("AppView union", () => {
  it("admits the in-session history surface", () => {
    const v: AppView = "history";
    expect(v).toBe("history");
  });
});
