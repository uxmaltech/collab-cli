# collab-cli

Command-line interface for collaborative architecture and delivery workflows at UxmalTech.

## Prerequisites

- Node.js 20+
- npm 10+

## Install (local development)

```bash
npm install
npm run build
```

Run the CLI directly:

```bash
bin/collab --help
```

## Core commands

- `collab init` runs the onboarding wizard (`--yes`, `--resume`, mode selection).
- `collab compose generate` generates compose files in consolidated or split mode.
- `collab compose validate` validates compose files via `docker compose config`.
- `collab infra up|down|status` manages infrastructure services and health checks.
- `collab mcp start|stop|status` manages MCP runtime service and health checks.
- `collab up` orchestrates full startup pipeline (`infra -> mcp`).
- `collab seed` runs seeding preflight checks.
- `collab doctor` runs system/config/health/version diagnostics.

Global options:

- `--cwd <path>` run command in a target workspace.
- `--dry-run` preview every action with zero side effects.
- `--verbose` enable detailed command logging.
- `--quiet` suppress non-result output.

## Wizard quick examples

```bash
collab init
collab init --yes
collab init --yes --mode file-only
collab init --resume
```

Wizard stages:

1. Preflight checks
2. Environment/config setup
3. Compose generation + validation
4. Infra startup (indexed mode)
5. MCP startup (indexed mode)
6. Codex MCP snippet generation
7. Optional ingest bootstrap
8. Summary

## Compose generation examples

```bash
collab compose generate --mode consolidated
collab compose generate --mode split
collab compose validate --mode auto
```

Generation creates/updates:

- `.env` with overridable image/port/volume values.
- `.collab/state.json` with generated-file hashes and workflow stage state.
- `docker-compose.yml` (consolidated) or `docker-compose.infra.yml` + `docker-compose.mcp.yml` (split).

## Development commands

- `npm run lint` - static analysis for TypeScript sources.
- `npm run build` - compile TypeScript into `dist/`.
- `npm test` - build and run test suite.
- `npm run test:e2e` - run Docker-backed end-to-end flow (`init --mode indexed` to MCP tool call).
- `npm run typecheck` - run TypeScript without emitting files.

## Project structure

```text
bin/                     # executable entrypoint
scripts/                 # local scripts (test runner)
src/
  commands/              # command hierarchy and handlers
  lib/                   # shared utilities, orchestrator, health, executor
  templates/             # compose templates
tests/                   # CLI integration + orchestration tests
docs/ai/                 # AI-facing context maps and snapshots
ecosystem.manifest.json  # cross-repo version compatibility ranges
```
