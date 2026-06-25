---
name: team-composition-patterns
description: Load when deciding how many teammates to delegate to and which roles to draw from the invoked team's
  roster. Use when sizing a team, picking the smallest set of roles that covers a task, or shaping a team in
  .conductor/teams.
---
# Team Composition Patterns

Adapted from github.com/wshobson/agents (MIT). See THIRD-PARTY-NOTICES.md.

How to size a team and pick which roles to delegate to. In Maestro a team is a
roster of roles defined in `.conductor/roles` and grouped in
`.conductor/teams`. The conductor is ALWAYS the coordinator: there is no
separate lead to spawn, and teammates cannot coordinate with each other. Choosing
which specialists to use means choosing which roles from the invoked team's
roster to send delegate blocks to.

## When to use this

- Deciding how many teammates to delegate to for a task.
- Choosing which roles from the roster cover the task's dimensions.
- Shaping a reusable team (a role roster) in `.conductor/teams`.
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

These are example role rosters you can define in `.conductor/teams`, grouping
roles from `.conductor/roles`. They are shapes, not built-ins: name the roles
to match your project, and remember the conductor coordinates all of them.

### Review team

- Size: 3 reviewer roles.
- Roles: a security reviewer, a performance reviewer, an architecture reviewer.
- Use when: changes need multi-dimensional quality assessment. Each reviewer
  reads the same diff in its own worktree and reports on its dimension.

### Debug team

- Size: 3 investigator roles.
- Roles: three investigators, each handed a different hypothesis.
- Use when: a bug has multiple plausible root causes. Pin one full hypothesis
  into each delegate block; the conductor compares the returned findings.

### Feature team

- Size: 2 to 3 implementer roles (the conductor coordinates, no separate lead).
- Roles: implementers, each owning a disjoint set of files.
- Use when: a feature decomposes into parallel work streams with clean file
  ownership.

### Fullstack team

- Size: 3 implementer roles.
- Roles: a frontend implementer, a backend implementer, a test implementer.
- Use when: a feature spans frontend, backend, and test layers. The conductor
  does any shared-types groundwork first, then fans out the three layers.

### Security team

- Size: 4 reviewer roles.
- Roles: vulnerabilities (OWASP), auth and access control, dependencies and
  supply chain, secrets and configuration.
- Use when: a comprehensive security audit covers several attack surfaces.

### Migration team

- Size: 2 to 3 implementer roles plus a reviewer role.
- Roles: implementers each owning a migration stream, plus a reviewer that
  verifies the migrated code. The conductor merges the streams, then delegates
  the verification pass over the merged result.
- Use when: a large codebase migration (framework upgrade, language port, API
  version bump) needs parallel work with correctness verification.

## Composing a team well

1. The conductor is the coordinator. There is no lead role to add; you hold the
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
