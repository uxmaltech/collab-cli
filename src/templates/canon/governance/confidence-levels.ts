export const confidenceLevelsTemplate = `# Confidence Levels

> How confidence is assigned to canonical entries.

## Levels

### HIGH

The entry is verified by multiple independent signals:

- Source code structure confirms the pattern.
- Tests exercise the behavior.
- Existing documentation corroborates the decision.

### MEDIUM

The entry is verified by at least one signal:

- Code structure suggests the pattern.
- A single test or doc reference supports it.

### LOW

The entry is inferred from indirect evidence:

- Code comments or naming conventions hint at the pattern.
- AI analysis identified it but no direct verification exists.

## Promotion Rules

- Entries at **LOW** should be verified within 2 sprint cycles.
- If not verified, they move to \`evolution/deprecated.md\` with rationale.
- Entries at **MEDIUM** can be promoted to **HIGH** when additional
  verification signals are added (tests, docs, or PR review confirmation).
`;
