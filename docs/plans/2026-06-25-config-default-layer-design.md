# Config-driven default layer

Date: 2026-06-25
Branch: feat/conducting-board
Status: accepted, building

## Why

Founder: "instead of giving instruction to a default agent, why don't we put
default skills or instructions to invoke it on every prompt." Correct. The
conductor's behavior should be a configurable DEFAULT layer applied on every
run, not hand-fed to one bespoke role in code.

Decisions:
- Adopt a config-driven default layer in `.conductor` (editable in one place).
- Split: general defaults apply to EVERY agent; the delegation/orchestration
  brief applies only to the agent that holds a team roster (the lead). A "how to
  delegate" brief is inert for a sub-agent that has no roster, so it must not be
  blanket-injected into every prompt.

## The `defaults` block (`.conductor/config.yaml`)

```yaml
defaults:
  instructions: ""        # standing instructions composed into EVERY agent
  skills: []              # skill names composed into EVERY agent
  leadSkills:             # skill names composed ONLY into the lead
    - delegation-playbook
```

## Architecture (by package)

### core (`@maestro/core`)
- New `AgentDefaults = { instructions?: string; skills?: string[]; leadSkills?: string[] }`.
- The orchestrator holds defaults (a `setDefaults(d)` setter, default empty).
- At spawn, build an EFFECTIVE role before composing the preamble:
  - instructions = `defaults.instructions` + role.instructions (general layer, all agents).
  - skills = `defaults.skills` + (isLead ? `defaults.leadSkills` : []) + role.skills.
  - Then compose as today (the existing injected skill-resolver resolves the merged
    skill names, so no resolver change is needed: the default skills ride in on
    role.skills).
- `buildLeadBrief` SLIMS: keep the dynamic roster listing + the exact parseable
  ```delegate fence format (authoritative, in code). REMOVE the long playbook
  prose (it now lives in the delegation-playbook skill, applied via leadSkills),
  ending the duplication. A one-line pointer ("follow your delegation playbook")
  is fine.

### config (`@maestro/config`)
- Parse/serialize `defaults` into `AgentDefaults` (import the type from core).
- Validator: warn (not error) on a default skill name that does not resolve,
  mirroring the role/team reference-by-name warning style.
- Scaffolder: write a starter `defaults` block with
  `leadSkills: ["delegation-playbook"]` (and empty general instructions/skills),
  idempotent.

### extension (`maestro`)
- Load `defaults` from config and `orch.setDefaults(defaults)` at activate.
- `CONDUCTOR_ROLE`: drop the hardcoded `skills: ["delegation-playbook"]` (now
  config `leadSkills`); keep it as a thin lead persona (name + minimal
  instructions). Keep `buildConductorTeam` / `launchConductorTeam` / the
  teams-only launch flow.
- Scaffold the `defaults` block on first run.

## Build order
core -> config -> extension -> full `pnpm verify`.

## Out of scope (v1)
- `leadInstructions` config (the dynamic roster + fence in buildLeadBrief covers
  the lead's code-side text; richer lead prose belongs in the leadSkills skill).
- Recursive sub-delegation (sub-agents getting their own rosters). The split was
  chosen precisely to avoid this: only the lead delegates.
