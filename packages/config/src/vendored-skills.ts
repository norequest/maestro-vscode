import type { SkillManifest } from "./skill-types.js";

/**
 * Three on-demand SKILL.md files adapted for Hallucinate from
 * github.com/wshobson/agents (MIT). See THIRD-PARTY-NOTICES.md at the repo root
 * for the upstream copyright and full license text.
 *
 * Hallucinate reality these rewrites target: agents are isolated git-worktree
 * subprocesses. They cannot message each other, broadcast, or request
 * shutdown; there is no team config file or message bus. ALL coordination
 * flows through the lead agent and the human in the UI. The
 * lead delegates by emitting fenced ```delegate``` blocks (role:/task:
 * lines) that the human approves, or auto-approves for vetted roles. A
 * delegated teammate runs once in its own worktree and returns a diff the
 * lead reviews and merges.
 *
 * Every upstream primitive Hallucinate lacks has been stripped or rewritten:
 * SendMessage/broadcast/shutdown_request, ~/.claude/teams/<name>/config.json,
 * tmux/iterm2 display modes, TaskCreate/TaskUpdate addBlockedBy task graphs,
 * and subagent_type selection. No em dash appears in any name, description, or
 * body in this file.
 */

/** Shape every vendored skill uses: a parsed manifest plus its markdown body. */
type VendoredSkill = { manifest: SkillManifest; body: string };

/**
 * Reframes upstream task-coordination-strategies for Hallucinate. The lead
 * has no TaskCreate/blockedBy graph: it does prerequisite and glue work
 * itself, then delegates the independent parts as fenced delegate blocks.
 */
export const TASK_COORDINATION_STRATEGIES_SKILL: VendoredSkill = {
  manifest: {
    name: "task-coordination-strategies",
    description:
      "Load when deciding how to split a task into independent teammates: pick a decomposition axis, do the prerequisite and glue work yourself first, then write one delegate block per independent unit. Use when a task is large enough to hand parts to worktree-isolated teammates.",
  },
  body: `# Task Coordination Strategies

Adapted from github.com/wshobson/agents (MIT). See THIRD-PARTY-NOTICES.md.

How to decompose a task into units you can hand to teammates that run in
isolation and compose cleanly. In Hallucinate there is no task graph and no
dependency-edge API. You, the lead, do the prerequisite and glue work yourself,
then delegate the independent parts. Each independent unit becomes one fenced
\`\`\`delegate\`\`\` block with a \`role:\` and a \`task:\`. A teammate runs once in
its own git worktree and returns a diff you review and merge. It cannot message
you, ask a question, or see another teammate's work.

## When to use this

- Breaking down a large task so independent parts run as teammates.
- Choosing a decomposition axis that yields non-overlapping file ownership.
- Writing a task description complete enough for a fresh teammate.
- Deciding what must happen first and doing it yourself before you delegate.

## Decomposition axes

### By file ownership (primary)

Give each teammate a disjoint set of files. Worktree isolation means two
teammates editing the same file produce diffs that collide at merge, so
non-overlapping ownership is what makes parallel work actually compose.

- \`src/components/\` to one teammate
- \`src/api/\` to another
- \`src/utils/\` to a third

Best for: parallel implementation, conflict avoidance.

### By layer

Split along clean horizontal seams when each layer lives in different files:
frontend, API, database, tests. Best for full-stack features and vertical
slices where the layers do not share files.

### By component

One teammate per module, service, or feature area that already has its own
directory: an authentication module, a user-profile module, a notification
module. Best for modular architectures.

### By concern

Several passes over the same area, each looking for different problems:
security, performance, architecture. Best for reviews and hardening, where the
teammates read the same files but each reports on its own dimension.

## Prefer wide and shallow over deep chains

Delegation is one-shot. You cannot hand work back and forth, and a teammate
cannot pick up where another left off. So favor independent units that you can
launch together over a pipeline where one teammate's output feeds the next.

When a real ordering exists, you are the one who enforces it. There is no way to
mark one teammate as waiting on another. Instead:

1. Identify what must happen first. That is usually the shared foundation:
   types, interfaces, a migration, a base module others build on.
2. Do that foundation work yourself, or delegate it alone and merge its diff
   before anything depends on it.
3. Only after the prerequisite is merged do you delegate the dependent parts,
   which are now independent of each other and can run together.

This turns a chain into a short sequence of wide fan-outs: do the glue, fan out
the independent parts, merge, repeat if a second tier exists.

## Shared interfaces: pin the exact text in both blocks

Two delegated parts often have to agree on an interface (a type, a function
signature, a response shape). Teammates cannot message each other to settle it,
and one cannot invent it for the other. So write the exact interface text into
BOTH delegate blocks, verbatim, so each builds against the identical contract.
If the contract is not yet decided, decide it yourself first; do not leave it to
a teammate.

## Task description template

A teammate sees only the words in its delegate block. It has none of your
context, cannot ask a question, and cannot see the other teammates. Write each
task so it stands alone:

- Objective: the one outcome this teammate must deliver.
- Owned Files: the files this teammate may create or change. Name any shared
  file it may read for context but must not change.
- Requirements: the specific deliverables or behaviors expected.
- Interface Contract: the exact shared types or signatures, pasted verbatim
  into this block and into any sibling block that shares them.
- Acceptance Criteria: how the teammate knows it is done (tests pass, behavior
  visible, edge cases handled).
- Out of Scope: what to leave untouched, especially files another teammate owns.

### Example delegate block

\`\`\`delegate
role: implementer
task: |
  ## Objective
  Build the user authentication API endpoints.

  ## Owned Files
  - src/api/auth.ts
  - src/api/middleware/auth-middleware.ts
  Read for context, do not edit: src/types/auth.ts (the shared User type).

  ## Requirements
  - POST /api/login accepts email and password, returns a JWT.
  - POST /api/register creates a new user, returns a JWT.
  - GET /api/me returns the current user profile and requires auth.

  ## Interface Contract
  Use this exact type (pasted identically into the frontend teammate's block):
    interface AuthResponse { token: string; userId: string; expiresAt: number; }

  ## Acceptance Criteria
  - Endpoints return correct HTTP status codes.
  - JWTs expire after 24 hours.
  - Passwords are hashed with bcrypt.
  - New tests cover each endpoint and existing tests still pass.

  ## Out of Scope
  - OAuth and social login.
  - Password reset flow.
  - The signup form UI (another teammate owns it).
\`\`\`

## How many units

Start with the smallest split that covers the dimensions the task needs, then
add only if a dimension is still uncovered:

- Simple task: do it yourself, or one teammate.
- Moderate task: 2 to 3 teammates along clear file or layer boundaries.
- Complex task: 3 to 4 teammates, one per major independent area.

If you find yourself wanting a fifth or sixth, the task probably has hidden
dependencies that will not run in parallel. Tighten the split, or do the
coupled part yourself first and fan out what remains.
`,
};

