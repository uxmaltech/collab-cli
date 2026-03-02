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
- `src/commands/infra/*`: infra lifecycle subcommands (`up`, `down`, `status`).
- `src/commands/mcp/*`: MCP lifecycle subcommands (`start`, `stop`, `status`).
- `src/commands/seed.ts`: pre-seed readiness command.
- `src/commands/doctor.ts`: diagnostics and compatibility report.

## Shared Libraries
- `src/lib/config.ts`: workspace config loading and defaults (includes project mode).
- `src/lib/mode.ts`: mode parsing and defaults (`file-only`, `indexed`).
- `src/lib/command-context.ts`: global options -> command context translation.
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
- `src/lib/state.ts`, `src/lib/hash.ts`: generated-file + workflow state management.
- `src/lib/compose-paths.ts`: deterministic compose path resolution.
- `src/lib/prompt.ts`: wizard interaction prompts.

## Templates and Manifests
- `src/templates/consolidated.ts`: single-file topology template.
- `src/templates/infra.ts`: infra-only topology template.
- `src/templates/mcp.ts`: MCP-only topology template with external shared network.
- `ecosystem.manifest.json`: compatibility ranges for CLI/canon/MCP.

## Tests
- `tests/cli-help.test.mjs`: top-level and grouped help assertions.
- `tests/compose-generate.test.mjs`: generation idempotence, dry-run, env preservation, split outputs, validate preconditions.
- `tests/phase2-workflows.test.mjs`: wizard behavior, up-mode behavior, orchestrator resume state.
- `tests/helpers/*.mjs`: CLI and workspace test helpers.
