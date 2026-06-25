---
name: task-coordination-strategies
description: "Load when deciding how to split a task into independent teammates: pick a decomposition axis, do the
  prerequisite and glue work yourself first, then write one delegate block per independent unit. Use when a task is
  large enough to hand parts to worktree-isolated teammates."
---
# Task Coordination Strategies

Adapted from github.com/wshobson/agents (MIT). See THIRD-PARTY-NOTICES.md.

How to decompose a task into units you can hand to teammates that run in
isolation and compose cleanly. In Maestro there is no task graph and no
dependency-edge API. You, the conductor, do the prerequisite and glue work yourself,
then delegate the independent parts. Each independent unit becomes one fenced
```delegate``` block with a `role:` and a `task:`. A teammate runs once in
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

- `src/components/` to one teammate
- `src/api/` to another
- `src/utils/` to a third

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

```delegate
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
```

## How many units

Start with the smallest split that covers the dimensions the task needs, then
add only if a dimension is still uncovered:

- Simple task: do it yourself, or one teammate.
- Moderate task: 2 to 3 teammates along clear file or layer boundaries.
- Complex task: 3 to 4 teammates, one per major independent area.

If you find yourself wanting a fifth or sixth, the task probably has hidden
dependencies that will not run in parallel. Tighten the split, or do the
coupled part yourself first and fan out what remains.
