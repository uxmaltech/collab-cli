# Snapshot

- Phase: Post-phase 3 (governance + release readiness)
- Build system: TypeScript (`tsc`)
- CLI framework: Commander
- Command tree: `init`, `end`, `compose`, `infra`, `mcp`, `up`, `seed`, `doctor`, `update-canons`
- Wizard capabilities: `--yes`, `--resume`, `--force`, `--skip-analysis`, `--skip-ci`, `--skip-github-setup`, `--providers`, mode selection (`file-only` / `indexed`)
- Runtime orchestration: staged workflow with persisted recovery state
- Health checks: shared HTTP/TCP checker reused across infra/mcp/doctor
- Dry-run: global `--dry-run` with executor-driven zero side effects
- Compatibility: `ecosystem.manifest.json` + doctor/wizard checks
- AI providers: Codex (OpenAI), Claude (Anthropic), Gemini (Google), Copilot (GitHub) with auto-detection
- Canon management: sync from GitHub, scaffold generation, domain generation via `--repo`
- GitHub setup (indexed): branch model, protection, merge strategy, CI workflows via API
- Work finalization: `collab end` — PR creation, governance references, canon sync
- Workspace: multi-repo support with `--repos` flag
- Test layout: `tests/compose`, `tests/commands`, `tests/lib`
- CI: non-container checks on push/PR; protected `main` required checks
- Governance: `CONTRIBUTING.md` + structured issue template with dependencies section
- Release: tag-driven `release.yml` (validate, package, npm publish, GitHub release)
