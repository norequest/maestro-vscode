# Maestro Conducting Board: Implementation Roadmap

*The phased plan to build the Conducting Board design into the real `@maestro/extension`, faithfully and incrementally.*

This roadmap turns the [Conducting Board design reference](../2026-06-16-conducting-board-design/README.md) (the spec, prototyped in Claude Design) into shipped extension behavior. It follows the project's proven milestone pattern: a roadmap plus one TDD implementation plan per phase, each in the same house style as the `2026-06-14-maestro-*.md` milestone docs (Goal, Architecture, Scope IN/OUT, File Structure, red→green→commit tasks, Self-Review), executed with `superpowers:subagent-driven-development`.

## Status

- **P1 · Conducting Board · SHIPPED** (branch `feat/conducting-board`). The laned board (Working / Needs you / Conflict / Done) is real over today's data model: `Task.goal` threads through `Orchestrator.spawn` (R7); the cockpit owns the canonical `laneFor(state)` table (R1) and an enriched `CardVM` (goal, taskDescription, diffStat, startedAt, lane, anatomy placeholders); the extension renders rich read-mostly cards plus a right-hand drawer (Instructions / Output / Diff with a capability-gated Approve / Deny · Steer · Send-back bar) over the design's fixed dark-graphite tokens (R2). The spawn command captures an optional goal. Gate green (513 tests across 8 packages; both bundles emit; headless activation smoke passes). Seams R1 / R2 / R7 are now established for later phases.
- **P2 · Dispatch and Teams · SHIPPED** (branch `feat/conducting-board`). The bare spawn InputBox is replaced by a real Dispatch composer rendered inside the board webview (graphite, R2): pick a `.conductor/roles` preset (or type an ad-hoc role), pick an engine family + model variant, write a Goal (R7) and a Task, and Dispatch a card into Working. Pure work lands in the cockpit (`composer.ts` selector + `dispatch` `WebviewToHost` variant) and core (`spawn` gains a `SpawnOptions` bag and a `dispatch(spec)` that registers ad-hoc roles, all back-compatible; the P1 positional-goal seam reconciled). The extension adds the `composer-data` loader, the `render-composer` panel, the `maestro.newAgent` command (now the Roster `+`), a host-side engine-allowlist guard refusing unknown engines (R6), and keeps the InputBox as "Spawn Agent (quick)". Launch Team reuses the existing `maestro.launchTeam`. Gate green (544 tests; both bundles emit; activation registers `maestro.newAgent`).
- **P3-P6 · pending.**

## Sequencing principle

Get the **Conducting Board visible and real first** (the surface whose absence prompted this redesign), then deepen. **Every phase ships real capability, not a facade.** Each phase maps to one or more design docs and is grounded in the current code: the pure `@maestro/cockpit` presenter, the thin `@maestro/extension` shell, and the M1 to M9 core (orchestrator, workspace, config, adapters).

## The phases

| Phase | Title | Design docs | Headline deliverable | Depends on |
| --- | --- | --- | --- | --- |
| [P1](./P1-conducting-board.md) | Conducting Board | [01](../2026-06-16-conducting-board-design/01-overview-and-visual-language.md), [02](../2026-06-16-conducting-board-design/02-conducting-board-and-lifecycle.md) | Laned board + rich cards + right-hand drawer (Instructions / Output / Diff, approve / steer / send-back, answer-to-unblock), over today's data model. The visible hero. | core, cockpit, extension (M4) |
| [P2](./P2-dispatch-and-teams.md) | Dispatch and Teams | [02](../2026-06-16-conducting-board-design/02-conducting-board-and-lifecycle.md) | The dispatch composer (role presets from `.conductor/roles`, engine pills, goal, task) and the Launch-team picker, replacing the bare spawn InputBox. | P1, M8 config, `Orchestrator.launchTeam` |
| [P3](./P3-reusable-skills.md) | Reusable Skills | [04](../2026-06-16-conducting-board-design/04-reusable-skills.md), [03](../2026-06-16-conducting-board-design/03-agents-teams-and-anatomy.md) | `Role.skills?: string[]`, the `.conductor/skills/<name>/SKILL.md` store, the used-by reverse index, and the Library shell with the Skills tab (grid, editor, attach). | P1, M8 config |
| [P4](./P4-agent-anatomy-soul-tools.md) | Agent Anatomy: Soul and Tools | [03](../2026-06-16-conducting-board-design/03-agents-teams-and-anatomy.md), [04](../2026-06-16-conducting-board-design/04-reusable-skills.md) | `Role.soul?` and the tools-grant model (read/write split, write off by default), the full anatomy editor, the Add-skill grant-gate, and composition-at-spawn (Soul, Instructions, Tools, Skills, Task) in both adapters. | P3 |
| [P5](./P5-discover-and-adopt.md) | Discover and Adopt | [05](../2026-06-16-conducting-board-design/05-discover-and-adopt.md) | Read-only scanners for repo sources and Copilot plugins, the Discover tab with confidence tiers, and the adopt flow (map foreign to Role, provenance, autonomy clamp, never silent write). | P3, P4 |
| [P6](./P6-diff-merge-review.md) | Diff and Merge Review | [06](../2026-06-16-conducting-board-design/06-diff-merge-review.md) | The full-width review screen (changed files, unified diff, what-changed, decision bar), the conflict variant, PR mode, and cleanup recovery, over the real M9 merge engine. | P1 |

