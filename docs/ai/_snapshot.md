# Snapshot

- Phase: 1 (core compose generation)
- Build system: TypeScript (`tsc`)
- CLI framework: Commander
- Command tree: `init`, `compose`, `infra`, `mcp`, `seed`, `doctor`
- Compose modes: `consolidated`, `split`
- Compose safety: validation, hash-based drift detection, `.env` override preservation
- Logging: shared logger with `--verbose` and `--quiet`
- CI: GitHub Actions (`lint`, `build`, `test`)
