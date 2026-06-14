# Maestro for VS Code: Design

**Date:** 2026-06-14
**Status:** Design approved, pre-implementation
**Working name:** Maestro (placeholder; the human conductor metaphor, since "Conductor" is the product we improve on)

## One-liner

A VS Code extension where you are the conductor of a team of AI coding agents. You spawn specialized agents, watch them work in parallel inside isolated git worktrees, and approve, steer, and merge their output. Each agent is powered by any CLI agent (Claude Code, Codex, Gemini, aider, GitHub Copilot CLI) through a common engine adapter, so roles are model-agnostic.

## Problem and inspiration

[Conductor](https://conductor.build) (the Mac app) proved two ideas: run multiple Claude Code agents in parallel, and isolate each in its own git worktree so they never collide. Its limits: it is Claude-Code-only, and it is a standalone Mac app rather than living where the code lives.

Maestro keeps Conductor's two best ideas and adds two things:

1. **Model-agnostic.** A team member is a *role* backed by a *swappable engine*, not a single tool.
2. **Editor-native.** It lives in VS Code, a webview-based cockpit next to your code.

## Core decisions (settled during design)

| Decision | Choice | Why |
| --- | --- | --- |
| Orchestration model | Human-as-conductor | User stays in control and coordinates; no autonomous lead agent in v1 |
| What a team member is | A **role** backed by a swappable **engine** | Roles are stable structure; engines are interchangeable |
| How an engine runs work | Spawn the engine's **CLI as a background subprocess** | Reuses existing tool subscriptions (CLI auth), fully controllable, buildable today |
| Conducting UX | Live **dashboard** of streaming agent panes | "Watch in parallel, jump in when needed" |
| Reference product | Conductor, made model-agnostic + editor-native | Beat its limits, keep its strengths |

The pivotal technical insight: spawning a CLI subprocess is the strongest path, not a workaround. A VS Code extension is Node.js and can `child_process.spawn` anything. Modern agentic CLIs are practically designed to be driven headlessly. The real engineering is not "can we spawn it" but "how cleanly does each CLI expose a non-interactive, structured interface," which is exactly what the adapter layer absorbs.

## Architecture: four layers

**1. Conductor Panel (UI).** Webview-based dashboard: a sidebar roster of agents plus a main panel of live streaming panes, diffs, and approval prompts. Knows nothing about which engine runs; renders a common "agent session" shape.

**2. Orchestrator Core (the brain).** Owns the run loop: holds the team definition, assigns tasks to roles, tracks each agent's state machine, routes events between adapters and UI. Pure TypeScript, no VS Code or engine specifics. Independently testable.

**3. Engine Adapters (the swappable part).** One module per AI tool, each implementing the same interface. The orchestrator only ever talks to this interface, so adding an engine is writing one adapter and nothing else changes.

**4. Workspace Manager.** Creates and tears down an isolated git worktree plus branch per agent, and exposes diffs for review and merge.

**Flow in one line:** assign a task to a role, the orchestrator spawns that role's engine adapter inside a fresh worktree, events stream back to the panel, you approve, steer, and merge.

**The key design bet:** the adapter contract is the whole product. Get it right and the UI, new engines, and teams all plug into it.

## The Engine Adapter contract (keystone)

```ts
interface EngineAdapter {
  id: string;                       // "claude-code", "codex", "copilot", "aider"
  capabilities: Capabilities;       // drives graceful degradation

  // `role` carries instructions (system prompt), engine.model, and autonomy.
  start(task: Task, workspace: Workspace, role: Role): AgentSession;
  health(): Promise<HealthStatus>;  // is the CLI installed and authed?
}

interface AgentSession {
  events: AsyncIterable<AgentEvent>; // the stream the UI renders
  send(input: string): void;         // steer mid-flight / answer a question
  respond(approvalId: string, decision: "allow" | "deny"): void;
  stop(): void;                      // cancel cleanly
}

type AgentEvent =
  | { kind: "output"; text: string }              // streaming log / thoughts
  | { kind: "action"; tool: string; detail: unknown }  // "wants to run `npm test`"
  | { kind: "approval"; id: string; detail: unknown }  // blocked, needs yes/no
  | { kind: "status"; state: AgentState }          // working -> awaiting -> done
  | { kind: "done"; summary: string; diff?: Diff } // finished + what changed (diff optional: blind/ACP adapters derive it later)
  | { kind: "error"; message: string };

interface Capabilities {
  streaming: boolean;        // true: parse JSON events; false: scrape stdout
  structuredEvents: boolean; // Claude/Codex yes, Copilot CLI roughly no
  approvals: boolean;        // can we intercept tool prompts?
  steerable: boolean;        // can we inject input mid-run?
}
```

Each adapter's whole job is **translation**: spawn the CLI with the right headless flags, parse its native output (clean JSON for Claude Code, ANSI scraping for weaker tools), and emit the common `AgentEvent` stream. A weak engine reports fewer capabilities and the UI degrades gracefully: it shows raw output and auto-approves instead of offering inline approval, and never pretends a capability exists.

### Verified engine research (2026-06-14)

Five parallel research agents verified each engine's live headless interface against official docs. Findings:

| Engine | Headless invocation | Structured stream | Approvals (intercept?) | Steerable | Auth | Build slot |
| --- | --- | --- | --- | --- | --- | --- |
| **Claude Code** | `claude -p "..." --output-format stream-json --verbose` (+ official Agent SDK) | Yes: typed NDJSON (`system/init`, `assistant`, `stream_event`, terminal `result`) | **Yes** (`--permission-prompt-tool` MCP, or SDK `canUseTool` callback) | Yes (`--resume`, `--input-format stream-json` mid-run) | Own login or `ANTHROPIC_API_KEY` | **First** |
| **Codex CLI** | `codex exec "..." --json` (+ `@openai/codex-sdk`) | Yes: JSONL (`thread/turn/item` events, terminal `turn.completed`) | No: must pre-authorize (`--sandbox`, `-a never`); unattended requests block/fail | Turn-based resume (`codex exec resume <id>`) | ChatGPT sub (`codex login --device-auth`) or `CODEX_API_KEY` | **Second** |
| **Gemini CLI** | `gemini -p "..." --output-format stream-json` OR `gemini --acp` | Yes via either (stream-json events, or ACP JSON-RPC) | Only via **ACP**; in `-p` mode unauthorized tools are auto-denied | Only via ACP (`-p` is one-shot/stateless) | Cached `~/.gemini` OAuth or `GEMINI_API_KEY` | Via ACP |
| **aider** | `aider --yes-always --message "..." <files>` | No: plain stdout; **completion = process exit, changes = git auto-commit diff** | Blanket auto-accept only (`--yes-always`) | Repeated runs (context via git repo map); unofficial Python `Coder` API | BYO API key only | Later (blind adapter) |
| **Copilot CLI** | `copilot -p "..." -s --no-ask-user` (text) OR `copilot --acp --stdio` (structured) | Only via **ACP** (NDJSON JSON-RPC); `-p` is plain text | Via ACP `requestPermission`, or flags `--allow-all-tools`/`--deny-tool` | ACP multi-prompt sessions; `--continue`/`--resume` | **Copilot subscription** (device OAuth / `gh` token, NO API key) | Last (preview, pin version) |

### Architectural refinement: ACP as a force multiplier

The research surfaced something the original design did not anticipate: **ACP (Agent Client Protocol) is an open JSON-RPC-over-stdio standard** that Gemini and Copilot CLI both implement, and that Zed and JetBrains already consume as clients. This collapses the adapter landscape into **three families** instead of N bespoke parsers:

1. **Native-SDK adapters** (Claude Agent SDK, OpenAI Codex SDK): highest fidelity, typed events, best approval control. Use where the engine's own SDK beats its CLI.
2. **A single generic ACP adapter** (unlocks Gemini + Copilot + any future ACP agent at once): speak ACP yourself, or via `@agentclientprotocol/sdk`. One adapter, many engines.
3. **Blind adapters** (aider): plain text in, git auto-commit out. Completion = process exit; "what changed" = diff the new commit. Degraded but functional, and proves the capability-degradation design is real, not theoretical.

This is leverage: after Claude (native SDK), the **second adapter should be the generic ACP one**, because it validates model-agnosticism *and* lights up two engines (Gemini, Copilot) from a single implementation. The build order below is revised accordingly.

### Approvals reality (changes the autonomy model)

Critical nuance: **interactive approval interception is not universal.** Only Claude Code (native) and ACP-mode engines (Gemini `--acp`, Copilot `--acp`) let an external driver catch a tool request and answer it. Codex `exec` and Gemini `-p` cannot: you must *pre-authorize* a tool allowlist / sandbox mode, and an unexpected request blocks or fails the run. So the `autonomy` field must **degrade per capability**: where `approvals: false`, "manual" mode is unavailable; the adapter maps it to the safest pre-authorized sandbox (e.g. read-only or workspace-write) and the UI shows an "auto (pre-authorized)" badge rather than offering inline approve/deny buttons that cannot work.

### Auth and cost notes

- **Subscription reuse holds for the CLI-driven engines** (Codex, Gemini, Copilot reuse their own CLI logins; aider is BYO-key). **Correction (M2 research, 2026-06-14):** the **Claude Agent SDK** path used by the Claude adapter requires **`ANTHROPIC_API_KEY`** (or cloud-provider creds), NOT a claude.ai subscription. Anthropic's terms prohibit third-party products from reusing claude.ai login for the Agent SDK. So the "reuse what you pay for" thesis holds for Codex/Gemini/Copilot, but the Claude adapter needs an API key.
- **Claude billing change (effective 2026-06-15):** subscription `claude -p` / Agent SDK usage draws from a separate monthly "Agent SDK credit" pool, not interactive limits. Surface this to the user so parallel runs don't silently exhaust it.
- **Gemini first-login needs a browser** (no documented browserless OAuth); CI/fresh boxes need `GEMINI_API_KEY`.
- **Copilot ACP is public preview** and already took one unannounced breaking removal (`--headless --stdio`). Pin the CLI version, disable auto-update, keep the `-p` text path as fallback.

Note: VS Code's own agent mode does not spawn CLIs; it calls models in-process via the `vscode.lm` Language Model API. GitHub's terms restrict using Copilot's models through that API to build a competing standalone agent product, so the CLI route is also the cleaner legal path.

## Roles and Teams

Three concepts, deliberately separated:

**Role (a template).**

```ts
interface Role {
  name: string;             // "Implementer", "Reviewer", "Researcher"
  instructions: string;     // brief / system-prompt for this role
  engine: { id: string; model?: string };           // default engine binding
  autonomy: "manual" | "auto-approve-safe" | "yolo"; // approval policy
  scope?: string[];         // optional dirs/globs this role may touch
}
```

Engine-agnostic in spirit, engine-bound in practice: the binding is one field you can change in a click.

**Team (a roster).**

```ts
interface Team {
  name: string;
  roles: Role[];
}
```

**Agent (a running instance).** Assigning a task instantiates a role into a live agent: role + task + worktree + session. You can spawn several agents from one role (two Implementers on two tasks at once).

Hierarchy: **Team -> Roles -> (spawned) Agents -> each in its own worktree.**

No orchestrator/lead agent in v1 (the human delegates). A "Lead" role is just instructions + engine, so it is a natural later addition, not a rebuild.

## The conducting UX (cockpit)

**1. The Roster (sidebar tree).** Every active agent: role name, engine chip, status dot (idle, working, awaiting-approval, done, error). A "+ Spawn agent" action picks a role and a task. Agents needing you bubble to the top.

**2. The Stage (main webview panel).** A responsive grid of agent cards, each streaming its live `output`. Click a card to expand to full focus: full transcript, the live diff for that agent's worktree, a steering input box (`send()`), and inline approval buttons when the engine emits an `approval` event.

**3. The Review/Merge bar.** On `done`, the card flips to review: summary + diff + **Merge** / **Discard** / **Send back with feedback**. Merge runs the worktree merge; send-back reopens the session with your note via `send()`.

**Degradation in action:** an engine with `approvals: false` shows raw streaming output with an "auto" badge and no inline approve buttons.

**The one hard UX rule:** the conductor should never have to go hunting. Anything that needs a decision (approval, conflict, error, done-and-waiting) raises a visible signal and floats up the roster. You watch passively; you act only when summoned.

## Lifecycle of a task

1. **Spawn.** Pick a role, write a task. Orchestrator creates an `Agent` record: `{ role, task, state: "preparing" }`.
2. **Isolate.** Workspace Manager runs `git worktree add .conductor/wt/<agent-id> -b agent/<slug>` off current HEAD.
3. **Start.** Orchestrator calls `adapter.start(task, workspace)`. Adapter spawns the CLI headless in that worktree, with the role's `instructions` as system prompt and `autonomy` mapped to the engine's approval flags.
4. **Stream.** Adapter parses native output into common `AgentEvent`s. State machine: `preparing -> working -> (awaiting-approval <-> working)* -> done | error`.
5. **Steer (optional).** On an `approval` event the agent parks; your decision flows back via `respond()`. You can `send()` guidance any time.
6. **Done.** Adapter emits `done` with summary + diff. Card flips to review.
7. **Resolve.** Merge (merge `agent/<slug>` into your branch or open a PR, then remove the worktree), Discard (drop branch + worktree), or Send back (reopen with feedback).

The UI is a pure function of agent state: no hidden side-channels, which keeps it replayable, debuggable, and testable.

## Isolation and concurrency

**Isolation = git worktrees, one per agent.** Each agent branches off HEAD into `.conductor/wt/<id>` on `agent/<slug>`. While running, agents are fully isolated; this is the single mechanism that makes "5 agents at once" safe.

**Conflicts surface at merge, not during work.** Since all agents branch off the same HEAD, two agents editing the same file only collide when the second one merges.

- **Serialize merges.** The orchestrator merges one agent at a time. Each later merge rebases onto prior merged work; git auto-merges or flags a real conflict.
- **On conflict:** the card flips to a first-class **Conflict** state. Three choices: resolve in the diff editor yourself, send the conflict back to the agent (`send()` the markers and ask it to resolve in its own worktree), or discard.

**Merge strategy (per team, sane default):** default is open a PR / draft branch, never auto-merge to your working branch. Optional: auto-merge when clean, prompt only on conflict.

**Concurrency limits.** A `maxParallelAgents` setting (default 3 to 4) throttles spawns to protect against rate limits, token burn, and CPU. Extra tasks queue as `preparing`.

**Stale-base drift.** If you commit while agents run, their base is behind. The orchestrator flags "base moved" and offers a one-click rebase of the agent branch before merge.

## Error handling and failure modes

Every failure becomes a visible state with an action attached, never a spinner that lies or a silent death.

- **Engine not installed / not authed.** `health()` check on adapter load. Failure marks the engine unavailable in role binding with a one-line fix ("Run `claude login`"). Cannot spawn on a dead engine.
- **Process crashes mid-task.** Adapter watches the child; non-zero exit emits `error`, agent goes red with the stderr tail and a Retry (same worktree, preserves partial work) or Discard.
- **Hung / runaway agent.** Idle timeout (no events for N minutes -> "stalled") and a hard wall-clock cap. Both surface as state, not a kill; you decide.
- **Rate limits / quota.** Detected from the engine's signal, shown as "rate-limited, retry in Xs" with auto-retry and backoff, distinct from a real failure.
- **Unparseable interactive prompt.** Fallback: expose raw stdout/stdin in the card as a terminal so you can answer by hand. Ugly, never a dead end.
- **Extension reload.** State is persisted and worktrees live on disk; on reload the orchestrator reattaches to running processes where possible, or marks them "detached, worktree preserved."

## State and persistence

**Definitions: versioned, in the repo.**

```
.conductor/
  teams/feature-squad.yaml      # roster + role bindings
  roles/reviewer.yaml           # instructions, engine, autonomy, scope
  config.yaml                   # maxParallelAgents, merge strategy, defaults
```

Diffable, shareable, PR-reviewable. A teammate clones the repo and gets the whole agent setup. This is a real edge over Conductor's app-local config.

**Runtime: ephemeral but recoverable.** Live sessions (state, event log, worktree path, child PID) persist to VS Code `workspaceState` and a gitignored `.conductor/.runtime/`. On activation the orchestrator rehydrates agent records and reattaches to live processes, marking dead ones "detached, worktree preserved" so on-disk work is never orphaned.

**Event log per agent (JSONL).** Gives scrollback after reload, a replayable transcript for debugging, and reconstruction of exact card state by replay (the UI is a pure function of events).

**Secrets.** API keys (when an engine needs one) live in VS Code `SecretStorage`, never in versioned files. CLI-auth engines need nothing here.

One line: structure is code (committed); runtime is disposable (gitignored, recoverable).

## Testing strategy

Roughly 90% of the product is testable with no API keys and no network.

1. **Orchestrator Core: unit tests (the bulk).** Pure TypeScript talking only to the adapter interface; test the whole state machine against a `FakeEngineAdapter` that emits scripted events. Assert transitions, concurrency queueing, error handling. Zero CLIs, zero cost.
2. **Engine Adapters: fixture-driven parser tests.** Capture real CLI output once into fixtures, then unit-test each parser offline. Format changes are caught by a fixture update.
3. **Adapter conformance suite (contract guard).** One shared suite every adapter must pass: emits at least one `status`, terminates with `done` or `error`, honors `stop()`, reports capabilities truthfully. This keeps "add an engine = one adapter" true.
4. **Workspace Manager: git integration tests.** Real throwaway repo in a temp dir: create worktree, divergent commits, assert clean merge vs detected conflict, assert cleanup.
5. **UI: event-replay snapshots.** Feed recorded JSONL, snapshot the rendered roster and cards. A little Playwright for critical click-paths (approve, merge).

## MVP scope

The thinnest thing that proves the two headline claims (parallel agents, model-agnostic) end to end:

- **Claude Code adapter first**, done excellently (cleanest headless + stream-json story).
- **A second adapter** (Codex or aider). Non-negotiable: model-agnosticism is only real once two engines pass the same conformance suite.
- **Worktree isolation + serialized merge**, defaulting to PR/branch.
- **The cockpit:** roster sidebar + Stage with streaming cards + inline approval + review/merge.
- **Roles/teams as `.conductor/` YAML**, plus `FakeEngineAdapter` and the conformance suite from day one.

### YAGNI: explicitly cut from v1 (each additive later, not a rebuild)

- Lead/orchestrator agent (the human delegates).
- Copilot adapter at launch (weakest headless story; add later as the proof that even Copilot plugs in).
- Auto-merge-when-clean (PR-only default).
- Agents talking to each other.
- Cost dashboards, remote/cloud execution, multi-repo routing, any marketplace. Sharing = a file in your repo.

## Build order (de-risk scary parts first)

1. **Adapter contract + `FakeEngineAdapter` + orchestrator state machine.** No UI, no real CLI. Prove the brain.
2. **Claude Code adapter** (fixtures, then live). Prove a real CLI streams cleanly.
3. **Workspace Manager** (worktree + merge + conflict). Prove isolation.
4. **Minimal UI**, one agent, full loop: spawn -> watch -> approve -> merge.
5. **Parallelism + second adapter (the generic ACP adapter).** Prove both headline claims. ACP is the higher-leverage second adapter than Codex: it lights up Gemini and Copilot from one implementation and validates model-agnosticism against a different protocol shape than Claude's SDK.

Step 1 alone confirms or kills the riskiest assumption before a line of UI is written.

(Research note: the original plan named "Codex or aider" as the second adapter. Verified findings now favor the generic ACP adapter for slot 5, with Codex's native SDK adapter and aider's blind adapter as fast-follows.)

## Implementation status

- **Milestone 1 (Build order step 1) — DONE (2026-06-14, branch `milestone-1-core`).** `@maestro/core` package: the adapter contract, `FakeEngineAdapter`/`FakeWorkspaceProvider` test doubles, and the full `Orchestrator` state machine. Pure TypeScript, zero runtime deps, 35 tests green, typecheck clean. Built via subagent-driven TDD with spec + code-quality review per task. Two contract refinements emerged from review and were folded in while the contract was still private: (1) `EngineAdapter.start()` now receives `role` so a real adapter can reach instructions/model/autonomy; (2) `done.diff` is optional (blind/ACP adapters derive the diff after the fact). Plan: `2026-06-14-maestro-core-orchestrator.md`.
- **Deferred to later milestones (tracked):** pre-spawn `health()` gating (M2), `WorkspaceProvider.cleanup()` wiring on terminal transitions (M3), stop-while-queued handling, `Emitter` listener-exception isolation, and the autonomy-per-capability degradation in adapters/UI.
- **Direction update (2026-06-14): GitHub Copilot only.** Product focus narrowed to a single engine — the **Copilot CLI** (`copilot -p`) — because it is the cleanest subscription reuse (authenticates with the user's Copilot subscription via a GitHub token, no API key), it's the engine the founder cared about from the start, and `--model` still selects Claude/GPT/Gemini *through* Copilot (multi-model on one subscription). The engine-agnostic core (M1) is unchanged; Copilot is simply the first and, for now, only adapter. The Claude Agent SDK path was dropped after research showed it requires `ANTHROPIC_API_KEY` and forbids subscription reuse. v1 uses **plain-text streaming + worktree isolation + review-the-diff** (no interactive per-tool approval); structured `--output-format json` and `--acp` mode are later upgrades.
- **Milestone 2 (Copilot CLI adapter) — DONE (2026-06-14, merged to `main`).** `@maestro/adapter-copilot`: spawns `copilot -p` per worktree, streams output, exit → done/error, `stop()` kills. No external SDK; reuses the Copilot subscription via a GitHub token. 20 tests, validated end-to-end through the real `Orchestrator`. Capabilities honestly degraded (`approvals/structuredEvents/steerable: false`). Plan: `2026-06-14-maestro-copilot-adapter.md`. (Also fixed a latent M1 build bug: core now emits `dist/index.js` via a src-only build tsconfig.)
- **Milestone 3 (Workspace Manager) — DONE (2026-06-14, branch `m3-workspace-manager`).** Real git-worktree isolation plus the "review the diff, merge or discard" surface. Two phases, both built via subagent-driven TDD (implementer + spec + code-quality review per substantive task, plus a final holistic cross-cutting review). (A) `@maestro/core` gained a feature-detected `WorkspaceManager` capability (`diff`/`merge`/`discard`), diff-on-done (doubly guarded), `orch.merge()`/`orch.discard()`, and a non-terminal `conflict` state — all additive: the M1/M2 tests stayed green and core grew 35 → 47 tests. (B) the new `@maestro/workspace` package: `GitWorkspaceManager` drives real `git worktree`/diff/merge via an injected `GitRunner`, unit-tested with a fake runner and integration-tested against real throwaway repos, with an e2e that runs an agent in a real worktree through the actual `Orchestrator` and merges its work (17 tests). Review hardened the merge path to distinguish a real content conflict (unmerged `--diff-filter=U` files → abort + report) from a non-conflict failure (→ throw the real error, no phantom conflict). `cleanup()` wires to *resolution* (merge/discard) only, never terminal, so the worktree survives as the review surface — which also closes M1's deferred "cleanup never wired" flag. **Full M3 gate: 47 core + 20 adapter + 17 workspace = 84 tests green, tsc clean, all three packages build.** Plan: `2026-06-14-maestro-workspace-manager.md`. Deferred (tracked): rebase/stale-base, send-conflict-back, merge mutex, PR-mode, branch-retention policy, and the half-applied-state risk if `cleanup` rejects after a clean merge.
- **Next:** Milestone 4 — the VS Code cockpit (roster, live panes, diff review wired to `orch.merge`/`orch.discard`, Merge/Discard/Conflict actions rendering `OrchestratorEvent`s). The superseded Claude-adapter plan (`2026-06-14-maestro-claude-adapter.md`) is retained for its Agent-SDK research and auth finding.

## Open questions and risks

- **Copilot CLI headless maturity.** Verify its non-interactive and structured-output capabilities live before committing to that adapter's UX. Treat as aspirational until proven.
- **Engine output format drift.** Agentic CLIs change output formats between versions; the conformance suite + fixtures are the mitigation, but expect maintenance.
- **Token and rate-limit economics.** Parallel agents burn quota fast; `maxParallelAgents` and per-agent caps are the guardrails, but real usage may need smarter budgeting.
- **Worktree merge edge cases.** Submodules, LFS, untracked build artifacts, and dirty working trees can complicate worktree create/merge. Integration tests must cover messy repos.
- **Name.** "Maestro" is a placeholder. Alternatives: Ensemble, Rostrum, Tutti, Podium, Crew.

## Glossary

- **Engine:** an AI coding CLI (Claude Code, Codex, etc.) driven as a subprocess.
- **Adapter:** the module translating one engine's native I/O into the common contract.
- **Role:** a reusable worker template (instructions + engine binding + autonomy).
- **Team:** a named roster of roles.
- **Agent:** a running instance of a role on a task, in its own worktree.
- **Worktree:** an isolated git checkout giving an agent a private filesystem.
