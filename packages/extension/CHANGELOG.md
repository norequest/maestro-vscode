# Changelog

All notable changes to the Hallucinate extension are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.12] - 2026-06-27

### Fixed

- Copilot fleet teams: the lead's Output tab now shows the assistant's readable narration instead of the raw JSON event stream. Base64 thinking signatures and envelope metadata are no longer leaked, and newlines render correctly.
- The Output panel wraps and scrolls long unbreakable content (for example base64) instead of corrupting the inspector layout.

## [0.1.11] - 2026-06-27

Board and library polish from a dogfooding pass.

### Added

- Team trays: a lead and its delegated teammates now render inside one labeled tray (team name, agent count, rolled-up status, a subtle team color) so a team reads as a single unit on the board.

### Changed

- Library: Teams is now the first tab and the default landing tab, and the Close control is a quieter, borderless ghost.
- Board footer: Floor and Status are a clearer segmented control with an obvious active state and keyboard navigation; the running and awaiting counters are now plainly passive readouts, not dead buttons.

### Fixed

- Discard and Merge from the full-page review now return you to the board instead of leaving you on the just-resolved card.
- A read-only sub-agent no longer shows "# Instructions" as its task, and instructions text is dedented so it reads cleanly.

## [0.1.10] - 2026-06-26

Initial public pre-release (beta). The first build of Hallucinate published to the VS Code Marketplace.

### Added

- Run a team of AI coding agents on one board inside VS Code.
- Two engine families: GitHub Copilot CLI and any ACP engine (for example, Gemini via `gemini --acp --stdio`).
- Isolation per agent: every agent works in its own `git worktree` on its own branch, so parallel agents never collide.
- Review before merge: a finished agent is a diff you review, not a surprise commit. Merge it, discard it, send it back with feedback, or open a pull request.
- Copilot fleet teams: a Copilot-led team can run as one shared session that dispatches named teammates in-context, producing one combined diff.
- Approvals and steering for engines that support them, so you can approve or deny a step and nudge an agent mid-run.
