import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function makeTempWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'collab-cli-'));
}

/**
 * Creates a workspace directory with N child "repos" (directories with .git/).
 * Each repo gets a minimal package.json so repo-scanner can detect it.
 */
export function makeMultiRepoWorkspace(repoNames) {
  const workspace = makeTempWorkspace();
  for (const name of repoNames) {
    fs.mkdirSync(path.join(workspace, name, '.git'), { recursive: true });
    fs.writeFileSync(
      path.join(workspace, name, 'package.json'),
      JSON.stringify({ name, version: '1.0.0' }),
    );
  }
  return workspace;
}
