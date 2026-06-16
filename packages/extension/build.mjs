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

/** Webview client: browser IIFE, no externals. */
const webview = {
  entryPoints: ["src/webview/main.ts"],
  outfile: "dist/webview/main.js",
  bundle: true,
  platform: "browser",
  format: "iife",
  target: "es2020",
  sourcemap: true,
};

/** Library webview client: browser IIFE, no externals. */
const libraryWebview = {
  entryPoints: ["src/webview/library-main.ts"],
  outfile: "dist/webview/library-main.js",
  bundle: true,
  platform: "browser",
  format: "iife",
  target: "es2020",
  sourcemap: true,
};

function copyStyles() {
  mkdirSync("dist/webview", { recursive: true });
  copyFileSync("src/webview/style.css", "dist/webview/style.css");
  copyFileSync("src/webview/library.css", "dist/webview/library.css");
}

if (watch) {
  const a = await context(host);
  const b = await context(webview);
  const c = await context(libraryWebview);
  await Promise.all([a.watch(), b.watch(), c.watch()]);
  copyStyles();
  console.log("esbuild watching...");
} else {
  await Promise.all([build(host), build(webview), build(libraryWebview)]);
  copyStyles();
  console.log("esbuild done");
}
