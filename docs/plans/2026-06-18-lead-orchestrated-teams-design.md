# Lead-orchestrated teams

Status: accepted (2026-06-18). Supersedes the original `launchTeam` fan-out.

## Problem

`launchTeam(team, description)` fanned the **same** task to **every** role at once:

```ts
launchTeam(team, description) {
  return team.roles.map((role) => {
    this.registerRole(role);
    return this.spawn(role.name, description); // identical task to all
  });
}
```

So a 2-agent team given "hello world" started both agents in parallel, each
doing the whole task in its own worktree. That is duplication, not teamwork.
`maxParallelAgents` only throttles how many run at once; it still queues
everyone to eventually run. There was no ordering, no lead, no notion of whether
an agent was even needed.

This is only correct for one narrow case (N agents racing the same goal so you
pick the best result). For a normal team it is wrong.

## Decision

A team is **lead-orchestrated** with **approve-each-dispatch**:

1. **One lead launches.** A team has an optional `lead:` field (a role name;
   defaults to the first role). `launchTeam` spawns ONLY the lead.
2. **The lead is a delegating worker.** Its instructions are prefixed with a
   *lead brief* that names its teammates and teaches it the delegation format. A
   trivial task it just does itself. A real task it breaks down and delegates.
3. **Delegation is a directive in the lead's stream.** The lead emits a fenced
   block; the orchestrator parses it from the lead's output. No MCP or per-engine
   tool wiring, so it is adapter-agnostic (Copilot plain text and ACP both work):

   ````
   ```delegate
   role: coder
   task: implement the parser in src/parse.ts
   ```
   ````
4. **You approve each delegation.** A parsed directive becomes a
   `DelegationProposal` (state `pending`) and emits `delegation-proposed`.
   Nothing spawns until the conductor approves. Approve spawns the teammate;
   deny drops the proposal.
5. **Teammates are normal agents.** Each approved teammate gets its own worktree,
   runs (capped by `maxParallelAgents`), and produces its own diff you
   review/merge/discard exactly as today. It is tagged `parentId = lead.id` so the
   board can group it under the lead.
6. **Nothing lands without you.** Delegation only *starts* an agent; every diff
   still passes the review-before-merge gate.

### Scope (v1, YAGNI)

- One-shot delegation: the lead delegates then finishes. It does NOT wait to read
  teammate results. Lead-reviews-teammate-output is a later enhancement.
- Teammates cannot see the lead's or each other's uncommitted work (separate
  worktrees), so the brief instructs the lead to make each subtask self-contained.
- A directive naming the lead itself or an unknown role is ignored and logged.

## Contract (frozen)

### `@maestro/core`

`types.ts`
- `Team.lead?: string` (role name; must be one of `roles`).
- `Agent.parentId?: string` (the lead's agent id when delegated).
- `SpawnOptions` gains `instructionsPrefix?: string` and `parentId?: string`.
- New `DelegationProposal { id; leadAgentId; roleName; task; state: "pending" | "approved" | "denied" }`.
- `OrchestratorEvent` gains
  `| { kind: "delegation-proposed"; proposal: DelegationProposal }`
  `| { kind: "delegation-resolved"; proposal: DelegationProposal }`.

`delegation.ts` (new, pure)
- `DELEGATE_FENCE = "delegate"`.
- `parseDelegateDirectives(text): { role; task }[]`: every COMPLETE
  ```` ```delegate ```` block in accumulated output; incomplete trailing blocks
  ignored (streaming-safe).
- `buildLeadBrief(team, lead): string`: the instructions prefix.

`orchestrator.ts`
- `spawn` applies `instructionsPrefix` (derived role, registration untouched) and
  sets `parentId` before emitting `agent-added`.
- `launchTeam` registers all roles, resolves the lead, spawns ONLY the lead with
  the brief, records lead context. Returns `[lead]` (or `[]` for an empty team).
- `applyEvent` "output": for a lead agent, accumulate text and scan for new
  complete directives; each valid teammate directive emits `delegation-proposed`
  (deduped by role+task). Unknown/self targets ignored.
- `approveDelegation(id): Agent`: pending only; spawns the teammate
  (`parentId = leadAgentId`), emits `delegation-resolved`.
- `denyDelegation(id): void`: pending only; emits `delegation-resolved`.
- `getDelegations(): DelegationProposal[]`.

### `@maestro/config`
- `validateTeam` accepts optional `lead`; if present must name a role in the
  team (else a validation error). `serializeTeam` writes `lead` when set.

### `@maestro/cockpit`
- Reducer handles `delegation-proposed` / `delegation-resolved`; view model
  exposes pending delegations; the attention selector surfaces them.

### `@maestro/extension`
- Host forwards `delegation-proposed` / `delegation-resolved` to the webview and
  maps Approve/Deny back to `approveDelegation` / `denyDelegation`.
- The board renders a proposal card (Approve/Deny, escapeHtml, graphite palette)
  and groups child agents under their lead.

## Tests
- core: directive parser (multiline task, partial/streamed, dedupe, unknown/self
  ignored); `launchTeam` spawns only the lead; approve spawns a parented
  teammate; deny drops it; brief lists teammates and the fence.
- config: `lead` round-trips; unknown `lead` is a validation error.
- cockpit: proposed adds a pending item and raises attention; resolved clears it.
- extension: proposal renders and Approve/Deny call through; child grouping.
