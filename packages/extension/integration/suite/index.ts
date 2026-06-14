import * as path from "node:path";
import Mocha from "mocha";
import { glob } from "glob";

/**
 * Mocha suite entry. @vscode/test-electron calls run() from inside the launched
 * Extension Host. It discovers the compiled *.test.js files in this directory
 * and runs them with Mocha, resolving when the run completes (and rejecting if
 * any test fails).
 */
export async function run(): Promise<void> {
  const mocha = new Mocha({ ui: "tdd", color: true, timeout: 60_000 });
  const testsRoot = __dirname;

  const files = await glob("**/*.test.js", { cwd: testsRoot });
  for (const file of files) {
    mocha.addFile(path.resolve(testsRoot, file));
  }

  await new Promise<void>((resolve, reject) => {
    try {
      mocha.run((failures) => {
        if (failures > 0) {
          reject(new Error(`${failures} test(s) failed.`));
        } else {
          resolve();
        }
      });
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}
