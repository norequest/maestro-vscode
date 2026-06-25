# Default Lead Delegation: design

Date: 2026-06-25
Branch: feat/conducting-board
Status: accepted, building

## Problem

Today you must pre-assemble a team and pick a lead before any delegation can
happen. A single dispatched agent has no team, so any `delegate` block it emits
is silently ignored (only a lead with a team delegates). And even a real lead's
brief teaches the delegation format but not how to delegate *well*.

We want two things, built together:

1. A "default lead" entry point: type a prompt with no team picked, and Maestro
   runs a generic lead over a synthetic "everyone" team (all `.conductor/roles`
   available), delegating by smart triage.
2. A delegation playbook injected into that lead (and every lead) so it splits
   work in a way that actually composes under Maestro's constraints.

## Decisions (from the founder)

- Injection: **hybrid**. Hard invariants baked into the lead brief (always on,
  zero config); the richer reference shipped as an optional
  `.conductor/skills/delegation-playbook/SKILL.md` the default role pulls in.
- Approvals: **auto-approve known roles**, scoped to the default-lead path only.
  Delegations to vetted teammates spawn without a click, capped at
  `maxParallelAgents` (the rest queue). Hand-built teams keep their manual gate.
- Sequencing: **both together**.

## Honest constraint (why we adapt, not copy, the wshobson skills)

Maestro teammates are isolated CLI subprocesses in separate git worktrees with
no shared bus. They cannot message each other or the lead. All coordination
flows through the lead and the human conductor. So `team-communication-protocols`
(peer `message`/`broadcast`/`shutdown_request`/deadlock-breaking) mostly does NOT
map and is excluded. We keep the durable parts of `task-coordination-strategies`
(file-ownership decomposition, self-contained tasks, wide-shallow) and
`team-composition-patterns` (smallest-team-first, full-context-in-initial-prompt).

## Architecture (by package)

### core (`@maestro/core`)
- `delegation.ts` `buildLeadBrief`: append an always-on hard-invariants playbook
  after the existing roster + fence teaching. Invariants: do small work yourself
  (smart triage); split by file ownership first (worktree isolation -> same-file
  edits conflict at merge); keep splits wide and shallow (one-shot, no waiting,
  no hand-back); write each `task:` to stand alone (a teammate sees only those
  words); pin shared interfaces inside both tasks when subtasks depend; honor an
  explicit "use the X agent" the conductor wrote; one teammate per block; only
  listed role names; the conductor approves each block.
- `orchestrator.ts`:
  - `launchTeam(team, description, opts?: { autoApprove?: boolean })`. Store
    `autoApprove` on the `LeadContext`.
  - In `scanDelegations`, when a valid teammate delegation is found and the lead
    context has `autoApprove`, immediately approve it by reusing the existing
    `approveDelegation` spawn path (which already respects `maxParallelAgents` /
    the queue) instead of leaving it pending. Emit proposed + resolved(approved)
    so the audit log is intact. Without `autoApprove`, behavior is unchanged
    (proposal stays pending until the human approves).
  - Ad-hoc / unknown roles are never auto-approved (already filtered as
    non-teammates). In the everyone team all teammates are vetted, so they all
    auto-approve.

### config (`@maestro/config`)
- A `delegation-playbook` skill constant (the richer reference: the four
  decomposition taxonomies with examples, the task-description template, the
  sizing heuristic reframed as "how many specialists to pull in"). Maestro-
  faithful, no peer-messaging vocabulary, no em dashes, with a short MIT
  attribution line (adapted from wshobson/agents).
- The scaffolder writes `.conductor/skills/delegation-playbook/SKILL.md` on
  first-run scaffold, behind the injectable fs, idempotent (never overwrite).

### extension (`maestro`)
- `DEFAULT_ROLE` gains `skills: ["delegation-playbook"]` so the default lead
  pulls the richer reference into its `# Skills` block.
- First-run scaffold also writes the delegation-playbook skill.
- New webview->host message `{ type: "launch-default"; task: string }`.
- "+ New task" flow offers "Default agent (delegates as needed)" alongside the
  user's teams. Picking it opens the task overlay; submit posts `launch-default`.
