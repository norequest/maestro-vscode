import { describe, expect, it, vi } from "vitest";

/**
 * Focused test for StageWebviewPanel.openTaskComposer: it must thread the
 * hand-built teams (name + specialist count) into the host->webview
 * `open-task-composer` message so the in-page composer can render its chip
 * selector (one chip per team, teams only) with no native OS dropdown. An empty
 * teams array drives the webview's no-teams create-team CTA.
 *
 * stage.ts imports `vscode` at module top, which is not resolvable under Vitest,
 * so we stub the module. The stub's createWebviewPanel records every postMessage
 * payload into a shared array we assert against.
 */

const posted: unknown[] = [];

vi.mock("vscode", () => {
  const panel = {
    webview: {
      html: "",
      cspSource: "vscode-resource:",
      asWebviewUri: (u: unknown) => ({ toString: () => String(u) }),
      onDidReceiveMessage: () => ({ dispose() {} }),
      postMessage: (m: unknown) => {
        posted.push(m);
        return Promise.resolve(true);
      },
    },
    onDidDispose: () => ({ dispose() {} }),
    reveal() {},
    dispose() {},
  };
  return {
    ViewColumn: { Active: -1 },
    Uri: {
      joinPath: (base: unknown, ...parts: string[]) => ({
        base,
        parts,
        toString: () => parts.join("/"),
      }),
    },
    window: {
      createWebviewPanel: () => panel,
    },
  };
});

// Imported AFTER vi.mock so the stub is in place.
const { StageWebviewPanel } = await import("../src/stage.js");

function freshStage() {
  posted.length = 0;
  const stage = new StageWebviewPanel(
    { fsPath: "/repo" } as never,
    () => {},
  );
  stage.reveal(); // creates the (stubbed) panel so postMessage is live
  posted.length = 0; // drop the first-paint state post
  return stage;
}

describe("StageWebviewPanel.openTaskComposer", () => {
  it("posts open-task-composer with the teams (name + specialist count) verbatim", () => {
    const stage = freshStage();
    const teams = [
      { name: "dev", specialists: 2 },
      { name: "design", specialists: 1 },
    ];
    stage.openTaskComposer(teams);
    expect(posted).toContainEqual({ type: "open-task-composer", teams });
  });

  it("posts open-task-composer with an empty teams array (drives the no-teams CTA)", () => {
    const stage = freshStage();
    stage.openTaskComposer([]);
    expect(posted).toContainEqual({ type: "open-task-composer", teams: [] });
  });
});
