# @hallucinate/adapter-copilot

The GitHub Copilot engine adapter for Hallucinate. Spawns the agentic Copilot CLI
(`copilot -p`) as a subprocess in an isolated git worktree, streams its output,
and reports completion on process exit.

## Auth

Reuses your **GitHub Copilot subscription**, no API key. Set a GitHub token with
Copilot access via `COPILOT_GITHUB_TOKEN` (or `GH_TOKEN` / `GITHUB_TOKEN`), or run
`gh auth login`. Requires the `copilot` binary (`npm install -g @github/copilot`,
v1.0.52+ recommended).

## Model

`--model` selects the underlying model *through* Copilot: `claude-sonnet-4.6`,
`gpt-5`, `gemini-3-pro`, `auto`, etc. (subscription-entitlement dependent). Set it
on the role's `engine.model`.

## Output format

- **Default: plain-text streaming.** Output is streamed as `output` events. This
  is the v1 behavior and the mode the conformance suite runs against.
- **Opt-in JSON mode.** Construct the adapter with `{ outputFormat: "json" }` to
  add `--output-format json` and parse the structured stream into formatted
  output events (assistant text rendered verbatim; tool calls rendered as
  `▸ <name>: <path-or-command>`). The installed CLI's exact JSON schema is not
  confirmed, so parsing is tolerant: any line that is not valid JSON, or is an
  unrecognized shape, degrades to the raw line. The stream is never dropped and
  parsing never throws. In json mode the instance advertises
  `structuredEvents: true`; in text mode it stays `false`. `approvals` is `false`
  in both modes (`copilot -p` is headless and autonomous).

## v1 scope and limitations
- **No interactive approval.** Each agent runs `--allow-all --no-ask-user`, which is
  safe because it is sandboxed to its own worktree; the operator reviews the **diff**
  before merging. Per-tool approval awaits the ACP-mode upgrade.
- **One-shot.** `copilot -p` runs once and exits; mid-run steering (`send`) is a no-op
  in v1 (`--continue` chaining is a later addition).

Capabilities reported: `{ streaming: true, structuredEvents: false, approvals: false, steerable: false }`.

## Testing

`pnpm --filter @hallucinate/adapter-copilot test` runs the full suite with a fake spawn:
no `copilot` process, no network, no token. The optional live smoke test
(`pnpm --filter @hallucinate/adapter-copilot build && HALLUCINATE_LIVE=1 COPILOT_GITHUB_TOKEN=... pnpm --filter @hallucinate/adapter-copilot smoke`)
exercises the real `copilot`.
