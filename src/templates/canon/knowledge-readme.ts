export const knowledgeAxiomsReadme = `# Axioms

> Invariants that MUST always hold in this codebase.

Axioms use the ID format \`AX-NNN\` and represent fundamental truths about
the system that should never be violated.

## Format

Each axiom file follows this structure:

\`\`\`markdown
# AX-NNN: Short Title

**Confidence:** HIGH | MEDIUM | LOW
**Verified:** YYYY-MM-DD

## Statement

One-sentence invariant.

## Rationale

Why this axiom exists.

## Verification

How to confirm this axiom holds.
\`\`\`

<!-- AI-GENERATED: PLACEHOLDER -->
`;

export const knowledgeDecisionsReadme = `# Architectural Decisions

> ADRs documenting key architectural choices.

Decisions use the ID format \`ADR-NNN\` and follow a lightweight ADR format.

## Format

Each decision file follows this structure:

\`\`\`markdown
# ADR-NNN: Short Title

**Status:** Proposed | Accepted | Deprecated | Superseded
**Date:** YYYY-MM-DD
**Confidence:** HIGH | MEDIUM | LOW

## Context

What prompted this decision.

## Decision

What was decided.

## Consequences

What follows from this decision.
\`\`\`

<!-- AI-GENERATED: PLACEHOLDER -->
`;

export const knowledgeConventionsReadme = `# Conventions

> Coding and design conventions followed in this codebase.

Conventions use the ID format \`CN-NNN\`.

## Format

Each convention file follows this structure:

\`\`\`markdown
# CN-NNN: Short Title

**Confidence:** HIGH | MEDIUM | LOW
**Scope:** project | module | file

## Convention

What the convention is.

## Examples

Code examples demonstrating the convention.

## Rationale

Why this convention exists.
\`\`\`

<!-- AI-GENERATED: PLACEHOLDER -->
`;

export const knowledgeAntiPatternsReadme = `# Anti-Patterns

> Known pitfalls and patterns to avoid in this codebase.

Anti-patterns use the ID format \`AP-NNN\`.

## Format

Each anti-pattern file follows this structure:

\`\`\`markdown
# AP-NNN: Short Title

**Confidence:** HIGH | MEDIUM | LOW
**Severity:** critical | warning | info

## Problem

What the anti-pattern looks like.

## Why It's Harmful

Why this pattern should be avoided.

## Alternative

The preferred approach.
\`\`\`

<!-- AI-GENERATED: PLACEHOLDER -->
`;
