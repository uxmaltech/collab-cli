# Development Guide

## Prerequisites

- Node.js >= 20
- npm >= 10
- Python 3 (used by ingestion tooling)
- Docker Desktop or Docker Engine (for indexed mode)

## Setup

```bash
git clone https://github.com/uxmaltech/collab-cli.git
cd collab-cli
npm install
npm run build
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run lint` | Run ESLint |
| `npm run format` | Check Prettier formatting |
| `npm run format:write` | Auto-fix Prettier formatting |
| `npm test` | Build + run all unit/integration tests |
| `npm run test:e2e` | Build + run E2E tests (requires Docker) |
| `npm run typecheck` | Type-check without emitting |
| `npm run pack:dry-run` | Preview npm package contents |

## Git Workflow

### Branches

- **`development`** — integration branch, all feature work merges here
- **`main`** — stable releases, only receives fast-forward merges from `development`
- **`feature/*`** — feature branches, created from `development`

### Branch Protection

Both `main` and `development` are protected:
- Pull request required with at least 1 approval
- Stale reviews dismissed on new pushes
- All status checks must pass

### Working on an Issue

```bash
git checkout development
git pull origin development
git checkout -b feature/<issue-number>-short-description

# ... make changes ...

git push -u origin feature/<issue-number>-short-description
gh pr create --base development
```

After PR review and approval, merge into `development`. Never push directly to `development` when working on an issue.

### Promoting to Main

1. Create a PR from `development` to `main`
2. On approval, the **`promote-main-ff.yml`** workflow automatically fast-forwards `main` to `development`
3. The **`auto-release.yml`** workflow then:
   - Bumps the patch version in `package.json` (e.g., `0.1.0` -> `0.1.1`)
   - Commits `chore(release): v0.1.1`
   - Creates and pushes tag `v0.1.1`
   - Fast-forwards `development` to include the version bump
4. The tag triggers **`release.yml`** which publishes to npm and creates a GitHub Release

## Versioning

This project follows [Semantic Versioning](https://semver.org/): `MAJOR.MINOR.PATCH`.

### Patch Releases (automatic)

Patch versions are bumped automatically when `development` is merged to `main`. No manual action needed.

```
development --PR--> main --auto-release--> v0.1.1 --release.yml--> npm publish
```

### Minor Releases (feature bump)

For new features that warrant a minor version bump:

```bash
git checkout development
git pull origin development

# Bump minor version (e.g., 0.1.x -> 0.2.0)
npm version minor --no-git-tag-version
git add package.json
git commit -m "chore: bump version to 0.2.0"
git push origin development

# Then create PR development -> main as usual
# auto-release detects the pre-bumped version (no tag exists) and tags it directly
```

### Major Releases (breaking changes)

Same flow as minor, using `major`:

```bash
npm version major --no-git-tag-version
git add package.json
git commit -m "chore: bump version to 1.0.0"
git push origin development
```

## CI/CD Workflows

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `ci.yml` | Push/PR to `development` | Lint, build, test (Node 20 & 22) |
| `integration.yml` | Push/PR to `development` | Integration tests + package validation |
| `guard-issues.yml` | Issue opened | Verify author is collaborator |
| `promote-main-ff.yml` | PR review on `main` | Fast-forward `main` to `development` |
| `auto-release.yml` | Push to `main` | Patch bump, tag, sync `development` |
| `release.yml` | Tag `v*.*.*` | Validate, publish npm, create GitHub Release |

## Testing

### Unit and Integration Tests

```bash
npm test
```

Uses Node.js built-in test runner (`node:test`). Tests are in `tests/` and require a prior build.

### Writing Tests

- Test files: `tests/**/*.test.mjs` (ESM)
- Use `createRequire` to import from `dist/`
- Helper utilities in `tests/helpers/`
- Use `makeTempWorkspace()` for isolated filesystem tests
- Use `runCli()` for CLI integration tests
