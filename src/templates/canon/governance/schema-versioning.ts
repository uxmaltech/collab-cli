export const schemaVersioningTemplate = `# Schema Versioning

> Policy for versioning the canonical architecture schema.

## Version Format

The canonical schema follows semantic versioning: \`MAJOR.MINOR.PATCH\`

- **MAJOR** — Breaking changes to the directory structure or file formats.
- **MINOR** — New categories, fields, or optional sections added.
- **PATCH** — Clarifications, typo fixes, template updates.

## Current Version

\`1.0.0\`

## Compatibility

- Tools MUST check the schema version before processing canonical files.
- Older tools SHOULD gracefully handle unknown fields (ignore, don't fail).
- Migration guides live in \`evolution/upgrade-guide.md\`.
`;
