import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runCli } from '../helpers/cli.mjs';

test('collab ci ast-delta --help shows description and options', () => {
  const result = runCli(['ci', 'ast-delta', '--help']);

  assert.equal(result.status, 0);
  assert.ok(
    result.stdout.includes('Extract AST from files changed'),
    'should show command description',
  );
  assert.ok(
    result.stdout.includes('--base'),
    'should list --base option',
  );
});

test('collab ci --help lists ast-delta subcommand', () => {
  const result = runCli(['ci', '--help']);

  assert.equal(result.status, 0);
  assert.ok(
    result.stdout.includes('ast-delta'),
    'should list ast-delta subcommand',
  );
});

test('collab --help lists ci command', () => {
  const result = runCli(['--help']);

  assert.equal(result.status, 0);
  assert.ok(
    result.stdout.includes('ci'),
    'should list ci command',
  );
});

// ── writeImpactComment ────────────────────────────────────────

test('writeImpactComment writes markdown when AST_IMPACT_FILE is set', async () => {
  const { writeImpactComment } = await import('../../dist/commands/ci/ast-delta.js');
  const tmpFile = path.join(os.tmpdir(), `impact-test-${Date.now()}.md`);
  process.env.AST_IMPACT_FILE = tmpFile;

  try {
    writeImpactComment({
      nodes: [
        { id: 'repo::ns::MyClass', tag: 'Class', properties: { name: 'MyClass', path: 'src/my-class.ts' }, content: '' },
      ],
      edges: [
        { from: 'repo::ns::MyClass', to: 'repo::ns::BaseClass', type: 'EXTENDS', properties: {} },
      ],
    });

    const content = fs.readFileSync(tmpFile, 'utf8');
    assert.ok(content.includes('## Architecture Impact'), 'should have impact header');
    assert.ok(content.includes('MyClass'), 'should list node name');
    assert.ok(content.includes('EXTENDS'), 'should list edge type');
    assert.ok(content.includes('src/my-class.ts'), 'should list file path');
    assert.ok(content.includes('Files affected'), 'should have files affected section');
  } finally {
    delete process.env.AST_IMPACT_FILE;
    try { fs.unlinkSync(tmpFile); } catch { /* noop */ }
  }
});

test('writeImpactComment skips when no nodes or edges', async () => {
  const { writeImpactComment } = await import('../../dist/commands/ci/ast-delta.js');
  const tmpFile = path.join(os.tmpdir(), `impact-skip-${Date.now()}.md`);
  process.env.AST_IMPACT_FILE = tmpFile;

  try {
    writeImpactComment({ nodes: [], edges: [] });
    assert.ok(!fs.existsSync(tmpFile), 'should not create file when no data');
  } finally {
    delete process.env.AST_IMPACT_FILE;
  }
});

test('writeImpactComment skips when env var not set', async () => {
  const { writeImpactComment } = await import('../../dist/commands/ci/ast-delta.js');
  delete process.env.AST_IMPACT_FILE;

  // Should not throw
  writeImpactComment({
    nodes: [{ id: 'x', tag: 'Class', properties: { name: 'X' }, content: '' }],
    edges: [],
  });
});
