# Maestro: architecture and development

## Architecture

Maestro splits a pure orchestration brain from a thin VS Code shell. The brain has no `vscode` or filesystem imports, so it unit-tests in isolation; the shell wires it to real git, real adapters, and the webview.

| Package | Role |
| --- | --- |
| `@maestro/core` | Orchestrator state machine, adapter contract, workspace contract, shared types and engine-id constants. Pure TypeScript. |
| `@maestro/adapter-copilot` | Drives the Copilot CLI in isolated (`--agent`) and fleet single-session modes; materializes roles as Copilot custom agents. |
| `@maestro/adapter-acp` | Hand-rolled ACP (JSON-RPC) adapter behind an injectable transport; drives `gemini`. |
| `@maestro/conformance` | Shared adapter conformance suite both engine families pass. |
| `@maestro/workspace` | `GitWorkspaceManager` over real `git worktree`: isolate, diff, merge, rebase, PR. |
| `@maestro/config` | `.conductor/` YAML parsing/validation and the repo agent-discovery scanner. |
| `@maestro/cockpit` | Pure presenter: a reducer plus an attention-first state selector and the host/webview protocol. |
| `@maestro/extension` | The VS Code extension: activation, commands, the Conducting Board webview, and wiring. |

Engines plug in behind one small adapter contract, so adding an engine does not touch the core. The dependency graph points inward to `@maestro/core`, with no cycles and `@maestro/extension` as the only package that imports `vscode`.

## Development

A pnpm workspace monorepo (plain `pnpm -r`, no Turborepo).

```bash
pnpm install
pnpm verify     # build, typecheck, and test every package
pnpm -r test    # tests only
```

Develop the extension:

```bash
cd packages/extension
pnpm watch                 # esbuild watch (bundles host + webview)
# then press F5 in VS Code to launch an Extension Development Host
npx @vscode/vsce package --no-dependencies   # build a VSIX
```

The extension bundles every `@maestro/*` package into a self-contained `dist/extension.js` via esbuild (the webview is a separate IIFE bundle); `tsc` is typecheck-only.

When iterating on the extension, a running Extension Development Host does not pick up a rebuild on its own: close that window and press F5 again (a reload is not enough).

See [`PUBLISHING.md`](PUBLISHING.md) for the Marketplace release process.
