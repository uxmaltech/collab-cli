export const contractsReadme = `# Contracts

> API contracts, interfaces, and integration boundaries.

This directory documents the contracts between domains, services, and
external systems.

## Types of Contracts

- **Internal** — Interfaces between domains within the codebase.
- **External** — APIs exposed to or consumed from external systems.
- **Event** — Async message contracts (if applicable).

## Format

\`\`\`markdown
# Contract: <Name>

**Type:** internal | external | event
**Confidence:** HIGH | MEDIUM | LOW

## Parties

Who produces and who consumes this contract.

## Specification

The contract details (endpoints, message formats, interfaces).

## Guarantees

What invariants this contract maintains.
\`\`\`

<!-- AI-GENERATED: PLACEHOLDER -->
`;
