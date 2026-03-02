import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function collectTestFiles(directory) {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...collectTestFiles(fullPath));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.test.mjs')) {
      files.push(fullPath);
    }
  }

  return files;
}

const testsDirectory = path.resolve(process.cwd(), 'tests');

if (!fs.existsSync(testsDirectory)) {
  console.error(`Tests directory not found: ${testsDirectory}`);
  process.exit(1);
}

const testFiles = collectTestFiles(testsDirectory).sort();

if (testFiles.length === 0) {
  console.error('No test files were discovered under tests/*.test.mjs');
  process.exit(1);
}

const result = spawnSync(process.execPath, ['--test', ...testFiles], {
  stdio: 'inherit',
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
