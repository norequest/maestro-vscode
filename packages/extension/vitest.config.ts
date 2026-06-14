import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // The Mocha-based VS Code integration suite lives under integration/ (and
    // compiles to out/). It must NEVER be loaded by Vitest: it uses Mocha's tdd
    // globals and the real `vscode` module, neither available here.
    exclude: ["node_modules", "dist", "out", "integration"],
    environment: "node",
  },
});
