export const implementationProcessTemplate = `# Implementation Process

> GOV-R-001 — How canonical architecture documentation is maintained.

## Process Overview

1. **Analysis** — AI or developer analyzes the repository to identify
   architectural patterns, decisions, and conventions.
2. **Generation** — Canonical files are generated or updated in
   \`docs/architecture/\`.
3. **Review** — Changes go through the standard PR review process.
4. **Merge** — Accepted changes are merged to the main branch.
5. **Ingestion** (indexed mode only) — Merged files are ingested into the
   vector and graph databases for retrieval.

## PR Workflow

Every pull request that modifies source code SHOULD also update the
relevant canonical files:

- New architectural decisions → \`knowledge/decisions/ADR-NNN-*.md\`
- New conventions observed → \`knowledge/conventions/CN-NNN-*.md\`
- Anti-pattern fixes → \`knowledge/anti-patterns/AP-NNN-*.md\`
- Domain boundary changes → \`domains/*.md\`

## Automation

- \`collab init\` generates the initial scaffold and runs AI analysis.
- CI workflows validate architecture consistency on PRs.
- Merge workflows trigger re-ingestion (indexed mode only).
`;
