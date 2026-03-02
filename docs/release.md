# collab-cli release and distribution strategy

## Distribution channels

Primary channel:
- npm package: `@uxmaltech/collab-cli`

Secondary channel:
- Source installer script from `main`: `install.sh` for latest-main installation/update.

Note:
- Standalone binaries are not currently published. npm is the supported versioned channel.

## Versioning policy

- SemVer is used (`MAJOR.MINOR.PATCH`).
- Release tags are prefixed with `v` (for example `v0.2.0`).
- `collab --version` reads package version metadata, which must match the published npm package version and tag.

## Release process

1. Prepare release PR against `development`:
   - update changelog/release notes
   - ensure lint/build/test are green
2. Merge into `development`.
3. Promote tested commit to `main`.
4. Create and push tag from `main`:
   - `git tag vX.Y.Z`
   - `git push origin vX.Y.Z`
5. GitHub Actions release workflow performs:
   - validation (lint/build/test)
   - package artifact creation (`npm pack`)
   - npm publish (`npm publish --access public`)
   - GitHub release creation with attached package artifact

Required secret:
- `NPM_TOKEN` with publish permissions for `@uxmaltech/collab-cli`.

## Install and upgrade commands

Local/global install:
```bash
npm install -g @uxmaltech/collab-cli
collab --version
```

Ephemeral use:
```bash
npx @uxmaltech/collab-cli --help
```

Upgrade to latest published version:
```bash
npm install -g @uxmaltech/collab-cli@latest
```

Install latest `main` (non-version-pinned):
```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/uxmaltech/collab-cli/main/install.sh)"
```

Update latest-main install:
```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/uxmaltech/collab-cli/main/install.sh)" -- --update
```

## CI pinning examples

Pin an exact version in CI:
```bash
npm install -g @uxmaltech/collab-cli@0.1.0
collab --version
```

Or lock in `package.json`:
```json
{
  "devDependencies": {
    "@uxmaltech/collab-cli": "0.1.0"
  }
}
```

## Rollback strategy

If a release is broken:
1. Re-pin consumers to last known good version:
   - `npm install -g @uxmaltech/collab-cli@<previous-version>`
2. Mark the broken release in GitHub release notes.
3. Publish a corrective patch release (`vX.Y.(Z+1)`).
4. For latest-main script installs, rerun installer on the target known-good commit/tag if required by operations.
