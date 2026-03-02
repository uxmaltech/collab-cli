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

## Development commands

- `npm run lint` - static analysis for TypeScript sources.
- `npm run build` - compile TypeScript into `dist/`.
- `npm test` - build and run test suite.
- `npm run typecheck` - run TypeScript without emitting files.

## Project structure

```text
bin/               # executable entrypoint
src/
  commands/        # subcommand implementations
  templates/       # compose templates
  lib/             # shared utilities
tests/             # test files
```
