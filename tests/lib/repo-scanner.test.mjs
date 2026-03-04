import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { makeTempWorkspace } from '../helpers/workspace.mjs';

const { scanRepository } = await import('../../dist/lib/repo-scanner.js');

test('scanRepository detects TypeScript/Commander project', () => {
  const workspace = makeTempWorkspace();

  // Create a package.json with TypeScript + commander
  fs.writeFileSync(
    path.join(workspace, 'package.json'),
    JSON.stringify({
      name: 'test-cli',
      dependencies: { commander: '^11.0.0' },
      devDependencies: { typescript: '^5.0.0' },
    }),
  );

  // Create some source files
  fs.mkdirSync(path.join(workspace, 'src'), { recursive: true });
  fs.writeFileSync(path.join(workspace, 'src', 'index.ts'), 'console.log("hello");');
  fs.writeFileSync(path.join(workspace, 'src', 'main.ts'), 'export {};');

  const ctx = scanRepository(workspace);

  assert.equal(ctx.name, path.basename(workspace));
  assert.equal(ctx.language, 'TypeScript');
  assert.equal(ctx.framework, 'CLI (Commander)');
  assert.ok(ctx.dependencies.includes('commander'));
  assert.ok(ctx.dependencies.includes('typescript'));
  assert.ok(ctx.totalSourceFiles >= 2);
  assert.ok(ctx.keyFiles.includes('package.json'));
});

test('scanRepository respects exclusions', () => {
  const workspace = makeTempWorkspace();

  fs.writeFileSync(
    path.join(workspace, 'package.json'),
    JSON.stringify({ name: 'test', dependencies: {} }),
  );

  // Create excluded dirs
  fs.mkdirSync(path.join(workspace, 'node_modules', 'dep'), { recursive: true });
  fs.writeFileSync(path.join(workspace, 'node_modules', 'dep', 'index.js'), '');

  fs.mkdirSync(path.join(workspace, 'src'), { recursive: true });
  fs.writeFileSync(path.join(workspace, 'src', 'app.ts'), '');

  const ctx = scanRepository(workspace);

  // node_modules should be excluded
  assert.ok(!ctx.structure.includes('node_modules'), 'node_modules should be excluded');
  assert.ok(ctx.structure.includes('src/'), 'src/ should be included');
});

test('scanRepository respects token budget', () => {
  const workspace = makeTempWorkspace();

  fs.writeFileSync(
    path.join(workspace, 'package.json'),
    JSON.stringify({ name: 'test', dependencies: {} }),
  );

  // Create many directories to generate a large structure
  for (let i = 0; i < 50; i++) {
    const dir = path.join(workspace, `dir-${i.toString().padStart(3, '0')}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'file.ts'), '');
  }

  const ctx = scanRepository(workspace, { budgetChars: 200 });
  assert.ok(ctx.structure.length <= 220, 'structure should respect budget');
  assert.ok(ctx.structure.includes('(truncated)'), 'truncated structure should have marker');
});

test('scanRepository handles empty workspace', () => {
  const workspace = makeTempWorkspace();

  const ctx = scanRepository(workspace);

  assert.equal(ctx.language, 'Unknown');
  assert.equal(ctx.framework, null);
  assert.equal(ctx.dependencies.length, 0);
  assert.equal(ctx.totalSourceFiles, 0);
});
