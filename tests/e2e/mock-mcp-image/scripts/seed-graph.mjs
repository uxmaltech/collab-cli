#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Mock seed-graph.mjs — stub for E2E tests when the real MCP image is not
// available. Simulates a successful graph-seeding run without any external
// dependencies (NebulaGraph, Qdrant, etc.).
// ---------------------------------------------------------------------------

console.log('  [mock] seed-graph.mjs — skipping real graph seeding in mock MCP image.');
console.log('  [mock] Graph seeding complete (no-op).');
process.exit(0);
