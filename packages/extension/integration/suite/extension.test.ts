import * as assert from "node:assert";
import * as path from "node:path";
import { readFileSync } from "node:fs";
import * as vscode from "vscode";

/**
 * Read the extension manifest once. The package root is three levels up from the
 * compiled test at out/integration/suite/extension.test.js.
 */
interface Manifest {
  publisher: string;
  name: string;
  contributes?: { commands?: Array<{ command: string }> };
}

function readManifest(): Manifest {
  const pkgPath = path.resolve(__dirname, "..", "..", "..", "package.json");
  return JSON.parse(readFileSync(pkgPath, "utf8")) as Manifest;
}

suite("Maestro extension activation", () => {
  const manifest = readManifest();
  const extensionId = `${manifest.publisher}.${manifest.name}`;

  test("the extension is discoverable by id", () => {
    const ext = vscode.extensions.getExtension(extensionId);
    assert.ok(ext, `extension ${extensionId} should be present`);
  });

  test("activate() resolves without throwing", async () => {
    const ext = vscode.extensions.getExtension(extensionId);
    assert.ok(ext, `extension ${extensionId} should be present`);
    // Calling activate() twice is safe: VS Code returns the same exports. The
    // assertion is simply that this resolves rather than rejecting.
    await ext.activate();
    assert.strictEqual(ext.isActive, true, "extension should be active after activate()");
  });

  test("contributed commands are registered after activation", async () => {
    const ext = vscode.extensions.getExtension(extensionId);
    assert.ok(ext, `extension ${extensionId} should be present`);
    await ext.activate();

    const contributed = (manifest.contributes?.commands ?? []).map((c) => c.command);
    assert.ok(contributed.length > 0, "manifest should contribute at least one command");

    // getCommands(true) includes commands registered at runtime by activate().
    const registered = new Set(await vscode.commands.getCommands(true));
    for (const command of contributed) {
      assert.ok(registered.has(command), `command ${command} should be registered`);
    }
  });
});
