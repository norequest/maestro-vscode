# Maestro (VS Code extension)

Conduct a team of AI coding agents in isolated git worktrees.

## Develop / run (F5)
1. `pnpm install` at the repo root.
2. Build the libraries + extension: `pnpm -r build` (the six `@maestro/*` libraries build first, then this extension's esbuild bundles).
3. Open the **repo root** in VS Code (not `packages/extension`) and press **F5** (Run Maestro · dogfood on this repo). A second VS Code window — the Extension Development Host — opens with the repo folder already loaded, so Maestro has an open git repo to work in.
4. Click the Maestro icon (the **four-bars** icon in the activity bar, not a rocket), open the **Roster**, click the title-bar **+** (Spawn Agent), and type a task. Watch the Stage stream the agent's output; on done, review the diff and click **Merge** or **Discard**.

> If you instead open the `packages/extension` subfolder, F5 still works — that folder ships its own `.vscode/launch.json` that resolves the dev-host folder back to the repo root.

### CLI fallback (when F5 / launch config is unavailable)
Launch the Extension Development Host directly with the `code` CLI, opening the repo root and pointing at the extension:

```bash
"<path-to>/Visual Studio Code.app/Contents/Resources/app/bin/code" \
  <repo-root> \
  --extensionDevelopmentPath=<repo-root>/packages/extension \
  --new-window
```

The first positional argument (`<repo-root>`) is the folder VS Code opens in the dev host; `--extensionDevelopmentPath` loads this extension from source. Build first (`pnpm -r build`) so `dist/` exists.

Requires the GitHub `copilot` CLI on your PATH and a Copilot subscription (the engine reuses your `gh` / Copilot auth, no API key needed).

## Build outputs
- `dist/extension.js` — the extension host (CJS bundle, `vscode` external)
- `dist/webview/main.js` + `dist/webview/style.css` — the Stage webview client

## Architecture
The extension is a thin shell over pure, unit-tested packages:
- `@maestro/core` — the orchestrator state machine
- `@maestro/cockpit` — the pure presenter (events to renderable state)
- `@maestro/workspace` — real git worktree isolation + merge
- `@maestro/adapter-copilot` — the Copilot CLI engine adapter

`src/controller.ts`, `src/roster-map.ts`, and `src/html.ts`/`src/render.ts` hold the testable logic; `src/extension.ts`, `src/roster.ts`, and `src/stage.ts` are the VS Code glue.
