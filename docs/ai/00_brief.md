# Brief

`collab-cli` is the command-line entrypoint for UxmalTech collaborative workflows.

Phase 3 adds comprehensive testing coverage:
- compose template snapshot and parameter coverage tests (`tests/compose/*`)
- command-level tests for wizard interaction and subcommand argument validation (`tests/commands/*`)
- shared library unit tests for preflight, executor, mode/config parsing, health checks, and orchestration recovery (`tests/lib/*`)
- opt-in E2E full-flow test from indexed init to MCP tool call (`tests/e2e/full-flow.test.mjs`)
- CI e2e job with Docker support and strict timeout/cleanup

Current governance and delivery additions:
- `CONTRIBUTING.md` enforces English-only issue policy and structured issue quality.
- `.github/ISSUE_TEMPLATE/work-item.yml` standardizes Context/Problem/Scope/Acceptance/Dependencies.
- `install.sh` supports deterministic latest-main install/update without sudo.
- `docs/release.md` defines npm-first distribution, version pinning, and rollback flow.
