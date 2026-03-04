#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Mock ingest-v2.mjs — stub for E2E tests when the real MCP image is not
// available. Simulates a successful canon ingestion without Qdrant or Nebula.
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const filesIdx = args.indexOf('--files');
const files = filesIdx >= 0 ? args.slice(filesIdx + 1) : [];

console.log(`  [mock] ingest-v2.mjs — received ${files.length} file(s) to ingest.`);
console.log('  [mock] Canon ingestion complete (no-op).');
process.exit(0);
