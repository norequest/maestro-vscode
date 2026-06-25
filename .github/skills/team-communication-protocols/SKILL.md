---
name: team-communication-protocols
description: "Load when coordinating teammates that cannot talk to each other: how to put complete context in a delegate
  block, avoid hand-offs, pin shared interfaces, surface blockers to the human, and integrate returned diffs yourself.
  Use whenever delegated work must compose."
---
# Team Communication Protocols

Adapted from github.com/wshobson/agents (MIT). See THIRD-PARTY-NOTICES.md.

How teammates coordinate in Maestro, given that they cannot. Each teammate is an
isolated git-worktree subprocess. There is no message bus, no send-to-all, no
remote shutdown, and no team config file. A teammate cannot message a peer,
cannot message you, and cannot see another teammate's work. It runs once on the
words in its delegate block and returns a diff. Coordination is therefore not
runtime messaging: it is what you write into each block, and what you, the
conductor, do with the diffs that come back.

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
to re-delegate with the missing context added. Maestro re-launches a sent-back
teammate in the SAME worktree, so its earlier work is preserved: you add the
context it lacked and send it back, rather than starting over.

### 5. Integration is the conductor's job

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

| Anti-pattern                              | Why it fails in Maestro                                  | Do instead                                                       |
| ----------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------- |
| Assuming a teammate can see another's work | Worktrees are isolated; it sees only its own block       | Paste any shared context or interface into every block          |
| Designing a relay or mid-flight hand-off   | A teammate runs once; there is no pause or pick-up        | Split into independent units; do prerequisites yourself first   |
| Splitting work that needs tight back-and-forth | No back-and-forth exists between teammates            | Keep it one block, or do that coupled part yourself             |
| Omitting context, expecting a question     | A teammate cannot ask; it just runs on what it has        | Front-load every requirement and constraint into the block      |
| Expecting teammates to integrate together  | They cannot reach each other's worktrees                 | The conductor reviews and merges every diff                     |
| Leaving a shared interface undecided       | Neither teammate can settle it at runtime                | Decide the contract yourself, pin the exact text in both blocks |

## Troubleshooting

A teammate came back without finishing.
It likely lacked context or hit a blocker, and it cannot ask. Read its diff and
notes, identify the missing piece, add it to the task, and send the teammate
back. Maestro re-launches it in the same worktree, so its progress is kept.

Two returned diffs conflict on the same lines.
The split was not clean. Re-cut the work so each teammate owns disjoint files,
or fold the overlapping part into one block. Then re-delegate the affected parts.

A teammate built against the wrong interface.
The contract was not pinned, or the two blocks disagreed. Write the exact
interface text and paste it identically into every block that shares it, then
re-delegate the parts that drifted.
