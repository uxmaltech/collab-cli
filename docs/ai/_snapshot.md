# Snapshot

- Phase: 2 (orchestration + wizard assembly)
- Build system: TypeScript (`tsc`)
- CLI framework: Commander
- Command tree: `init`, `compose`, `infra`, `mcp`, `up`, `seed`, `doctor`
- Wizard capabilities: `--yes`, `--resume`, mode selection (`file-only` / `indexed`)
- Runtime orchestration: staged workflow with persisted recovery state
- Health checks: shared HTTP/TCP checker reused across infra/mcp/doctor
- Dry-run: global `--dry-run` with executor-driven zero side effects
- Compatibility: `ecosystem.manifest.json` + doctor/wizard checks
- CI: GitHub Actions (`lint`, `build`, `test`)
