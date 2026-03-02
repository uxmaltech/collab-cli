# collab-cli — Agent Guidelines

## Purpose
This repository hosts `collab`, a TypeScript CLI used to orchestrate collaborative architecture and engineering workflows.

## Ecosystem context
- `collab-cli` is the user-facing command runner.
- `collab-architecture` is the canonical architecture knowledge source.
- `collab-architecture-mcp` provides MCP tooling and retrieval services.

The CLI should consume those systems through explicit interfaces, not by embedding their internals.

## Build, test, run
- Install: `npm install`
- Lint: `npm run lint`
- Build: `npm run build`
- Test: `npm test`
- Run locally: `bin/collab --help`

## File structure
- `bin/collab` runtime executable shim.
- `src/cli.ts` root command wiring.
- `src/commands/` one module per subcommand.
- `src/lib/` shared utilities and abstractions.
- `src/templates/` command templates/assets.
- `tests/` CLI integration and behavior tests.

## Development tasks
1. Add a command module under `src/commands/`.
2. Register it from `src/cli.ts`.
3. Extract reusable logic into `src/lib/`.
4. Add tests under `tests/` covering help and execution paths.
5. Run `npm run lint && npm run build && npm test` before opening a PR.
