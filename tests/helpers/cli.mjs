import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const binary = path.resolve(__dirname, '../../bin/collab');

export function runCli(args, options = {}) {
  return spawnSync(binary, args, {
    encoding: 'utf8',
    ...options,
  });
}
