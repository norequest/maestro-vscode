# Vendored delegation skills + native on-demand delivery

Date: 2026-06-25
Branch: feat/conducting-board
Status: accepted, building

## Why

The founder pointed Maestro at three real skills from wshobson/agents
(task-coordination-strategies, team-communication-protocols, team-composition-patterns)
and expected (1) the actual skills vendored into the repo as visible files, and
(2) the agent to LOAD/INVOKE the skill through the engine's own mechanism, not
have Maestro paste the skill body into the `-p` prompt string.

Today Maestro inlines skill bodies into the preamble (`composePreamble` ->
`# Skills (standing procedures)` block). That is the "instruction as prompt"
the founder flagged.

## Founder decisions (interview, 2026-06-25)

- **Fidelity: Hybrid.** Keep verbatim upstream copies in the repo as human-only
  reference; inject a separate Maestro-adapted version into agents.
- **Delivery: Native on-demand `SKILL.md`.** Both Copilot CLI and Gemini CLI now
  auto-discover `SKILL.md` folders and load them on demand. Write skills to a
  natively-discovered location; stop inlining the body.
- **Coverage: All three, fuller.** Vendor all three as full adapted skills,
  including team-communication-protocols rewritten to Maestro's reality.

## Honest constraints driving the adaptation

The upstream skills are written for Claude Code's Agent Teams and name primitives
Maestro does not have: `SendMessage`/`broadcast`/`shutdown_request` peer
messaging, `~/.claude/teams/<name>/config.json` discovery, `tmux`/`iterm2`
display modes, `TaskCreate`/`TaskUpdate addBlockedBy` task graph, and
`subagent_type` selection. Maestro agents are isolated git-worktree subprocesses
with no peer bus; all coordination flows through the conductor and the human. So
the adapted skills keep the durable practice and rewrite the tool-specific parts.

## Delivery research (verified)

- Cross-engine native skill location: `.agents/skills/<name>/SKILL.md` (Copilot
  also reads `.github/skills` and `.claude/skills`; Gemini reads `.gemini/skills`
  and `.agents/skills`). `.agents/skills` is the portable choice.
- Discovery keys off the working directory. Copilot runs `-C <worktree>`; the ACP
  adapter sends `cwd = <worktree>`. Gemini's upward scan stops at the worktree's
  own `.git`, so skills MUST live inside the worktree, not only at the main repo
  root.
- `.github` alone would be Copilot-only, so it is rejected for runtime delivery.

## Architecture

### Verbatim reference (Hybrid, human-only)
- `docs/vendor/wshobson-agents/skills/<name>/...` holds the three upstream skills
  verbatim (all 8 files) plus a `README.md` with source URL, commit, and MIT
  attribution. NOT under `.conductor/skills` and NOT in any auto-loaded path, so
  the engine never loads the (Maestro-incompatible) originals.

### Adapted skills (agent-facing, all three)
- Three Maestro-adapted skills, authored as real `SKILL.md` content, scaffolded
  into the user's `.conductor/skills/<name>/SKILL.md` (real, editable files).
  Names match upstream for traceability:
  - `task-coordination-strategies` (decomposition by layer/component/concern/file
    ownership; dependency thinking reframed: no `blockedBy` primitive, so order
    delegations and do prerequisites yourself, pin shared interfaces in both
    tasks; the task-description template; how this maps to a ```delegate``` block).
  - `team-composition-patterns` (sizing heuristics, smallest-team-first, preset
    compositions reframed as "which specialists to load from the team roster",
    full-context-in-initial-prompt; drop subagent_type/tmux/~/.claude config).
  - `team-communication-protocols` (rewritten: agents are isolated and cannot
    message peers; all coordination is through the conductor and the human; put
    complete context in every delegate block because teammates start fresh; no
    hand-offs; surface blockers to the human; the conductor integrates).
- Each adapted skill carries a one-line provenance note: "Adapted for Maestro
  from wshobson/agents (MIT). Original in docs/vendor/wshobson-agents." No em
  dashes anywhere.

### Native delivery (stop inlining; materialize + pointer)
- core `Task`: replace `skillBodies?: string[]` with `skills?: SkillRef[]`, where
  `SkillRef = { name: string; description?: string; content: string }`. `content`
  is the full original `SKILL.md` text (frontmatter + body) for materialization.
- `composePreamble`: the `# Skills` section no longer inlines bodies. It renders a
  lightweight pointer only: `# Skills (available, load when relevant)` followed by
  `- <name>: <description>` lines. The body is delivered as a discoverable file,
  not pasted into the prompt.
- `loadSkills`: also return the raw `SKILL.md` text per skill (`raw` map) so the
  extension resolver can build `SkillRef.content`.
- `@maestro/workspace` `GitWorkspaceManager`: new `writeSkills(agentId, skills)`
  writes each `content` to `<worktree>/.agents/skills/<name>/SKILL.md`, and the
  diff/review path excludes `.agents/` (a `:(exclude).agents/` pathspec) so
  materialized skills never appear in the review diff or get merged.
- Orchestrator: after `workspace.create` and before adapter start, if the manager
  exposes `writeSkills` (feature-detected) and the task has `skills`, materialize
  them. Same for delegated-teammate spawns.
- Adapters: `buildArgs` / `buildAgentProfile` (copilot) and `session.start` (acp)
  pass `task.skills` to `composePreamble` (pointer only) and stop inlining bodies.
  The Copilot native agent profile drops skills from its persona body too.

### Config defaults
- `defaults.leadSkills` becomes the three vendored skill names
  `[task-coordination-strategies, team-composition-patterns, team-communication-protocols]`
  (the lead/conductor holds the roster, so delegation know-how is lead-only,
  consistent with the existing general/lead split). Remove the hand-written
  `delegation-playbook` skill and `packages/config/src/delegation-playbook.ts`;
  the three vendored skills supersede it. Scaffolder writes the three.

## Build order
1. core (keystone: `SkillRef`, `Task.skills`, compose pointer, `loadSkills` raw).
2. parallel after core builds: config (3 adapted skills + scaffolder + defaults),
   workspace (writeSkills + diff exclude), adapter-copilot, adapter-acp.
3. extension (resolver builds `SkillRef[]`, materialization wiring, defaults,
   remove delegation-playbook references).
4. docs/vendor verbatim files (independent, can run anytime).
5. full `pnpm verify`.

## Out of scope (v1)
- Per-skill `allowed-tools` frontmatter enforcement.
- User-authored skills auto-materialized for ad-hoc (non-team) single dispatch
  (only resolved role skills are materialized).
- Removing the lightweight pointer entirely to rely purely on engine
  auto-listing (kept for activation reliability and the legacy inline path).
