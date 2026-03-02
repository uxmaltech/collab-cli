# Domain Map

## CLI Shell
- Global option parsing and command tree registration.

## Command Handlers
- `init`: local configuration bootstrap.
- `compose`: generate/validate workflows.
- `infra`: infrastructure service lifecycle wrappers.
- `mcp`: MCP runtime lifecycle wrappers.
- `seed`: seeding preflight checks.
- `doctor`: local diagnostics.

## Compose Generation Domain
- Template rendering for consolidated and split compose topologies.
- `.env` defaulting with user override preservation.
- Deterministic state hashing for regeneration drift detection.

## Infrastructure Command Execution
- Shared docker compose execution abstraction.
- Fast-fail preconditions for required binaries and files.

## Observability
- Shared logger with `normal`, `verbose`, and `quiet` behavior.
