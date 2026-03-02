# Brief

`collab-cli` is the command-line entrypoint for UxmalTech collaborative workflows.

Phase 1 delivers core compose generation capabilities:
- command hierarchy (`init`, `compose`, `infra`, `mcp`, `seed`, `doctor`)
- compose generation in `consolidated` and `split` modes
- compose validation via `docker compose config`
- idempotent regeneration with drift warnings and `.env` override preservation
- shared command logging with verbosity controls
