# Brief

`collab-cli` is the command-line entrypoint for UxmalTech collaborative workflows.

Phase 2 delivers orchestration and wizard assembly:
- shared orchestration runner with persisted stage state (`--resume` support)
- shared health checker for HTTP/TCP dependencies
- global dry-run executor with zero-side-effect command/file execution
- onboarding wizard with mode selection (`file-only` / `indexed`)
- startup pipeline command (`collab up`)
- extended doctor checks (system, infra, MCP, config, version compatibility)
- ecosystem version manifest (`ecosystem.manifest.json`) with compatibility checks
