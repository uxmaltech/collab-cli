export const reviewProcessTemplate = `# Review Process

> How changes to the canonical architecture are reviewed and approved.

## Review Criteria

All changes to \`docs/architecture/\` MUST be reviewed for:

1. **Accuracy** — Does the entry reflect the actual codebase?
2. **Completeness** — Are all relevant aspects covered?
3. **Consistency** — Does it follow the established formats (ID schemes,
   confidence levels)?
4. **Non-duplication** — Is it truly new knowledge, not a restatement?

## Reviewers

- Architecture changes SHOULD be reviewed by at least one developer
  familiar with the affected domain.
- AI-generated entries MUST be reviewed by a human before merge.

## Merge Policy

- All canonical changes go through standard PR review.
- Auto-generated entries include an \`<!-- AI-GENERATED -->\` marker.
- Reviewers should focus on verifying accuracy, not style.
`;