/**
 * Reframes upstream team-composition-patterns for Hallucinate. "Which specialists
 * to load" means which roles from the invoked team's roster to delegate to.
 * Drops subagent_type, display modes, and Claude-Code agent-type names.
 */
export const TEAM_COMPOSITION_PATTERNS_SKILL: VendoredSkill = {
  manifest: {
    name: "team-composition-patterns",
    description:
      "Load when deciding how many teammates to delegate to and which roles to draw from the invoked team's roster. Use when sizing a team, picking the smallest set of roles that covers a task, or shaping a team in .hallucinate/teams.",
  },
  body: `# Team Composition Patterns

Adapted from github.com/wshobson/agents (MIT). See THIRD-PARTY-NOTICES.md.

How to size a team and pick which roles to delegate to. In Hallucinate a team is a
roster of roles defined in \`.hallucinate/roles\` and grouped in
\`.hallucinate/teams\`. The lead is ALWAYS the coordinator: there is no
separate coordinator to spawn, and teammates cannot coordinate with each other. Choosing
which specialists to use means choosing which roles from the invoked team's
roster to send delegate blocks to.

## When to use this

- Deciding how many teammates to delegate to for a task.
- Choosing which roles from the roster cover the task's dimensions.
- Shaping a reusable team (a role roster) in \`.hallucinate/teams\`.
- Trimming a team that grew too large to coordinate.

## Team sizing heuristics

| Complexity   | Teammates | When to use                                                 |
| ------------ | --------- | ----------------------------------------------------------- |
| Simple       | 1 to 2    | Single-dimension review, isolated bug, small feature        |
| Moderate     | 2 to 3    | Multi-file changes, 2 to 3 concerns, medium features        |
| Complex      | 3 to 4    | Cross-cutting concerns, large features, deep debugging      |
| Very Complex | 4 to 5    | Full-stack features, comprehensive reviews, systemic issues |

Rule of thumb: start with the smallest team that covers all required
dimensions. Every teammate you add is one more delegate block to approve and one
more diff to review and merge, so do not add a role until a dimension is
genuinely uncovered.

## Example team shapes

These are example role rosters you can define in \`.hallucinate/teams\`, grouping
roles from \`.hallucinate/roles\`. They are shapes, not built-ins: name the roles
to match your project, and remember the lead coordinates all of them.

### Review team

- Size: 3 reviewer roles.
- Roles: a security reviewer, a performance reviewer, an architecture reviewer.
- Use when: changes need multi-dimensional quality assessment. Each reviewer
  reads the same diff in its own worktree and reports on its dimension.

### Debug team

- Size: 3 investigator roles.
- Roles: three investigators, each handed a different hypothesis.
- Use when: a bug has multiple plausible root causes. Pin one full hypothesis
  into each delegate block; the lead compares the returned findings.

### Feature team

- Size: 2 to 3 implementer roles (the lead coordinates, no separate lead role).
- Roles: implementers, each owning a disjoint set of files.
- Use when: a feature decomposes into parallel work streams with clean file
  ownership.

### Fullstack team

- Size: 3 implementer roles.
- Roles: a frontend implementer, a backend implementer, a test implementer.
- Use when: a feature spans frontend, backend, and test layers. The lead
  does any shared-types groundwork first, then fans out the three layers.

### Security team

- Size: 4 reviewer roles.
- Roles: vulnerabilities (OWASP), auth and access control, dependencies and
  supply chain, secrets and configuration.
- Use when: a comprehensive security audit covers several attack surfaces.

### Migration team

- Size: 2 to 3 implementer roles plus a reviewer role.
- Roles: implementers each owning a migration stream, plus a reviewer that
  verifies the migrated code. The lead merges the streams, then delegates
  the verification pass over the merged result.
- Use when: a large codebase migration (framework upgrade, language port, API
  version bump) needs parallel work with correctness verification.

## Composing a team well

1. The lead is the coordinator. There is no separate lead role to add; you hold the
   roster, approve each delegate block, and integrate every returned diff.
2. Pick roles by the dimensions the task needs, not by what the roster happens
   to contain. A role you do not need is overhead.
3. Avoid duplicate roles. Two teammates doing the same thing produce
   overlapping diffs and wasted review.
4. Define boundaries upfront. Give each teammate clear ownership of files or a
   distinct review dimension before you delegate.
5. Keep it small. 2 to 4 teammates is the sweet spot; 5 or more usually means a
   hidden dependency you should resolve yourself first.

## Troubleshooting

The team is growing too large and coordination is slowing everything down.
Each teammate adds a delegate block to approve and a diff to merge. Consolidate:
can one role cover two dimensions? A team of four doing six independent units is
usually better served by three teammates covering two units each.

Two reviewers are flagging the same issues.
Their dimensions overlap. Redefine each reviewer's focus: one on
correctness and logic, one on security, one on performance. Overlapping coverage
produces duplicate findings.

Teammates are not receiving the context they need.
A teammate starts fresh with only the words in its delegate block. Put all
relevant information, including any shared interface, directly in the block.
There is no prior conversation for it to read.
`,
};

