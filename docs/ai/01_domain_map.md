# Domain Map

## CLI Shell
- Global option parsing and command tree registration.
- Global execution controls (`--cwd`, `--dry-run`, `--verbose`, `--quiet`).
- Version display and help output.

## Wizard Orchestration
- Stage-based workflow execution for onboarding (`collab init`).
- Persistent stage state for recovery and `--resume`.
- Mode-aware stage skipping (`file-only` vs. `indexed`).
- Provider selection and auto-detection (`--providers`).
- Multi-repo workspace support (`--repos`).

## Runtime Orchestration
- Infra startup lifecycle with health waiting (`collab infra up|down|status`).
- MCP startup lifecycle with health endpoint verification (`collab mcp start|stop|status`).
- Full pipeline orchestration (`collab up` = infra → MCP).

## Canon Management
- Canon sync from GitHub repositories (`collab update-canons`).
- Canon scaffold generation for new repos (templates for governance, knowledge, domains, evolution).
- Domain generation via `collab init repos <package...>` — analyzes code and generates domain files (multi-repo support).

## Compose Generation Domain
- Template rendering for consolidated and split compose topologies.
- `.env` defaulting with user override preservation.
- Deterministic state hashing for regeneration drift detection.
- Compose validation via `docker compose config`.

## AI Client Domain
- Provider-agnostic AI client with model registry.
- Auto-detection of available providers via env vars and CLI binaries.
- MCP client config generation per provider (claude, gemini, codex).
- Model listing and selection.

## Health and Diagnostics
- Shared HTTP/TCP health checker reused by runtime commands and doctor.
- Preflight checks for dependency readiness (node, npm, git, docker).
- Doctor checks for system, config, service health, and compatibility.

## Compatibility Governance
- Ecosystem manifest-driven version checks across CLI, canon schema, and MCP.
- Compatibility warnings surfaced in wizard summary and doctor.

## GitHub Setup (indexed mode)
- GitHub API repo configuration: branch model (main/development), protection rules, merge strategy.
- CI workflow generation: guard-main-pr (blocks non-development PRs to main), canon-sync-trigger (creates issues on merge to main).
- Secret management: CANON_SYNC_PAT via `gh secret set` (stdin).
- Orchestration stage with `--skip-github-setup` flag.

## Testing and Validation
- Template-level snapshot/parameter tests for compose assets.
- Library unit tests for executor/preflight/orchestrator/health/mode/config behavior.
- Command tests for interactive wizard and flag validation.
- E2E full-flow check (indexed init → healthy MCP → MCP tool call) with Docker cleanup.
