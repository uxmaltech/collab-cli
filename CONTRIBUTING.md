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

## Documentation maintenance

Any PR that adds, removes, or modifies a command, subcommand, or CLI flag **must** include corresponding documentation updates. This rule applies to all changes in `src/commands/`.

### Required updates

| What changed | Update required |
|---|---|
| New command or subcommand | Add section to README.md CLI Reference + update `docs/ai/_snapshot.md` |
| New `--flag` on any command | Add to the command's option table in README.md + update snapshot |
| Modified flag behavior | Update description in README.md + snapshot |
| Removed command or flag | Remove from README.md + snapshot |
| Pipeline flow change | Update relevant mermaid diagram in README.md |

### PR checklist for command changes

When your PR touches `src/commands/`:

- [ ] New/modified flags documented in README.md CLI Reference
- [ ] `docs/ai/_snapshot.md` updated if command surface changed
- [ ] Mermaid diagrams updated if pipeline flow changed
- [ ] CLI `--help` text is descriptive and consistent
- [ ] Examples updated if usage patterns changed

### CLI help text style guide

All Commander.js `.option()` descriptions must follow these conventions:

- **Start with a verb** — "Skip...", "Set...", "Override...", "Generate..."
- **No trailing period**
- **Include default value** if applicable — `(default: 5000)`
- **Explain what it does**, not just repeat the flag name
  - Bad: `--skip-analysis` → `"skip analysis"`
  - Good: `--skip-analysis` → `"Skip AI-powered repository analysis stage"`
