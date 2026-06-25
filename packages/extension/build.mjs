import { build, context } from "esbuild";
import { copyFileSync, mkdirSync } from "node:fs";

const watch = process.argv.includes("--watch");

/** Extension host: CJS, node platform, vscode external. */
const host = {
  entryPoints: ["src/extension.ts"],
  outfile: "dist/extension.js",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node18",
  external: ["vscode"],
  sourcemap: true,
};

/**
 * Single-page app webview client: the ONE router bundle that mounts
 * board/library/anatomy/review in-place. Browser IIFE, no externals.
 */
const appWebview = {
  entryPoints: ["src/webview/app-main.ts"],
  outfile: "dist/webview/app-main.js",
  bundle: true,
  platform: "browser",
  format: "iife",
  target: "es2020",
  sourcemap: true,
};

function copyStyles() {
  mkdirSync("dist/webview", { recursive: true });
  // The single merged stylesheet (board + library + anatomy + review).
  copyFileSync("src/webview/app.css", "dist/webview/app.css");
}

if (watch) {
  const a = await context(host);
  const b = await context(appWebview);
  await Promise.all([a.watch(), b.watch()]);
  copyStyles();
  console.log("esbuild watching...");
} else {
  await Promise.all([build(host), build(appWebview)]);
  copyStyles();
  console.log("esbuild done");
}
