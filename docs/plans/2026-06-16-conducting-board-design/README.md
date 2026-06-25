# Maestro Conducting Board: Design Reference

*The build reference for Maestro's "Conducting Board" agent-team UX, captured from the Claude Design prototype on 2026-06-16.*

Maestro is a model-agnostic, editor-native VS Code extension that conducts AI coding agents (GitHub Copilot CLI plus a generic ACP engine family) in isolated git worktrees. Milestones M1 to M9 shipped a real, installable extension with a deliberately thin roster-plus-stage UI. After a dogfood run on 2026-06-16, the founder decided the bare UI did not match the intended experience and redirected to design the richer target UX first, visually, in Claude Design. This folder is that north-star, written so a designer and a frontend engineer can build from it.

Interactive prototype (hi-fi, session-state, simulated): https://claude.ai/design/p/87e11d04-30fb-4be6-8ea1-0e120a98618e (file `Maestro.dc.html`).

## How to read this

Start with **01** for the vision, the product principles, and the visual-token system that every other doc references. Then read **02** for the hero surface (the board) and the agent lifecycle. **03 to 06** each own one surface or feature. **07** is the engineering anchor: it ties the drawn UX to the real codebase, defines the additive data-model changes, and proposes a build order.

| Doc | Covers |
| --- | --- |
| [01-overview-and-visual-language.md](./01-overview-and-visual-language.md) | The pivot story, Paperclip borrow-versus-reject, product principles, the information architecture map, and the canonical dark-graphite visual-token system and glyph vocabulary. |
| [02-conducting-board-and-lifecycle.md](./02-conducting-board-and-lifecycle.md) | The board (Working / Needs you / Done-Conflict lanes), the agent card, the lifecycle-to-lane mapping over the real `AgentState`, the right-hand drawer (Instructions / Output / Diff, plus approve / steer / send-back and answer-to-unblock), the dispatch composer, launch-a-team, and the ambient status bar and tweaks panel. |
| [03-agents-teams-and-anatomy.md](./03-agents-teams-and-anatomy.md) | The Agents & Teams library and creation forms, and the enriched agent anatomy editor (Name · Soul · Instructions · Tools · Skills · Engine · Autonomy), including `soul.md` and the two-tier precedence model. |
| [04-reusable-skills.md](./04-reusable-skills.md) | Promoting Skills to a first-class shared library object: reference-not-copy, the "used by N agents" blast radius, the never-silent write-grant seam, adopt-from-Discover, and the Skills tab, skill editor, and upgraded attach picker. |
| [05-discover-and-adopt.md](./05-discover-and-adopt.md) | Discover-don't-just-create: detectable repo sources with confidence tiers, Copilot plugin scanning, mapping a foreign agent to a Maestro Role, and the adopt flow with its autonomy and write clamps. |
| [06-diff-merge-review.md](./06-diff-merge-review.md) | The full-width diff and merge review screen, the conflict variant, PR mode, and the cleanup-recovery states, over the real workspace merge engine. |
| [07-data-model-and-build-plan.md](./07-data-model-and-build-plan.md) | Package map, the current data model quoted from `packages/core`, the additive design-forward deltas, the `.conductor/` layout, composition-at-spawn, the permission seam, a cheapest-first build order, and a real-today-versus-drawn table. |

## The shape of the workflow

The prototype models the whole loop end to end:

discover or author **agents, teams, and reusable skills** (each agent carrying a soul, granted tools, and shared skills) → **dispatch** one or **launch a team** → the **Conducting Board** (Working / Needs you / Conflict) → the agent **drawer** (instructions, live output, diff, and answer-to-unblock) → the **diff and merge review** → **merge**.

## Build order, in one line

Cheapest to hardest, per [07](./07-data-model-and-build-plan.md): (a) reusable-skills data model first, because `Role.skills?: string[]` is a clean additive field that reuses the reference-by-name resolution the config validator already has for `Team.roles`; (b) the `soul?` and tools fields plus the composition-at-spawn preamble; (c) the read-only Discover and adopt scanners; (d) the heavy UI surfaces in the cockpit and extension webviews; (e) the granular tool-permission enforcement and adopt clamping.

## Status and caveats

This is a design reference, not shipped code. The prototype's data is session-state and resets on reload, and its streaming logs and timers are simulated client-side. The merge engine, worktree isolation, approvals and steering, persistence, `.conductor/` YAML config, and the Copilot and ACP adapters are already real from milestones M1 to M9 (see the `2026-06-14-maestro-*.md` docs in the parent folder). The Conducting Board visual UI, the enriched anatomy with soul, tools, and skills, reusable skills as a library object, Discover and adopt, and the rich diff review screen are the drawn parts that this reference exists to guide. The real-today-versus-drawn split is tabulated in [07](./07-data-model-and-build-plan.md).
