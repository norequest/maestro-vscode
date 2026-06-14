# @maestro/adapter-copilot

The GitHub Copilot engine adapter for Maestro. Spawns the agentic Copilot CLI
(`copilot -p`) as a subprocess in an isolated git worktree, streams its output,
and reports completion on process exit.

## Auth

Reuses your **GitHub Copilot subscription** — no API key. Set a GitHub token with
Copilot access via `COPILOT_GITHUB_TOKEN` (or `GH_TOKEN` / `GITHUB_TOKEN`), or run
`gh auth login`. Requires the `copilot` binary (`npm install -g @github/copilot`,
v1.0.52+ recommended).

## Model

`--model` selects the underlying model *through* Copilot: `claude-sonnet-4.6`,
`gpt-5`, `gemini-3-pro`, `auto`, etc. (subscription-entitlement dependent). Set it
on the role's `engine.model`.

## v1 scope and limitations

- **Plain-text streaming.** Output is streamed as `output` events; there are no
  structured per-tool events. (`--output-format json` exists but its schema is
  undocumented — a future upgrade.)
- **No interactive approval.** Each agent runs `--allow-all --no-ask-user`, which is
  safe because it is sandboxed to its own worktree; the conductor reviews the **diff**
  before merging. Per-tool approval awaits the ACP-mode upgrade.
- **One-shot.** `copilot -p` runs once and exits; mid-run steering (`send`) is a no-op
  in v1 (`--continue` chaining is a later addition).

Capabilities reported: `{ streaming: true, structuredEvents: false, approvals: false, steerable: false }`.

## Testing

`pnpm --filter @maestro/adapter-copilot test` runs the full suite with a fake spawn —
no `copilot` process, no network, no token. The optional live smoke test
(`pnpm --filter @maestro/adapter-copilot build && MAESTRO_LIVE=1 COPILOT_GITHUB_TOKEN=... pnpm --filter @maestro/adapter-copilot smoke`)
exercises the real `copilot`.
