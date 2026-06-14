import * as path from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { runTests } from "@vscode/test-electron";

/**
 * Entry point for the VS Code integration harness. Downloads a real VS Code
 * build (cached under .vscode-test/), launches it with this extension loaded,
 * and points it at the compiled Mocha suite index. The suite asserts the
 * activation wiring: that activate() resolves and the contributed commands are
 * registered. This is the one automated check that exercises activate().
 */
async function main(): Promise<void> {
  // The package root is the extension under test. From the compiled location
  // out/integration/runTest.js, the package root is two levels up.
  const extensionDevelopmentPath = path.resolve(__dirname, "..", "..");
  // The compiled suite index sits next to this file under out/integration/suite.
  const extensionTestsPath = path.resolve(__dirname, "suite", "index.js");

  // activate() registers commands only when a workspace folder is open, so open
  // an empty temp folder. The folder need not be a git repo: GitWorkspaceManager
  // only stores the path at construction, and the hydrate path is guarded.
  const workspaceDir = mkdtempSync(path.join(tmpdir(), "maestro-e2e-"));

  // VS Code derives a Unix-domain IPC socket from --user-data-dir. The default
  // path lives under the deeply nested package dir (.vscode-test/user-data),
  // which can exceed the OS 103-char socket-path limit and fail with
  // EINVAL. Point user-data and extensions at a short temp path to avoid it.
  const userDataDir = mkdtempSync(path.join(tmpdir(), "mvsc-ud-"));
  const extensionsDir = mkdtempSync(path.join(tmpdir(), "mvsc-ext-"));

  try {
    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      // The temp folder is the workspace activate() needs; --disable-extensions
      // isolates from other installed extensions; the short user-data and
      // extensions dirs keep the IPC socket path under the OS limit.
      launchArgs: [
        workspaceDir,
        "--disable-extensions",
        `--user-data-dir=${userDataDir}`,
        `--extensions-dir=${extensionsDir}`,
      ],
    });
  } catch (err) {
    console.error("Failed to run integration tests:", err);
    process.exit(1);
  }
}

void main();
