# Vendored: wshobson/agents agent-teams skills

This directory contains verbatim, unmodified copies of three skills from the
[wshobson/agents](https://github.com/wshobson/agents/tree/main/plugins/agent-teams/skills)
repository. They are vendored here for reference only, so the Maestro design and
adaptation work can cite the original source material without depending on an
external checkout.

The copied skills are:

- `skills/task-coordination-strategies/` (SKILL.md plus references for dependency graphs and task decomposition)
- `skills/team-communication-protocols/` (SKILL.md plus a messaging-patterns reference)
- `skills/team-composition-patterns/` (SKILL.md plus references for agent-type selection and preset teams)

The files under `skills/` are byte-identical to upstream. They were copied as-is,
including any formatting and punctuation choices in the originals. Do not reflow,
reformat, or otherwise edit them: if upstream changes, re-vendor from source
rather than hand-editing these copies.

## Not loaded by Maestro at runtime

These vendored files are documentation only. Maestro does NOT load them at
runtime. Maestro ships its own separate, Maestro-adapted versions of these skills
under `.conductor/skills/`. The adaptation is necessary because the upstream
skills are written against Claude Code's Agent Teams primitives that Maestro does
not have, including:

- `SendMessage` and `broadcast` style inter-agent messaging
- the `~/.claude/teams` team layout
- tmux display modes
- `TaskCreate` and `blockedBy` task dependencies
- `subagent_type` agent selection

Maestro's own engine model (worktree-isolated CLI workers over its adapter
contract) differs from these primitives, so the `.conductor/skills/` versions are
the ones that actually run. Treat anything in this directory strictly as upstream
reference, not as live configuration.

## Source and provenance

- Source repository: https://github.com/wshobson/agents
- Source path: `plugins/agent-teams/skills/`
- Source branch: `main`
- Source commit: `2b48f1690c5f60070b56d97ed6d93bded989dc73`
- Vendored on: 2026-06-25

## License

The upstream repository is MIT licensed. A verbatim copy of the upstream
top-level license is included here as [./LICENSE](./LICENSE).
