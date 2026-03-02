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

- `collab init` initializes `.collab/config.json` and `.env` defaults.
- `collab compose generate` generates compose files in consolidated or split mode.
- `collab compose validate` validates compose files via `docker compose config`.
- `collab infra up|down|status` manages infrastructure services.
- `collab mcp start|stop|status` manages MCP runtime service.
- `collab seed` runs seeding preflight checks.
- `collab doctor` reports environment diagnostics.

## Development commands

- `npm run lint` - static analysis for TypeScript sources.
- `npm run build` - compile TypeScript into `dist/`.
- `npm test` - build and run test suite.
- `npm run typecheck` - run TypeScript without emitting files.

## Compose generation examples

```bash
collab compose generate --mode consolidated
collab compose generate --mode split
collab compose validate --mode auto
```

By default generation creates/updates:

- `.env` with overridable image/port/volume values.
- `.collab/state.json` with generated-file hashes for drift detection.
- `docker-compose.yml` (consolidated) or `docker-compose.infra.yml` + `docker-compose.mcp.yml` (split).

## Project structure

```text
bin/                     # executable entrypoint
src/
  commands/              # command hierarchy and handlers
  lib/                   # shared utilities, renderer, validator, logger
  templates/             # compose templates
tests/                   # CLI integration/behavior tests
docs/ai/                 # AI-facing context maps and snapshots
```
