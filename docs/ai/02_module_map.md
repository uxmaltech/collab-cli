# Module Map

## CLI Root
- `src/cli.ts`: root command, global options, and registration wiring.
- `src/index.ts`: process entrypoint and typed error-to-exit handling.
- `src/commands/index.ts`: centralized command registry.

## Commands
- `src/commands/init.ts`: onboarding wizard and stage orchestration.
- `src/commands/up.ts`: full startup pipeline (`infra -> mcp`).
- `src/commands/compose/generate.ts`: compose generation orchestrator.
- `src/commands/compose/validate.ts`: compose validation command.
- `src/commands/compose/index.ts`: compose subcommand group.
- `src/commands/infra/up.ts`: infra startup with Docker.
- `src/commands/infra/down.ts`: infra teardown.
- `src/commands/infra/status.ts`: infra health status.
- `src/commands/infra/shared.ts`: shared infra utilities.
- `src/commands/infra/index.ts`: infra subcommand group.
- `src/commands/mcp/start.ts`: MCP server startup.
- `src/commands/mcp/stop.ts`: MCP server shutdown.
- `src/commands/mcp/status.ts`: MCP health status.
- `src/commands/mcp/shared.ts`: shared MCP utilities.
- `src/commands/mcp/index.ts`: MCP subcommand group.
- `src/commands/seed.ts`: pre-seed readiness command.
- `src/commands/doctor.ts`: diagnostics and compatibility report.
- `src/commands/update-canons.ts`: download/update canon from GitHub.

## Stages (init pipeline)
- `src/stages/repo-analysis.ts`: AI-powered code analysis (indexed mode).
- `src/stages/repo-analysis-fileonly.ts`: basic code analysis (file-only mode).
- `src/stages/assistant-setup.ts`: AI provider configuration.
- `src/stages/agent-skills-setup.ts`: agent skills and prompts registration.
- `src/stages/repo-scaffold.ts`: `docs/architecture` and `docs/ai` scaffolding.
- `src/stages/canon-scaffold.ts`: canon structure generation for repos.
- `src/stages/canon-sync.ts`: download canon from GitHub.
- `src/stages/canon-ingest.ts`: ingest canon into Qdrant/NebulaGraph.
- `src/stages/ci-setup.ts`: GitHub Actions templates.
- `src/stages/graph-seed.ts`: initialize knowledge graph.

## Shared Libraries
- `src/lib/config.ts`: workspace config loading and defaults (includes project mode).
- `src/lib/mode.ts`: mode parsing and defaults (`file-only`, `indexed`).
- `src/lib/command-context.ts`: global options → command context translation.
- `src/lib/executor.ts`: side-effect executor with dry-run support.
- `src/lib/logger.ts`: shared logging abstraction and verbosity controls.
- `src/lib/orchestrator.ts`: stage runner with persistent progress/failure state.
- `src/lib/health-checker.ts`: shared HTTP/TCP health checks with retry/timeout.
- `src/lib/service-health.ts`: infra/MCP health target orchestration.
- `src/lib/preflight.ts`: dependency readiness checks.
- `src/lib/ecosystem.ts`: compatibility checks via manifest + external version sources.
- `src/lib/preconditions.ts`: reusable fail-fast checks.
- `src/lib/process.ts`: executor-backed process runner.
- `src/lib/docker-compose.ts`: shared docker compose command runner.
- `src/lib/compose-renderer.ts`: shared compose rendering + idempotent state handling.
- `src/lib/compose-validator.ts`: compose validation and error formatting.
- `src/lib/compose-env.ts`: `.env` merge/preservation helper.
- `src/lib/compose-defaults.ts`: default compose configuration values.
- `src/lib/compose-paths.ts`: deterministic compose path resolution.
- `src/lib/state.ts`: generated-file + workflow state management.
- `src/lib/hash.ts`: content hashing for state detection.
- `src/lib/prompt.ts`: wizard interaction prompts.
- `src/lib/shell.ts`: shell command execution utilities.
- `src/lib/env-file.ts`: .env file parsing and management.
- `src/lib/errors.ts`: typed error classes.
- `src/lib/ansi.ts`: ANSI color/formatting utilities.
- `src/lib/version.ts`: CLI version resolution.
- `src/lib/credentials.ts`: credential management.
- `src/lib/ai-client.ts`: provider-agnostic AI client.
- `src/lib/model-registry.ts`: AI model definitions and registry.
- `src/lib/model-listing.ts`: model listing and selection.
- `src/lib/cli-detection.ts`: CLI tool detection (codex, claude, gemini, gh).
- `src/lib/providers.ts`: AI provider configuration.
- `src/lib/canon-resolver.ts`: canon repository resolution.
- `src/lib/canon-scaffold.ts`: canon structure generation templates.
- `src/lib/repo-scanner.ts`: repository structure scanner.
- `src/lib/repo-analysis-helpers.ts`: code analysis helper utilities.

## Templates
- `src/templates/consolidated.ts`: single-file compose topology template.
- `src/templates/infra.ts`: infra-only topology template.
- `src/templates/mcp.ts`: MCP-only topology template with external shared network.
- `src/templates/ci/index.ts`: CI template registry.
- `src/templates/ci/architecture-pr.ts`: PR validation workflow template.
- `src/templates/ci/architecture-merge.ts`: merge workflow template.
- `src/templates/canon/index.ts`: canon template registry.
- `src/templates/canon/system-prompt.ts`: system prompt template.
- `src/templates/canon/knowledge-readme.ts`: knowledge index template.
- `src/templates/canon/domain-readme.ts`: domain index template.
- `src/templates/canon/contracts-readme.ts`: contracts index template.
- `src/templates/canon/evolution/changelog.ts`: changelog template.
- `src/templates/canon/governance/*.ts`: governance document templates.

## Manifests
- `ecosystem.manifest.json`: compatibility ranges for CLI, canon schema, and MCP versions.

## Governance and Delivery
- `CONTRIBUTING.md`: contribution and issue-language policy.
- `.github/ISSUE_TEMPLATE/work-item.yml`: standard issue intake for context/problem/scope/acceptance/dependencies.
- `install.sh`: latest-main installer/update entrypoint with user-local symlink flow.
- `uninstall.sh`: uninstall script.
- `docs/release.md`: distribution channels, semver policy, release/pinning/rollback guidance.
- `.github/workflows/release.yml`: tag-triggered validate/package/publish/release workflow.

## Tests
- `tests/compose/*`: template snapshots + parameter coverage + override/edge scenarios.
- `tests/commands/*`: wizard flow and subcommand parsing/validation tests.
- `tests/lib/*`: executor, preflight, health-checker, mode/config, orchestration-recovery tests.
- `tests/e2e/full-flow.test.mjs`: indexed end-to-end flow and MCP tool-call validation.
- `tests/cli-help.test.mjs`, `tests/compose-generate.test.mjs`, `tests/phase2-workflows.test.mjs`: baseline CLI integration and phase-2 behavior tests.
- `tests/helpers/*.mjs`: reusable helpers for CLI execution, fake docker, snapshots, MCP HTTP, config/logger fixtures.
