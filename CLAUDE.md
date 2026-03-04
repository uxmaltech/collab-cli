# CLAUDE.md

This is `collab-cli`, the TypeScript CLI orchestrator for UxmalTech collaborative workflows with canonical architecture.

## Key facts

- This is a TypeScript CLI built with Commander, compiled with `tsc`
- Two modes of operation: `file-only` (no Docker) and `indexed` (Qdrant + NebulaGraph + MCP)
- The CLI orchestrates canon sync, infrastructure, MCP server, and domain generation
- Application canon repos are **configurable** — the CLI asks which repo to use during `collab init` (indexed mode)

## Ecosystem context

- `collab-cli` (this repo) is the user-facing orchestrator
- `collab-architecture` is the framework-level canonical source of truth
- `collab-architecture-mcp` is the MCP server exposing canon as graph + vectors
- Application canons are separate repos that inherit from the framework canon

The CLI should consume those systems through explicit interfaces, not by embedding their internals.

## Build, test, run

- Install: `npm install`
- Build: `npm run build`
- Lint: `npm run lint`
- Format: `npm run format` (check) / `npm run format:write` (fix)
- Test: `npm test` (build + run tests)
- E2E: `npm run test:e2e` (requires Docker)
- Typecheck: `npm run typecheck`
- Run locally: `bin/collab --help`

## File structure

```
bin/collab              → Runtime executable shim
src/
  cli.ts               → Root command, global options, registration
  index.ts             → Process entrypoint
  commands/            → One module per subcommand (init, compose, infra, mcp, up, seed, doctor, update-canons)
  stages/              → Pipeline stages for wizard (10 stages: preflight → canon-ingest)
  lib/                 → Shared utilities (35 modules: config, executor, orchestrator, health, AI, compose, canon...)
  templates/           → Compose topology templates + CI + canon scaffold templates
tests/                 → compose/, commands/, lib/, e2e/, helpers/
ecosystem.manifest.json → Cross-repo compatibility ranges
```

## Commands

| Command | Description |
|---------|-------------|
| `collab init` | Wizard onboarding (8 stages file-only, 14 stages indexed) |
| `collab compose generate\|validate` | Docker Compose generation and validation |
| `collab infra up\|down\|status` | Qdrant + NebulaGraph infrastructure lifecycle |
| `collab mcp start\|stop\|status` | MCP server lifecycle |
| `collab up` | Full startup pipeline (infra → MCP) |
| `collab seed` | Pre-seed readiness check |
| `collab doctor` | System diagnostics and compatibility |
| `collab update-canons` | Download/update canon from GitHub |

## Development tasks

1. Add a command module under `src/commands/`.
2. Register it in `src/commands/index.ts`.
3. Add pipeline stages under `src/stages/` if needed.
4. Extract reusable logic into `src/lib/`.
5. Add tests under `tests/` covering help and execution paths.
6. Run `npm run lint && npm run build && npm test` before opening a PR.

## Key conventions

- Side effects go through `src/lib/executor.ts` (supports `--dry-run`)
- Stage orchestration uses `src/lib/orchestrator.ts` with persistent state for `--resume`
- Config is centralized in `src/lib/config.ts` — workspace-level `.collab/config.json`
- Health checks use `src/lib/health-checker.ts` (shared HTTP/TCP with retry/timeout)
- AI providers are detected via `src/lib/cli-detection.ts` and configured via `src/lib/providers.ts`
- Canon scaffold templates live in `src/templates/canon/`

## Do not

- Hardcode canon repo names — they are configurable via workspace config
- Bypass the executor for file/process operations
- Skip `ecosystem.manifest.json` version checks
- Use `require()` — this project uses ESM imports