/**
 * The big rewrite. Upstream team-communication-protocols assumed a message bus
 * (message/broadcast/shutdown_request), a team config file, and runtime
 * hand-offs. Hallucinate has none of that: the protocol becomes complete-context
 * delegate blocks, no mid-flight hand-offs, pinned shared interfaces, blockers
 * surfaced to the human, and integration owned by the lead.
 */
export const TEAM_COMMUNICATION_PROTOCOLS_SKILL: VendoredSkill = {
  manifest: {
    name: "team-communication-protocols",
    description:
      "Load when coordinating teammates that cannot talk to each other: how to put complete context in a delegate block, avoid hand-offs, pin shared interfaces, surface blockers to the human, and integrate returned diffs yourself. Use whenever delegated work must compose.",
  },
  body: `# Team Communication Protocols

Adapted from github.com/wshobson/agents (MIT). See THIRD-PARTY-NOTICES.md.

How teammates coordinate in Hallucinate, given that they cannot. Each teammate is an
isolated git-worktree subprocess. There is no message bus, no send-to-all, no
remote shutdown, and no team config file. A teammate cannot message a peer,
cannot message you, and cannot see another teammate's work. It runs once on the
words in its delegate block and returns a diff. Coordination is therefore not
runtime messaging: it is what you write into each block, and what you, the
lead, do with the diffs that come back.

## When to use this

- Coordinating teammates whose work must compose into one change.
- Writing a delegate block that a fresh, context-free teammate can act on.
- Settling a shared interface between two delegated parts.
- Handling a teammate that came back blocked or incomplete.
- Integrating several returned diffs into the working tree.

## The protocol

### 1. Put complete context in every delegate block

A teammate starts fresh with only the words you write. It has none of your
conversation, cannot ask a clarifying question, and cannot read another block.
So each block must carry everything: the objective, the owned files, the
requirements, the exact shared interface, the acceptance criteria, and what is
out of scope. If you would have to explain something in a follow-up message,
that something belongs in the block, because there is no follow-up message.

### 2. No mid-flight hand-offs

A teammate runs once and returns a diff. You cannot tell it mid-run to wait for
another teammate, and you cannot have teammate A finish what teammate B started.
So do not design a relay. Split the work into independent units, each
self-contained. If a real ordering exists, do the prerequisite yourself (or
delegate it alone and merge its diff) BEFORE you delegate the parts that depend
on it.

### 3. For shared interfaces, write the contract into both blocks

When two delegated parts must agree on a type or signature, there is no runtime
message to settle it and no shared file they both edit safely. Decide the exact
contract yourself, then paste that exact text into BOTH dependent blocks. Each
teammate builds against the identical words. Do not expect one teammate to
publish an interface for the other to discover; it cannot.

### 4. Blockers surface to the human, not to a peer

A teammate that hits a blocker cannot ask a peer or you for help mid-run. It
returns what it has, and the blocker surfaces to the human in the UI. The fix is
to re-delegate with the missing context added. Hallucinate re-launches a sent-back
teammate in the SAME worktree, so its earlier work is preserved: you add the
context it lacked and send it back, rather than starting over.

### 5. Integration is the lead's job

Teammates never integrate with each other. Each returns a diff against its own
worktree. You review each diff, resolve any overlap, and merge them into the
working tree in an order that keeps the tree building. If two diffs touch the
same lines, that is a sign the split was not clean: prefer disjoint file
ownership so the diffs compose without conflict.

### 6. The human approves each delegate block

Every delegate block is approved by the human in the UI before its teammate
launches (or auto-approved for vetted roles). Write each block to be approvable
on its own: clear objective, clear ownership, nothing assumed from off-screen
context.

## Anti-patterns

| Anti-pattern                              | Why it fails in Hallucinate                                  | Do instead                                                       |
| ----------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------- |
| Assuming a teammate can see another's work | Worktrees are isolated; it sees only its own block       | Paste any shared context or interface into every block          |
| Designing a relay or mid-flight hand-off   | A teammate runs once; there is no pause or pick-up        | Split into independent units; do prerequisites yourself first   |
| Splitting work that needs tight back-and-forth | No back-and-forth exists between teammates            | Keep it one block, or do that coupled part yourself             |
| Omitting context, expecting a question     | A teammate cannot ask; it just runs on what it has        | Front-load every requirement and constraint into the block      |
| Expecting teammates to integrate together  | They cannot reach each other's worktrees                 | The lead reviews and merges every diff                          |
| Leaving a shared interface undecided       | Neither teammate can settle it at runtime                | Decide the contract yourself, pin the exact text in both blocks |

## Troubleshooting

A teammate came back without finishing.
It likely lacked context or hit a blocker, and it cannot ask. Read its diff and
notes, identify the missing piece, add it to the task, and send the teammate
back. Hallucinate re-launches it in the same worktree, so its progress is kept.

Two returned diffs conflict on the same lines.
The split was not clean. Re-cut the work so each teammate owns disjoint files,
or fold the overlapping part into one block. Then re-delegate the affected parts.

A teammate built against the wrong interface.
The contract was not pinned, or the two blocks disagreed. Write the exact
interface text and paste it identically into every block that shares it, then
re-delegate the parts that drifted.
`,
};

/** All three vendored skills, in the order the scaffolder writes them. */
export const VENDORED_SKILLS: readonly VendoredSkill[] = [
  TASK_COORDINATION_STRATEGIES_SKILL,
  TEAM_COMPOSITION_PATTERNS_SKILL,
  TEAM_COMMUNICATION_PROTOCOLS_SKILL,
];
