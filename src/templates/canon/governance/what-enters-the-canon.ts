export const whatEntersTheCanonTemplate = `# What Enters the Canon

> This document defines the governance rules for the canonical architecture
> documentation of this repository.

## Purpose

The **canon** is the single source of truth for architecture knowledge.
Every statement that lives here MUST be verifiable against the actual codebase.

## Entry Criteria

A piece of knowledge enters the canon when it meets ALL of the following:

1. **Verifiable** — It can be confirmed by inspecting the source code.
2. **Stable** — It reflects a deliberate decision, not an accident or WIP.
3. **Impactful** — It affects how developers reason about or extend the system.

## Categories

| Category | ID Format | Description |
|----------|-----------|-------------|
| Axioms | AX-NNN | Invariants that MUST always hold |
| Decisions | ADR-NNN | Architecture Decision Records |
| Conventions | CN-NNN | Coding and design conventions |
| Anti-patterns | AP-NNN | Known pitfalls to avoid |

## Confidence Levels

Each entry carries a confidence level:

- **HIGH** — Verified by multiple signals (code, tests, docs).
- **MEDIUM** — Verified by at least one signal.
- **LOW** — Inferred, pending verification.

## Lifecycle

1. **Proposed** — Entry drafted (manually or by AI analysis).
2. **Accepted** — Reviewed and merged via PR.
3. **Deprecated** — Superseded; moved to \`evolution/deprecated.md\`.
`;
