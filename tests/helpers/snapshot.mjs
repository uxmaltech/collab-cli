import assert from 'node:assert/strict';
import fs from 'node:fs';

function normalize(text) {
  return text.replace(/\r\n/g, '\n');
}

export function assertSnapshot(snapshotFile, actual) {
  if (!fs.existsSync(snapshotFile)) {
    throw new Error(`Snapshot file not found: ${snapshotFile}`);
  }

  const expected = fs.readFileSync(snapshotFile, 'utf8');
  assert.equal(normalize(actual), normalize(expected), `Snapshot mismatch for ${snapshotFile}`);
}
