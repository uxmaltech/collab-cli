# GitHub Repository Configuration — Collab Ecosystem

Standard configuration for all `uxmaltech/collab-*` repositories.
Use this as the source of truth when onboarding new repos or auditing existing ones.

## Repositories

| Repo | Visibility | Default Branch |
|------|-----------|----------------|
| collab-cli | public | development |
| collab-architecture | public | development |
| collab-architecture-mcp | private | development |
| collab-core-pkg | private | development |
| collab-chat-ai-pkg | private | development |
| collab-laravel-app | private | development |
| collab-app-architecture | private | development |
| collab-project-manager-pkg | private | development |

## Merge Settings (repo-level)

These are global per-repository settings. All repos must match:

| Setting | Value | Reason |
|---------|-------|--------|
| `allow_squash_merge` | `false` | Squash creates new SHAs, breaks fast-forward from development to main |
| `allow_rebase_merge` | `false` | Rebase recreates commits with new SHAs, same problem as squash |
| `allow_merge_commit` | `true` | Only allowed method — preserves original SHAs for fast-forward compatibility |

### Why squash and rebase are disabled

The `development → main` promotion uses **fast-forward only** (via `promote-main-ff` workflow).
Fast-forward requires the exact same commit SHAs on both branches. Squash and rebase create
new commits with different SHAs, causing the branches to diverge and breaking subsequent
fast-forward merges.

### API to apply

```bash
gh api repos/uxmaltech/{REPO} -X PATCH \
  -f allow_squash_merge=false \
  -f allow_rebase_merge=false \
  -f allow_merge_commit=true
```

## Branch Protection: `development`

| Setting | Value |
|---------|-------|
| `required_linear_history` | `false` |
| `enforce_admins` | `false` |
| `required_conversation_resolution` | `true` |
| `required_approving_review_count` | `1` |
| `dismiss_stale_reviews` | `true` |
| `bypass_pull_request_allowances` | `["enmaca"]` |
| `allow_force_pushes` | `false` |
| `allow_deletions` | `false` |
| `required_status_checks` | repo-specific (see below) |

## Branch Protection: `main`

| Setting | Value | Reason |
|---------|-------|--------|
| `required_linear_history` | `false` | Was `true`, removed to allow disabling squash/rebase globally |
| `enforce_admins` | `false` | |
| `required_conversation_resolution` | `true` | |
| `required_approving_review_count` | `1` | |
| `dismiss_stale_reviews` | `true` | |
| `bypass_pull_request_allowances` | `["enmaca"]` | |
| `allow_force_pushes` | `false` | |
| `allow_deletions` | `false` | |
| `required_status_checks` | repo-specific (see below) |

### API to apply branch protection

```bash
# For repos WITH required status checks:
gh api repos/uxmaltech/{REPO}/branches/{BRANCH}/protection -X PUT --input - <<'PROTECTION'
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["check-name-1", "check-name-2"]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": {
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": false,
    "require_last_push_approval": false,
    "required_approving_review_count": 1,
    "bypass_pull_request_allowances": {
      "users": ["enmaca"],
      "teams": [],
      "apps": []
    }
  },
  "restrictions": null,
  "required_linear_history": false,
  "required_conversation_resolution": true,
  "allow_force_pushes": false,
  "allow_deletions": false
}
PROTECTION

# For repos WITHOUT required status checks:
# Use "required_status_checks": null
```

## Required Status Checks (per repo)

| Repo | development | main |
|------|-------------|------|
| collab-cli | validate(20), validate(22), integration | validate(20), validate(22), integration, e2e, check-source-branch |
| collab-architecture-mcp | lint-build-test, integration | lint-build-test, integration |
| collab-core-pkg | — | — |
| collab-chat-ai-pkg | — | — |
| collab-laravel-app | — | — |
| collab-app-architecture | — | — |
| collab-project-manager-pkg | — | — |
| collab-architecture | — | — |

## Release Chain (collab-cli)

The release pipeline is fully automated via workflow chaining:

```
PR approved (development → main)
  │
  ▼
promote-main-ff.yml
  ├── Validates: approval + all status checks pass
  ├── Fast-forwards main to development (git push, not merge button)
  └── Triggers: auto-release.yml via workflow_dispatch
        │
        ▼
      auto-release.yml
        ├── Bumps patch version in package.json
        ├── Commits chore(release): v{version}
        ├── Creates and pushes tag v{version}
        ├── Syncs development to main (fast-forward)
        └── Triggers: release.yml via workflow_dispatch --ref v{tag}
              │
              ▼
            release.yml
              ├── Validates: lint, build, test, tag/version match
              ├── Publishes to npm
              └── Creates GitHub Release with .tgz artifact
```

### Secrets required

| Secret | Purpose |
|--------|---------|
| `RELEASE_PAT` | Fine-Grained PAT with Contents (R/W) + Actions (R/W). Used to bypass branch protection on main and chain workflow_dispatch events. |
| `NPM_TOKEN` | npm access token for publishing `@uxmaltech/collab-cli` to the registry. |

### Why workflow_dispatch chaining?

`GITHUB_TOKEN` pushes (branches and tags) do **not** trigger `on: push` workflows.
However, `GITHUB_TOKEN` **can** trigger `workflow_dispatch` events.
Each workflow explicitly calls the next via `gh workflow run`.
The `RELEASE_PAT` is used instead of `GITHUB_TOKEN` for pushes to protected branches (main)
because `GITHUB_TOKEN` acts as `github-actions[bot]` which is not in the bypass list.

### Guard workflow

`guard-main-pr.yml` rejects PRs to `main` from any branch other than `development`.
Added as required status check (`check-source-branch`) on main.

## Audit Script

Run this to verify all repos match the standard config:

```bash
for repo in collab-cli collab-architecture-mcp collab-core-pkg \
            collab-chat-ai-pkg collab-laravel-app collab-app-architecture \
            collab-project-manager-pkg collab-architecture; do
  echo "=== $repo ==="
  gh api "repos/uxmaltech/$repo" \
    --jq '{squash: .allow_squash_merge, rebase: .allow_rebase_merge, merge: .allow_merge_commit}'
  gh api "repos/uxmaltech/$repo/branches/main/protection" \
    --jq '{linear_history: .required_linear_history.enabled, enforce_admins: .enforce_admins.enabled}' 2>/dev/null || echo "  (no main protection)"
  gh api "repos/uxmaltech/$repo/branches/development/protection" \
    --jq '{linear_history: .required_linear_history.enabled}' 2>/dev/null || echo "  (no development protection)"
  echo ""
done
```

Expected output for every repo:
```json
{"squash": false, "rebase": false, "merge": true}
{"linear_history": false, "enforce_admins": false}
{"linear_history": false}
```
