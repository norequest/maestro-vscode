# Skills home moves to .github/skills

Date: 2026-06-25
Branch: feat/conducting-board
Status: accepted, building

## Why

Founder, emphatic and repeated: "VS Code uses references only from `.github`
folder. The skills are in a different folder." Copilot (CLI and the VS Code
extension) discovers skills under `.github/skills`. Maestro currently keeps the
editable source in `.conductor/skills/` and materializes the per-run copy in
`.agents/skills/`, neither of which is where the founder (or Copilot in VS Code)
looks. Move the skills home to `.github/skills/`.

## Decision

- `.github/skills/<name>/SKILL.md` is the skills HOME. Maestro scaffolds,
  ensures, and (via the Library) writes skills there. The founder sees and edits
  them in `.github`, and Copilot discovers them natively.
- `.conductor/` keeps roles, teams, and config.yaml only (skills leave it).
- `loadSkills` reads `.github/skills/` PRIMARY, with `.conductor/skills/` as a
  back-compat fallback (merge by name, `.github` wins) so existing setups and the
  earlier `ensureVendoredSkills` writes still resolve.
- Worktree delivery: materialize the resolved skills into the worktree's
  `.github/skills/` so the spawned `copilot -C <worktree>` discovers them even
  when the main-repo skills are not committed. Also keep `.agents/skills/` for
  Gemini/ACP (Gemini does not read `.github`). Both are git-excluded in the
  worktree so they never appear in the review diff.

Copilot CLI skill discovery (verified earlier) scans `.github/skills`,
`.claude/skills`, and `.agents/skills`, so `.github/skills` is a real native
location, not just a convention.

## Sites to change (from grep)

- config `skill-loader.ts:57` (read): `.github/skills` primary + `.conductor/skills` fallback.
- config `scaffolder.ts:74` (scaffoldIfMissing) and `:104` (ensureVendoredSkills): write skills to `.github/skills`; roles/teams/config.yaml stay under `.conductor/`.
- extension `config-gateway.ts:97,106` (Library skill write/delete): `.github/skills`.
- workspace `git-workspace-manager.ts:213` (writeSkills): worktree `.github/skills` (+ keep `.agents/skills`), exclude `.github/skills/` and `.agents/` from the diff.
- extension: any discover-adopt skill target and UI copy that says `.conductor/skills` -> `.github/skills`.

## Build order
config and workspace in parallel (SkillRef is unchanged, both depend only on
core), then extension (Library/config-gateway, after config builds), then full
`pnpm verify`.

## Out of scope
- Moving roles/teams/config out of `.conductor/` (they stay).
- A two-way editable mirror between `.conductor/skills` and `.github/skills`
  (the home simply moves; `.conductor/skills` is read-only legacy fallback).
