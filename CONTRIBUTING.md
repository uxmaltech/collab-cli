# Contributing to collab-cli

## Language policy for issues

All GitHub issues in this repository must be written in English.

This applies to:
- Issue title
- Problem statement
- Scope and acceptance criteria
- Follow-up discussion in issue comments

If an issue is submitted in another language, maintainers may request an English update before triage.

## Issue quality requirements

Use the issue template and include all required sections:
- Context
- Problem
- Scope
- Acceptance criteria
- Dependencies

For `Dependencies`, explicitly list cross-repo links when applicable:
- `uxmaltech/collab-architecture`
- `uxmaltech/collab-architecture-mcp`

If there are no external dependencies, write `None`.

## Pull requests

- Keep PRs focused and reference related issues (`Closes #<number>` when complete).
- Run `npm run lint`, `npm run build`, and `npm test` before opening a PR.
- For release-sensitive changes, include rollback notes in the PR description.
