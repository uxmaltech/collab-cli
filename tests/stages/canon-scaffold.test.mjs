import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { runCli } from '../helpers/cli.mjs';
import { createFakeDockerEnv } from '../helpers/fake-docker.mjs';
import { makeTempWorkspace } from '../helpers/workspace.mjs';

test('canon-scaffold stage creates architecture structure', () => {
  const workspace = makeTempWorkspace();
  const env = createFakeDockerEnv();

  const result = runCli(
    ['--cwd', workspace, 'init', '--yes', '--mode', 'file-only'],
    { cwd: workspace, env },
  );

  assert.equal(result.status, 0, `CLI failed: ${result.stderr}`);
  assert.ok(
    result.stdout.includes('Canon scaffold'),
    'output should mention canon scaffold',
  );

  const archDir = path.join(workspace, 'docs', 'architecture');

  // Governance files
  const governanceFiles = [
    'governance/what-enters-the-canon.md',
    'governance/implementation-process.md',
    'governance/schema-versioning.md',
    'governance/confidence-levels.md',
    'governance/review-process.md',
  ];

  for (const file of governanceFiles) {
    const full = path.join(archDir, file);
    assert.ok(fs.existsSync(full), `governance file missing: ${file}`);
    const content = fs.readFileSync(full, 'utf8');
    assert.ok(content.length > 50, `governance file is too short: ${file}`);
  }

  // Knowledge READMEs
  const knowledgeDirs = ['axioms', 'decisions', 'conventions', 'anti-patterns'];
  for (const dir of knowledgeDirs) {
    const readme = path.join(archDir, 'knowledge', dir, 'README.md');
    assert.ok(fs.existsSync(readme), `knowledge README missing: ${dir}/README.md`);
  }

  // Domains README
  assert.ok(fs.existsSync(path.join(archDir, 'domains', 'README.md')), 'domains/README.md missing');

  // Contracts README
  assert.ok(fs.existsSync(path.join(archDir, 'contracts', 'README.md')), 'contracts/README.md missing');

  // Evolution files
  const evolutionFiles = ['changelog.md', 'upgrade-guide.md', 'deprecated.md'];
  for (const file of evolutionFiles) {
    assert.ok(
      fs.existsSync(path.join(archDir, 'evolution', file)),
      `evolution file missing: ${file}`,
    );
  }
});

test('canon-scaffold does not overwrite existing files', () => {
  const workspace = makeTempWorkspace();
  const env = createFakeDockerEnv();
  const archDir = path.join(workspace, 'docs', 'architecture');

  // Create a governance file with custom content before running init
  fs.mkdirSync(path.join(archDir, 'governance'), { recursive: true });
  const customContent = '# Custom governance content\n';
  fs.writeFileSync(path.join(archDir, 'governance', 'what-enters-the-canon.md'), customContent);

  const result = runCli(
    ['--cwd', workspace, 'init', '--yes', '--mode', 'file-only'],
    { cwd: workspace, env },
  );

  assert.equal(result.status, 0, `CLI failed: ${result.stderr}`);

  // Existing file should NOT be overwritten
  const existing = fs.readFileSync(
    path.join(archDir, 'governance', 'what-enters-the-canon.md'),
    'utf8',
  );
  assert.equal(existing, customContent, 'existing file should be preserved');

  // Other files should still be created
  assert.ok(
    fs.existsSync(path.join(archDir, 'governance', 'review-process.md')),
    'new files should still be created',
  );
});

test('canon-scaffold works in dry-run mode', () => {
  const workspace = makeTempWorkspace();
  const env = createFakeDockerEnv();

  const result = runCli(
    ['--cwd', workspace, '--dry-run', 'init', '--yes', '--mode', 'file-only'],
    { cwd: workspace, env },
  );

  assert.equal(result.status, 0, `CLI failed: ${result.stderr}`);
  assert.ok(
    result.stdout.includes('scaffold governance/what-enters-the-canon.md'),
    'dry-run should mention scaffold files',
  );

  // No files should be created in dry-run
  const archDir = path.join(workspace, 'docs', 'architecture');
  assert.ok(!fs.existsSync(archDir), 'no architecture directory should exist in dry-run');
});

test('canon-scaffold stage also runs in indexed mode', () => {
  const workspace = makeTempWorkspace();
  const env = createFakeDockerEnv();

  const result = runCli(
    ['--cwd', workspace, '--dry-run', 'init', '--yes', '--mode', 'indexed'],
    { cwd: workspace, env },
  );

  assert.equal(result.status, 0, `CLI failed: ${result.stderr}`);
  assert.ok(
    result.stdout.includes('Canon scaffold') || result.stdout.includes('scaffold governance'),
    'canon-scaffold should run in indexed mode too',
  );
});

test('canon-ingest skips in file-only mode', () => {
  const workspace = makeTempWorkspace();
  const env = createFakeDockerEnv();

  const result = runCli(
    ['--cwd', workspace, '--dry-run', 'init', '--yes', '--mode', 'file-only'],
    { cwd: workspace, env },
  );

  assert.equal(result.status, 0, `CLI failed: ${result.stderr}`);
  assert.ok(
    result.stdout.includes('skipping canon ingestion'),
    'canon-ingest should be skipped in file-only mode',
  );
});