Dependency shape: P1 is the spine. P2 and P6 hang directly off P1. P3 then P4 are the data-and-editor deepening. P5 sits on top of P3 (skills) and P4 (the anatomy editor it pre-fills).

## Reconciliation addendum (canonical seams)

These are the cross-phase decisions. Every phase doc must honor them so the parallel plans compose. Where a phase is tempted to redefine one of these, it defers to this list.

- **R1 · Lane mapping is defined once, in P1.** `selectState` groups cards into lanes by `AgentState`. The canonical table (Working: preparing, queued, working · Needs you: awaiting-approval, blocked, done, error, detached, merge-cleanup-failed · Conflict: conflict, shown red within or beside Needs you · Done/terminal: merged, discarded, pr-created) lives in P1 and is referenced, never re-invented, by later phases.
- **R2 · The board is its own dark canvas, not VS Code theme variables.** To match the prototype, the board and all Conducting Board webviews use the design's fixed graphite palette and tokens (see design doc 01), not `var(--vscode-*)`. This is a deliberate divergence from the M4 stage, which used theme vars. All webview phases follow it.
- **R3 · Composition-at-spawn has a single owner: P4.** P3 may inline resolved skill bodies with a minimal append so skills are functional end to end, but P4 generalizes it into the one ordered preamble (Soul, Instructions, Tools, Skills, Task) assembled in the Copilot adapter `buildArgs` and the ACP adapter `session/new`. After P4 that assembler is the single source of truth; P3's minimal append is replaced, not duplicated.
- **R4 · One Library webview, extended per phase.** P3 introduces the Library shell with the tab bar (Agents | Teams | Skills | Discover) and fully implements the Skills tab plus a minimal read-only Agents and Teams listing (the data exists from M8). P4 adds the rich anatomy editor behind an agent card. P5 adds the Discover tab. Tabs not yet implemented render a clear "coming in a later phase" placeholder rather than being absent.
- **R5 · The Add-skill grant-gate lands in P4, because it needs the tools model.** In P3 the Add-skill picker attaches a skill but cannot diff against tool grants yet, so it shows only the skill's declared requirements. The amber "needs Git(write), this agent does not have it yet" gate with Grant / Attach-without-granting / Cancel arrives in P4 once `Role.tools` exists.
- **R6 · All role, skill, and soul edits persist through the M8 config serializer.** Writes go to `.conductor/` (roles/*.yaml, skills/<name>/SKILL.md, souls/*.md) via the existing config package. The audit-hardened invariants are preserved: `.conductor` symlink containment, unknown-engine refusal (engine ids stay hard-allowlisted via KNOWN_ENGINE_IDS), and serialized persist.
- **R7 · The goal ("why") field is added in P1.** P1 introduces an optional goal on the spawn path (carried onto the agent/card) so the board can show the faint italic why line. P2's composer sets it; P5's adopt sets provenance separately. Later phases consume it; they do not redefine it.
- **R8 · Conflict resolution UI degrades to the existing M9 editor flow.** P6 builds the rich read-only review and the conflict display, but the actual conflict edit initially delegates to the existing M9 `resolve-conflict` (open in editor) path already in the protocol. In-webview hunk-level keep-ours/keep-theirs is a stretch goal, not a P6 blocker.

## Current baseline (what these phases build on)

- `@maestro/core`: `Role` is `{name, instructions, engine: {id, model?}, autonomy: "manual" | "auto-approve-safe" | "yolo"}`; `Team` is `{name, roles}`. The `Orchestrator` already exposes `spawn`, `launchTeam`, `registerRole`, `registerAdapter`, `sendBack`, `markPrCreated`, `hydrate`, and the full `AgentState` union. See [design doc 07](../2026-06-16-conducting-board-design/07-data-model-and-build-plan.md) for the additive deltas.
- `@maestro/cockpit`: a pure presenter (`reduce`, `selectState`, `CardVM`, `CockpitState`, `WebviewToHost` with a runtime guard `isWebviewMessage`). `selectState` today returns a flat, attention-first card list; P1 lanes it.
- `@maestro/extension`: the thin shell (`createCockpit` controller, native Roster TreeView, Stage webview via esbuild, `activate()` wiring the real Orchestrator + GitWorkspaceManager + Copilot/ACP adapters + persistence + M8 config).

## Per-phase definition of done

Each phase plan ends green on the repo-root gate: `pnpm -r typecheck`, `pnpm -r test` (new tests added per task, red before green), `pnpm -r build` (both extension bundles emit). The phase doc closes with a Self-Review that maps each design-doc requirement to the task that delivers it and lists what is deferred and to which later phase.
