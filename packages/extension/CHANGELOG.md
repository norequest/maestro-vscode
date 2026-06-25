# Changelog

All notable changes to the Hallucinate extension are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.10] - 2026-06-26

Initial public pre-release (beta). The first build of Hallucinate published to the VS Code Marketplace.

### Added

- Run a team of AI coding agents on one board inside VS Code.
- Two engine families: GitHub Copilot CLI and any ACP engine (for example, Gemini via `gemini --acp --stdio`).
- Isolation per agent: every agent works in its own `git worktree` on its own branch, so parallel agents never collide.
- Review before merge: a finished agent is a diff you review, not a surprise commit. Merge it, discard it, send it back with feedback, or open a pull request.
- Copilot fleet teams: a Copilot-led team can run as one shared session that dispatches named teammates in-context, producing one combined diff.
- Approvals and steering for engines that support them, so you can approve or deny a step and nudge an agent mid-run.
