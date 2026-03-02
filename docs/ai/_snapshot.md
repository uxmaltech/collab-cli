# Snapshot

- Phase: Post-phase 3 (governance + release readiness)
- Build system: TypeScript (`tsc`)
- CLI framework: Commander
- Command tree: `init`, `compose`, `infra`, `mcp`, `up`, `seed`, `doctor`
- Wizard capabilities: `--yes`, `--resume`, mode selection (`file-only` / `indexed`)
- Runtime orchestration: staged workflow with persisted recovery state
- Health checks: shared HTTP/TCP checker reused across infra/mcp/doctor
- Dry-run: global `--dry-run` with executor-driven zero side effects
- Compatibility: `ecosystem.manifest.json` + doctor/wizard checks
- Test layout: `tests/compose`, `tests/commands`, `tests/lib`, `tests/e2e`
- CI: non-container checks on push/PR; Docker `e2e` only on PRs targeting `main`; protected `main` required checks
- Governance: `CONTRIBUTING.md` + structured issue template with dependencies section
- Release: tag-driven `release.yml` (validate, package, npm publish, GitHub release)
