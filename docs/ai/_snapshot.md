# Snapshot

- Phase: Post-phase 3 (governance + release readiness)
- Build system: TypeScript (`tsc`)
- CLI framework: Commander.js
- Test runner: `node:test` native, `node scripts/run-tests.mjs`

## Command tree (11 commands, 10 subcommands)

| Command | Subcommands | Description |
|---------|-------------|-------------|
| `init` | `infra`, `repos`, `github-workflow` | Onboarding wizard, domain generation, infra setup, GitHub workflows |
| `canon` | `rebuild` | Destroy and recreate derived canon artifacts |
| `compose` | `generate`, `validate` | Docker Compose file generation and validation |
| `infra` | `up`, `down`, `status` | Infrastructure services lifecycle (Qdrant + NebulaGraph) |
| `mcp` | `start`, `stop`, `status` | MCP runtime service lifecycle |
| `up` | — | Full startup pipeline (infra → MCP) |
| `seed` | — | Baseline infrastructure readiness check |
| `doctor` | — | System diagnostics across config, health, versions |
| `update-canons` | — | Download/update canons from GitHub |
| `upgrade` | — | Check for and install latest CLI version |
| `uninstall` | — | Remove collab-cli from system |

## Global options

`--cwd`, `--dry-run`, `--verbose`, `--quiet`, `-v/--version`

## Init wizard capabilities

- Flags: `--yes`, `--resume`, `--force`, `--mode`, `--compose-mode`, `--infra-type`, `--mcp-url`
- Skip flags: `--skip-analysis`, `--skip-ci`, `--skip-github-setup`, `--skip-mcp-snippets`, `--skip-ingest`, `--skip-ast-generation`
- Configuration: `--providers`, `--business-canon`, `--github-token`, `--repos`, `--repo` (deprecated)
- Health tuning: `--timeout-ms`, `--retries`, `--retry-delay-ms`
- Mode selection: `file-only` (8 stages) / `indexed` (15 stages)
- Domain generation: `collab init repos <package...>` with file-only or indexed pipeline + repo-ingest stage (multi-repo support)
- Repo-ingest stage: tree-sitter AST extraction (PHP, TypeScript) → MCP graph + document chunking → MCP vectors

## Runtime patterns

- Staged orchestration: `OrchestrationStage` with `{id, title, recovery[], run(ctx)}`
- Persisted recovery state for `--resume` support
- Health checks: shared HTTP/TCP checker reused across infra/mcp/doctor
- Dry-run: global `--dry-run` with executor-driven zero side effects
- Compatibility: `ecosystem.manifest.json` + doctor/wizard checks

## AI providers

Codex (OpenAI), Claude (Anthropic), Gemini (Google), Copilot (GitHub) with auto-detection via env vars or CLI presence.

## Canon management

- Framework canon: `collab-architecture` synced from GitHub
- Business canon: configurable `owner/repo` or local path
- Domain generation: `collab init repos <package...>` scans packages → AI analysis → domain file write → AST/document ingestion (multi-repo support)
- Canon sync: planned as part of `collab epic` lifecycle (#125)

## GitHub integration

- Standalone setup: `collab init github-workflow` runs auth + github-setup + ci-setup as standalone pipeline
- Branch model, protection rules, merge strategy, CI workflows via API (indexed mode)
- GitHub token: `--github-token` flag or interactive `gh auth` flow

## Test layout

`tests/compose`, `tests/commands`, `tests/lib`, `tests/e2e`, `tests/stages`

## CI strategy

- Non-container checks on push/PR to `development`
- Docker `e2e` only on PRs targeting `main`
- Protected `main` with required checks

## Governance

- `CONTRIBUTING.md`: language policy (English), issue quality requirements, PR rules, documentation maintenance
- Structured issue template with dependencies section
- Release: tag-driven `release.yml` (validate, package, npm publish, GitHub release)
