import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { makeTempWorkspace } from '../helpers/workspace.mjs';

const { scanCanonEntries, generateIndexReadme } = await import(
  '../../dist/lib/canon-index-generator.js'
);

// ────────────────────────────────────────────────────────────────
// scanCanonEntries
// ────────────────────────────────────────────────────────────────

test('scanCanonEntries returns empty for nonexistent directory', () => {
  const entries = scanCanonEntries('/tmp/nonexistent-dir-xyz');
  assert.deepEqual(entries, []);
});

test('scanCanonEntries parses standard canon entry format', () => {
  const dir = makeTempWorkspace();
  fs.writeFileSync(
    path.join(dir, 'AX-001-authoritative-canon.md'),
    '# AX-001 Authoritative Canon\n\nStatus: Active\nCreated: 2026-02-02\nConfidence: verified\n',
  );
  fs.writeFileSync(
    path.join(dir, 'AX-002-separation.md'),
    '# AX-002 Separation of Code and Canon\n\nStatus: Active\nCreated: 2026-02-02\nConfidence: verified\n',
  );

  const entries = scanCanonEntries(dir);

  assert.equal(entries.length, 2);
  assert.equal(entries[0].id, 'AX-001');
  assert.equal(entries[0].title, 'Authoritative Canon');
  assert.equal(entries[0].confidence, 'verified');
  assert.equal(entries[0].status, 'Active');
  assert.equal(entries[0].fileName, 'AX-001-authoritative-canon.md');

  assert.equal(entries[1].id, 'AX-002');
  assert.equal(entries[1].title, 'Separation of Code and Canon');
});

test('scanCanonEntries skips README.md files', () => {
  const dir = makeTempWorkspace();
  fs.writeFileSync(path.join(dir, 'README.md'), '# Index\nSome content\n');
  fs.writeFileSync(
    path.join(dir, 'CN-001-naming.md'),
    '# CN-001 Canonical Naming\n\nStatus: Active\nConfidence: verified\n',
  );

  const entries = scanCanonEntries(dir);

  assert.equal(entries.length, 1);
  assert.equal(entries[0].id, 'CN-001');
});

test('scanCanonEntries sorts entries by ID', () => {
  const dir = makeTempWorkspace();
  fs.writeFileSync(
    path.join(dir, 'AP-003-unreviewed.md'),
    '# AP-003 Unreviewed Exceptions\n\nStatus: Active\nConfidence: verified\n',
  );
  fs.writeFileSync(
    path.join(dir, 'AP-001-architecture.md'),
    '# AP-001 Architecture Embedded Only in Code\n\nStatus: Active\nConfidence: verified\n',
  );
  fs.writeFileSync(
    path.join(dir, 'AP-002-implicit.md'),
    '# AP-002 Implicit Contracts\n\nStatus: Active\nConfidence: provisional\n',
  );

  const entries = scanCanonEntries(dir);

  assert.equal(entries[0].id, 'AP-001');
  assert.equal(entries[1].id, 'AP-002');
  assert.equal(entries[2].id, 'AP-003');
});

test('scanCanonEntries handles missing fields gracefully', () => {
  const dir = makeTempWorkspace();
  fs.writeFileSync(
    path.join(dir, 'AX-099-minimal.md'),
    '# AX-099 Minimal Entry\n\nSome content without status or confidence.\n',
  );

  const entries = scanCanonEntries(dir);

  assert.equal(entries.length, 1);
  assert.equal(entries[0].id, 'AX-099');
  assert.equal(entries[0].title, 'Minimal Entry');
  assert.equal(entries[0].confidence, 'unknown');
  assert.equal(entries[0].status, 'active');
});

test('scanCanonEntries handles ADR heading format with colon', () => {
  const dir = makeTempWorkspace();
  fs.writeFileSync(
    path.join(dir, 'ADR-006-collab.md'),
    '# ADR-006 Collab: AI-Assisted Development Platform\n\nStatus: Active\nConfidence: experimental\n',
  );

  const entries = scanCanonEntries(dir);

  assert.equal(entries.length, 1);
  assert.equal(entries[0].id, 'ADR-006');
  assert.equal(entries[0].title, 'Collab: AI-Assisted Development Platform');
  assert.equal(entries[0].confidence, 'experimental');
});

// ────────────────────────────────────────────────────────────────
// generateIndexReadme
// ────────────────────────────────────────────────────────────────

test('generateIndexReadme produces markdown table with entries', () => {
  const entries = [
    { id: 'AX-001', title: 'Auth Canon', confidence: 'verified', status: 'Active', fileName: 'AX-001-auth.md' },
    { id: 'AX-002', title: 'Separation', confidence: 'verified', status: 'Active', fileName: 'AX-002-sep.md' },
  ];

  const result = generateIndexReadme('Axioms', 'Invariants that MUST always hold.', entries);

  assert.ok(result.includes('# Axioms'));
  assert.ok(result.includes('> Invariants that MUST always hold.'));
  assert.ok(result.includes('| ID | Title | Confidence | Status |'));
  assert.ok(result.includes('| AX-001 | [Auth Canon](./AX-001-auth.md) | verified | Active |'));
  assert.ok(result.includes('| AX-002 | [Separation](./AX-002-sep.md) | verified | Active |'));
  assert.ok(result.includes('_2 entries indexed._'));
  assert.ok(result.includes('<!-- GENERATED: INDEX -->'));
});

test('generateIndexReadme handles empty entries with placeholder', () => {
  const result = generateIndexReadme('Conventions', 'No conventions yet.', []);

  assert.ok(result.includes('# Conventions'));
  assert.ok(result.includes('_No entries yet._'));
  assert.ok(result.includes('<!-- GENERATED: INDEX -->'));
  assert.ok(!result.includes('| ID |'));
});
