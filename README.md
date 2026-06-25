# Maestro

Conduct a team of AI coding agents in isolated git worktrees, from inside your editor.

Maestro is a model-agnostic, editor-native VS Code extension. You dispatch agents, each one runs against its own engine, you watch them stream on a single Conducting Board, and you review each agent's diff before it merges. Maestro drives every engine through its own CLI, so it reuses that tool's existing authentication instead of asking you for an API key.

> Status: working name, pre-release (extension `v0.1.10`). The orchestration core is built and tested: 8 packages, 1609 tests, installable from a VSIX. See [What works](#what-works).

## Why

Most "AI team" tools lock you into one model or one vendor's auth. Maestro keeps the orchestration brain pure and model-agnostic, then plugs engines in behind a small adapter contract:

- Reuse the auth you already have. Each engine runs as a CLI subprocess (`copilot`, `gemini`), so Maestro never handles your keys.
- Real isolation. By default every agent works in its own `git worktree` on its own branch, so parallel agents cannot step on each other.
- Review before merge. An agent finishing means a diff to review, not a surprise commit. You merge, discard, send back with feedback, or open a PR.
- Editor-native. No separate app. The board, the agent library, the anatomy editor, and the diff review all live in one VS Code panel.

## Concepts

The rest of this doc uses these terms:

- Agent: one running engine working on one task. On the board it is a card.
- Role: a reusable agent definition (engine, instructions, tools, skills, soul, autonomy). Lives in `.conductor/roles/`.
- Team: a named group of roles with a designated lead. Lives in `.conductor/teams/`.
- Skill: a reusable instruction packet you can attach to a role.
- Soul: an optional persona document a role references.
- Worktree: the isolated `git worktree` (its own branch) an agent works in, so parallel agents never collide.
- Engine: the CLI Maestro drives (GitHub Copilot, or any ACP engine such as Gemini), plugged in behind one adapter contract.
- Autonomy: how much an agent may do without asking. `manual`, `auto-approve-safe`, or `yolo`.
- Virtual agent: a read-only sub-agent card dispatched inside a fleet conductor's single session (see [Engines and modes](#engines-and-modes)).

## What works

- Parallel agents, each in an isolated `git worktree`, streamed live on the Conducting Board.
- Two engine families behind a shared conformance suite:
  - GitHub Copilot CLI, run two ways: isolated native custom agents (`copilot --agent <slug>`, one worktree per agent) and fleet single-session teams (one conductor session that dispatches named teammates in-context).
  - Generic ACP (Agent Client Protocol), driving `gemini --acp --stdio`.
- Review the diff, then Merge, Discard, or Send back with feedback. Optional PR mode (push branch + `gh pr create`).
- Approvals and steering: approve or deny tool requests, steer a running agent, re-launch a finished agent in the same worktree.
- Persistence and recovery: agents survive a window reload (rehydrated from a per-agent JSONL log, without re-spawning).
- `.conductor/` YAML configuration for roles, teams, and skills, with a first-run scaffold and vendored team skills.
- Production-grade merge: serialized merge mutex, rebase onto the base, conflict resolution in the editor, and cleanup-failure recovery.

## Engines and modes

Maestro registers three adapters. Which one runs depends on the engine of the role (or team lead) you dispatch.

| Engine id | Used for | Isolation model |
| --- | --- | --- |
| `copilot` | A single Copilot agent, or an ACP-style isolated team | One `git worktree` and branch per agent. Each agent has its own diff. |
| `copilot-fleet` | A team whose lead engine is Copilot | One conductor session. Named teammates run as in-session sub-agents (Copilot's built-in `task` tool). They share the conductor's worktree. |
| `acp` | A single Gemini/ACP agent, or an ACP team | One `git worktree` and branch per agent. |

Fleet single-session mode in detail:

- The conductor (the team lead) dispatches each teammate as a sub-agent inside one Copilot session, instead of launching N separate sessions.
- Each teammate is materialized as a Copilot custom agent profile at `.github/agents/<name>.agent.md` inside the conductor's worktree, git-excluded so it never shows up in the review diff. Nothing is written to your global `~/.copilot/agents/`.
- Sub-agents appear as read-only virtual cards nested under the conductor on the board. They share the conductor's worktree, so they have no separate branch or diff and cannot be merged, steered, or sent back individually. You review the conductor's combined diff.

Trade-off: fleet gives you one shared context and one combined diff. Isolated mode gives every agent its own worktree and its own reviewable diff. Single-agent dispatch and ACP teams always use isolated worktrees.

## Requirements

- VS Code `^1.90.0`
- One or more engine CLIs on your `PATH`:
  - GitHub Copilot CLI (`copilot`) for the Copilot engine.
  - Gemini CLI (`gemini`) for the ACP engine.
- `git` (worktrees) and, for PR mode, the GitHub CLI (`gh`).

## Install

Until Maestro is on the Marketplace, install the packaged VSIX:

```bash
code --install-extension packages/extension/maestro-<version>.vsix
```

Open a folder that is a git repository, then click the Maestro icon in the activity bar to open the Conducting Board.

## Usage

1. Open the Conducting Board from the Maestro sidebar (or run Maestro: Open Conducting Board).
2. Dispatch work:
   - New Agent: pick a role, an engine, write the task, and dispatch. The agent gets a fresh worktree.
   - Launch Team: pick a team. A Copilot-led team runs as a single fleet session (see above); other teams run one isolated agent per role.
3. Watch agents stream on the board. Approve or deny tool requests, steer a running agent, or stop it.
4. When an agent finishes, open the diff. Merge, Discard, or Send back with feedback. With PR mode on, open a pull request instead.
5. Library holds the reusable definitions behind the board: Agents (roles), Teams, and Skills. The Anatomy editor tunes a role's soul, instructions, tools, skills, engine, and autonomy.
6. Discover scans the repo for agent definitions in other formats (Copilot, Claude, Continue, Cursor) so you can adopt or dispatch them.

## Commands

| Command | Title |
| --- | --- |
| `maestro.openStage` | Maestro: Open Conducting Board |
| `maestro.newAgent` | Maestro: New Agent |
| `maestro.spawnAgent` | Maestro: Spawn Agent (quick) |
| `maestro.launchTeam` | Maestro: Launch Team |
| `maestro.openLibrary` | Maestro: Open Library |
| `maestro.openAnatomy` | Maestro: Edit Agent Anatomy |

## Configuration

Roles, teams, and skills live in a `.conductor/` directory in your workspace. Maestro scaffolds a starter set on first run.

```
.conductor/
  roles/        # one YAML per role (engine, instructions, tools, skills, autonomy)
  teams/        # named groups of roles, with a designated lead
  souls/        # optional persona docs referenced by roles
  config.yaml   # workspace defaults, e.g. maxParallelAgents
```

`config.yaml` controls workspace-level defaults, including `maxParallelAgents` (how many agents run concurrently; the rest queue).

Extension settings (VS Code Settings, search "Maestro"):

- `maestro.prMode` create a pull request (push branch + `gh pr create`) instead of a local merge. Default `false`.
- `maestro.prDraft` open pull requests as drafts when PR mode is on. Default `false`.
- `maestro.discoverPlugins` scan installed Copilot plugins during discovery. Default `false`.

## Architecture

Maestro splits a pure orchestration brain from a thin VS Code shell. The brain has no `vscode` or filesystem imports, so it unit-tests in isolation; the shell wires it to real git, real adapters, and the webview.

| Package | Role |
| --- | --- |
| `@maestro/core` | Orchestrator state machine, adapter contract, workspace contract. Pure TypeScript. |
| `@maestro/adapter-copilot` | Drives the Copilot CLI in isolated (`--agent`) and fleet single-session modes; materializes roles as Copilot custom agents. |
| `@maestro/adapter-acp` | Hand-rolled ACP (JSON-RPC) adapter behind an injectable transport; drives `gemini`. |
| `@maestro/conformance` | Shared adapter conformance suite both engine families pass. |
| `@maestro/workspace` | `GitWorkspaceManager` over real `git worktree`: isolate, diff, merge, rebase, PR. |
| `@maestro/config` | `.conductor/` YAML parsing/validation and the repo agent-discovery scanner. |
| `@maestro/cockpit` | Pure presenter: a reducer plus an attention-first state selector and the host/webview protocol. |
| `@maestro/extension` | The VS Code extension: activation, commands, the Conducting Board webview, and wiring. |

Engines plug in behind one small adapter contract, so adding an engine does not touch the core. The dependency graph points inward to `@maestro/core`, with no cycles and `@maestro/extension` as the only package that imports `vscode`.

## Development

A pnpm workspace monorepo.

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
npx vsce package --no-dependencies   # build a VSIX
```

The extension bundles every `@maestro/*` package into a self-contained `dist/extension.js` via esbuild (the webview is a separate IIFE bundle); `tsc` is typecheck-only.

When iterating on the extension, a running Extension Development Host does not pick up a rebuild on its own: close that window and press F5 again (a reload is not enough).

## License

MIT. See [LICENSE](LICENSE).
