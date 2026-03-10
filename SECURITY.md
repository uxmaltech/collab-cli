# Security Model

## Authentication

### OAuth Token

The CLI uses GitHub's OAuth Device Flow to authenticate. Token details:

- **Scopes**: `repo read:org read:project`
- **Storage**: `.collab/github-auth.json` (automatically added to `.gitignore`)
- **Validation**: verified via `GET /user` before any API call
- **Exposure**: never logged or passed to stage pipelines as plain text

### CANON_SYNC_PAT

During `collab init` (indexed mode), the CLI sets a `CANON_SYNC_PAT` repository secret on each governed repo. This secret is consumed by the `canon-sync-trigger.yml` workflow to create issues in the business-canon repository when code is merged to `main`.

**Current behavior**: the CLI re-uses the user's OAuth token as the PAT value. This means:

- The PAT has full `repo` scope (read/write access to all repos the user can access)
- If a governed repo is compromised, the PAT is exposed
- The PAT's lifetime is tied to the user's OAuth session

**Recommendations for production**:

1. **Fine-grained PATs**: Create a dedicated fine-grained personal access token with minimal permissions (only `issues: write` on the business-canon repo). Set it manually via `gh secret set CANON_SYNC_PAT -R <governed-repo>`.

2. **GitHub App**: For organization-wide deployments, use a GitHub App installation token instead of a personal token. This provides better audit trails and granular permissions.

3. **OIDC**: For CI-to-CI trust, consider GitHub's OIDC provider to exchange short-lived tokens without storing long-lived secrets.

## Branch Protection

### Defaults

When `collab init` configures GitHub repos, it applies these branch protection rules to `main`:

| Setting | Default |
|---------|---------|
| Required approvals | 1 |
| Dismiss stale reviews | true |
| Enforce for admins | false |
| Required status checks | none |

### Customization

Override defaults via `.collab/config.json`:

```json
{
  "github": {
    "requiredApprovals": 2,
    "dismissStaleReviews": true,
    "enforceAdmins": true,
    "requiredStatusChecks": ["validate (22)", "integration"]
  }
}
```

## Workflow Security

### Generated Workflows

The CLI generates these GitHub Actions workflows:

| Workflow | Secrets Used | Risk Level |
|----------|-------------|------------|
| `guard-main-pr.yml` | none | Low |
| `architecture-pr.yml` | none | Low |
| `architecture-merge.yml` | `MCP_URL` | Medium |
| `ast-delta-pr.yml` | `MCP_BASE_URL`, `MCP_API_KEY` | Medium |
| `canon-sync-trigger.yml` | `CANON_SYNC_PAT` | High |

### Secret Handling

- All secrets are passed via GitHub's encrypted secrets mechanism
- Secrets are never printed to logs (GitHub Actions masks them automatically)
- `continue-on-error: true` on AST workflows prevents secret-related failures from blocking PRs

### Recommendations

- Rotate `CANON_SYNC_PAT` periodically
- Use environment-scoped secrets for `MCP_BASE_URL` and `MCP_API_KEY`
- Review workflow permissions: AST delta uses `pull-requests: write` for PR comments
- Monitor Actions audit logs for unexpected workflow runs
