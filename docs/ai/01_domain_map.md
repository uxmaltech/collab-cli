# Domain Map

## CLI Shell
- Global option parsing and command tree registration.
- Global execution controls (`--cwd`, `--dry-run`, verbosity flags).

## Wizard Orchestration
- Stage-based workflow execution for onboarding.
- Persistent stage state for recovery and `--resume`.
- Mode-aware stage skipping (`file-only` vs. `indexed`).

## Runtime Orchestration
- Infra startup lifecycle with health waiting.
- MCP startup lifecycle with health endpoint verification.
- Full pipeline orchestration (`collab up`).

## Compose Generation Domain
- Template rendering for consolidated and split compose topologies.
- `.env` defaulting with user override preservation.
- Deterministic state hashing for regeneration drift detection.

## Health and Diagnostics
- Shared HTTP/TCP health checker reused by runtime commands and doctor.
- Preflight checks for dependency readiness.
- Doctor checks for system, config, service health, and compatibility.

## Compatibility Governance
- Ecosystem manifest-driven version checks across CLI, canon schema, and MCP.
- Compatibility warnings surfaced in wizard summary and doctor.
