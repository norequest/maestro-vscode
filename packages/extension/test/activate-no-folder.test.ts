import { describe, it, expect, beforeAll } from "vitest";
import Module from "node:module";
import { createRequire } from "node:module";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

/**
 * Regression test for the no-folder activation bug.
 *
 * The bug: activate() returned early (after a warning) when no workspace folder
 * was open, registering ZERO commands. The view-title `+` button and the command
 * palette then reported `command 'maestro.spawnAgent' not found`. With eager
 * activation (`onStartupFinished`) this fires on every startup into an empty
 * window.
 *
 * The fix: command + tree-view registration is unconditional; only the
 * folder-dependent wiring is gated. This test loads the BUNDLED extension
 * (dist/extension.js) with a stub `vscode` module that reports NO workspace
 * folder, calls activate(), and asserts the core contributed commands are still
 * registered. It mirrors the headless probe technique (Module._load override).
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, "..");
const distPath = path.join(packageRoot, "dist", "extension.js");
const requireCjs = createRequire(import.meta.url);

const EXPECTED_COMMANDS = [
  "maestro.spawnAgent",
  "maestro.launchTeam",
  "maestro.openStage",
] as const;

class EventEmitter {
  private listeners: Array<(e: unknown) => void> = [];
  event = (fn: (e: unknown) => void): { dispose(): void } => {
    this.listeners.push(fn);
    return { dispose: () => {} };
  };
  fire(e: unknown): void {
    for (const fn of this.listeners) fn(e);
  }
  dispose(): void {}
}

const uriOf = (p: string): unknown => ({ fsPath: p, path: p, scheme: "file", toString: () => p });

/** Build a minimal `vscode` stub. `workspaceFolders` is the only knob we vary. */
function makeVscodeStub(workspaceFolders: unknown, registered: Set<string>): unknown {
  return {
    EventEmitter,
    TreeItem: class {
      constructor(public label: unknown, public collapsibleState: unknown) {}
    },
    ThemeIcon: class {
      constructor(public id: unknown, public color: unknown) {}
    },
    ThemeColor: class {
      constructor(public id: unknown) {}
    },
    Uri: {
      file: (p: string) => uriOf(p),
      joinPath: (base: { fsPath: string }, ...parts: string[]) => uriOf([base.fsPath, ...parts].join("/")),
      parse: (s: string) => uriOf(s),
    },
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    StatusBarAlignment: { Left: 1, Right: 2 },
    ViewColumn: { One: 1, Two: 2, Beside: -2, Active: -1 },
    ExtensionMode: { Production: 1, Development: 2, Test: 3 },
    workspace: {
      workspaceFolders,
      getConfiguration: () => ({ get: (_k: string, d: unknown) => d }),
      onDidChangeConfiguration: () => ({ dispose() {} }),
      onDidChangeWorkspaceFolders: () => ({ dispose() {} }),
    },
    window: {
      showInformationMessage: async () => undefined,
      showWarningMessage: async () => undefined,
      showErrorMessage: async () => undefined,
      showInputBox: async () => undefined,
      showQuickPick: async () => undefined,
      registerTreeDataProvider: () => ({ dispose() {} }),
      createWebviewPanel: () => ({
        webview: {
          html: "",
          options: {},
          onDidReceiveMessage: () => ({ dispose() {} }),
          postMessage: async () => true,
          asWebviewUri: (u: unknown) => u,
          cspSource: "vscode-resource:",
        },
        onDidDispose: () => ({ dispose() {} }),
        reveal() {},
        dispose() {},
        visible: true,
      }),
      createOutputChannel: () => ({ appendLine() {}, append() {}, show() {}, dispose() {} }),
      registerWebviewViewProvider: () => ({ dispose() {} }),
      createStatusBarItem: () => ({ text: "", tooltip: "", command: "", show() {}, hide() {}, dispose() {} }),
    },
    commands: {
      registerCommand: (id: string) => {
        registered.add(id);
        return { dispose() {} };
      },
      executeCommand: async () => undefined,
    },
  };
}

function makeContext(): unknown {
  return {
    subscriptions: [],
    extensionUri: uriOf(path.join(packageRoot)),
    extensionPath: packageRoot,
    globalState: { get: () => undefined, update: async () => {} },
    workspaceState: { get: () => undefined, update: async () => {} },
    extensionMode: 2,
  };
}

/**
 * Load the freshly-built bundle with a `vscode` stub for the given
 * workspaceFolders value, run activate(), and return the set of registered
 * command ids.
 */
async function activateWith(workspaceFolders: unknown): Promise<Set<string>> {
  const registered = new Set<string>();
  const stub = makeVscodeStub(workspaceFolders, registered);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ModuleAny = Module as any;
  const origLoad = ModuleAny._load;
  ModuleAny._load = function (request: string, ...rest: unknown[]) {
    if (request === "vscode") return stub;
    return origLoad.call(this, request, ...rest);
  };
  try {
    // Bust the dist module from the CJS cache so activate() re-evaluates with the
    // stub installed (each case gets a clean module-level state).
    const resolved = requireCjs.resolve(distPath);
    delete requireCjs.cache[resolved];
    const ext = requireCjs(distPath) as { activate: (ctx: unknown) => Promise<void> };
    await ext.activate(makeContext());
    return registered;
  } finally {
    ModuleAny._load = origLoad;
    const resolved = requireCjs.resolve(distPath);
    delete requireCjs.cache[resolved];
  }
}

describe("activate() with no workspace folder", () => {
  beforeAll(() => {
    // The bundle under dist/ must reflect the current source. Building here keeps
    // the test self-contained (it does not assume a prior `node build.mjs`).
    execFileSync("node", ["build.mjs"], { cwd: packageRoot, stdio: "ignore" });
  });

  it("registers the core commands when a folder IS open", async () => {
    const registered = await activateWith([
      { uri: uriOf(packageRoot), name: "maestro", index: 0 },
    ]);
    for (const cmd of EXPECTED_COMMANDS) {
      expect(registered.has(cmd), `expected ${cmd} to be registered`).toBe(true);
    }
  });

  it("STILL registers the core commands when NO folder is open (regression)", async () => {
    // This is the bug: before the fix, activate() returned early and registered
    // zero commands here, so the view-title `+` button and command palette were
    // dead. After the fix, registration is unconditional.
    const registered = await activateWith(undefined);
    for (const cmd of EXPECTED_COMMANDS) {
      expect(registered.has(cmd), `expected ${cmd} to be registered with no folder`).toBe(true);
    }
  });
});
