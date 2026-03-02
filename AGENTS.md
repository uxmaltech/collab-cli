# Repository Guidelines

## Purpose & Scope
`collab-cli` provides the command-line entrypoint for UxmalTech collaborative workflows. Keep CLI orchestration thin and move reusable logic into domain-oriented modules under `src/lib` (and future `src/application` or `src/domain` when needed).

## Project Structure & Module Organization
- `bin/` executable wrappers.
- `src/commands/` command registration and command handlers.
- `src/lib/` shared utilities and reusable abstractions.
- `src/templates/` template assets used by commands.
- `tests/` automated checks.
- `.github/workflows/` CI pipelines.

## Build, Test, and Development Commands
- `npm install` install dependencies.
- `npm run lint` run static analysis.
- `npm run build` compile TypeScript into `dist/`.
- `npm test` run tests (build + node test runner).
- `bin/collab --help` verify runtime entrypoint.

## Coding Style & Naming
- TypeScript with strict compiler checks.
- Keep files and modules focused and reusable.
- Prefer small command handlers that call shared functions instead of inlining logic.
- Use clear domain naming (`doctor`, `context`, `project`) rather than technology naming.

## Testing Expectations
- Every new command should have at least one integration-style CLI test in `tests/`.
- Validate help output and error paths for new commands.
- Keep tests deterministic and independent from network access by default.

## Anti-patterns
- Duplicating the same parsing or formatting logic across command files.
- Embedding business workflows directly in `bin/` scripts.
- Tight coupling between CLI presentation and domain logic.