- Host `launch-default` handler: `buildDefaultTeam(roles, DEFAULT_ROLE)` ->
  `{ name: "Default", lead: DEFAULT_ROLE.name, roles: [DEFAULT_ROLE, ...loaded
  roles] }` (deduped), register roles, `orch.launchTeam(team, task,
  { autoApprove: true })`. `buildDefaultTeam` is a small pure, tested helper.

### cockpit (`@maestro/cockpit`)
- No change expected. Auto-approve emits proposed + resolved(approved) + the
  teammate's `agent-added` (with `parentId`), all already handled by the reducer.
  The teammate card just appears under its parent; any pending flicker is
  acceptable and usually batched away.

## Build order
(core || config) -> extension -> full `pnpm verify`. Cockpit untouched.

## Defaults chosen (open to revision)
- Roster = all `.conductor/roles` (no cap); smart-triage brief guards over-fan.
- Auto-approve scoped to the default-lead launch only (a flag), not a global
  policy; existing teams keep manual approval.
- Explicit "use the X agent" honored prompt-side via the brief, not a pre-parse.

## Out of scope (v1)
- Peer-to-peer teammate messaging (Maestro has none).
- A lead-managed task graph / blockedBy edges (no such primitive).
- Roster ranking/capping, deterministic explicit-naming pre-parse.

## MODEL CORRECTION (2026-06-25, same day, after founder review)

The first build above made a team launch promote one of the team's roles to lead.
The founder corrected the model: the lead is ALWAYS a single default-agent /
conductor persona, for BOTH a no-team run and a team run. A team is just a
SCOPED ROSTER limiting which specialists the conductor may load as sub-agents.
A team never promotes one of its own roles to lead. The conductor does the glue
work itself and delegates the specialized parts (smart triage, "orchestrate +
do glue work", not a pure router).

Reworked accordingly:
- New `CONDUCTOR_ROLE` ("Conductor") is the lead persona and now carries
  `skills: ["delegation-playbook"]`. `DEFAULT_ROLE` ("Implementer") is back to
  being only the bare single-dispatch fallback (skill removed).
- `buildConductorTeam(name, roster, conductor)` = `{ name, lead: conductor.name,
  roles: [conductor, ...roster] }` (deduped). `launchConductorTeam(...)` registers
  members and calls `orch.launchTeam(team, task, { autoApprove: true })`.
- `launchTeamByName` routes through `launchConductorTeam`, IGNORING the team's
  own `lead` field. The Library "Teams -> Launch" button and the command-palette
  "Launch Team" both funnel through it. The no-team default path is the conductor
  over all loaded roles.
- Auto-approve now applies to ALL conductor launches (team and no-team), because
  the roster is always vetted `.conductor` roles. The earlier "scoped to the
  default-lead path only" line is superseded.
- `buildLeadBrief` reframed to speak the conductor / sub-agent model: opens
  "You are the default agent. You received one task. You can load these
  specialists as sub-agents to help, or just do the task yourself." with the
  roster labelled "Specialists you can load as sub-agents:". No core signature
  change was needed (`launchTeam` already resolves `lead = team.lead || first`).
- `team.lead` is now ignored (deprecated), not removed this pass.

Gate after the rework: `pnpm verify` green, 1455 tests across 8 packages
(core 220, extension 696).

## FURTHER REFINEMENT (2026-06-25, same session)

Two more founder corrections to the entry flow:

1. The "+ New task" agent/team picker was a native `vscode.window.showQuickPick`
   popup. Moved in-page: a new HostToApp `open-task-composer { teams }` message,
   the webview renders selectable chips + the task field inside the one page, no
   OS dropdown. Removed `open-team-task` / `open-default-task`.
2. The standalone "Default agent (all specialists)" option was removed. Running
   the conductor over every role ungrouped is the opposite of scoped, team-
   delegated work. TEAMS are now the unit: "+ New task" lists ONLY teams (first
   preselected); picking a team runs the conductor scoped to that team. No teams
   yet shows an in-page CTA to create one, with no default-agent fallback.
   Deleted `launch-default`, `launchDefaultAgent`, `buildDefaultTeam`. Kept
   `CONDUCTOR_ROLE`, `buildConductorTeam`, `launchConductorTeam`, `launchTeamByName`.

The "no-team default agent / everyone team" concept earlier in this doc is
SUPERSEDED: a task always runs inside a team. Gate: green, 1454 tests (extension 694).
