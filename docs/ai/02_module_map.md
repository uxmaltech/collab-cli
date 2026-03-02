# Module Map

## CLI Root
- `src/cli.ts`: root command, global options, and registration wiring.
- `src/index.ts`: process entrypoint and typed error-to-exit handling.
- `src/commands/index.ts`: centralized command registry.

## Commands
- `src/commands/init.ts`: bootstraps `.collab/config.json` and `.env`.
- `src/commands/compose/generate.ts`: compose generation orchestrator.
- `src/commands/compose/validate.ts`: compose validation command.
- `src/commands/infra/*`: infra lifecycle subcommands (`up`, `down`, `status`).
- `src/commands/mcp/*`: MCP lifecycle subcommands (`start`, `stop`, `status`).
- `src/commands/seed.ts`: pre-seed readiness command.
- `src/commands/doctor.ts`: environment diagnostics.

## Shared Libraries
- `src/lib/config.ts`: workspace config loading and defaults.
- `src/lib/command-context.ts`: global options -> command context translation.
- `src/lib/logger.ts`: shared logging abstraction and verbosity controls.
- `src/lib/preconditions.ts`: reusable fail-fast checks.
- `src/lib/process.ts`: generic process execution wrapper.
- `src/lib/docker-compose.ts`: shared docker compose command runner.
- `src/lib/compose-renderer.ts`: shared compose rendering + idempotent state handling.
- `src/lib/compose-validator.ts`: compose validation and error formatting.
- `src/lib/compose-env.ts`: `.env` merge/preservation helper.
- `src/lib/state.ts`, `src/lib/hash.ts`: generated-file hash state management.
- `src/lib/compose-paths.ts`: deterministic compose path resolution.

## Templates
- `src/templates/consolidated.ts`: single-file topology template.
- `src/templates/infra.ts`: infra-only topology template.
- `src/templates/mcp.ts`: MCP-only topology template with external shared network.

## Tests
- `tests/cli-help.test.mjs`: top-level and grouped help assertions.
- `tests/compose-generate.test.mjs`: generation idempotence, env preservation, split outputs, and validate preconditions.
