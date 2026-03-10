import fs from 'node:fs';
import path from 'node:path';

import { EXCLUDED_DIRS, MAX_FILE_SIZE_BYTES, SOURCE_EXTENSIONS } from './constants';

/**
 * Filters a list of relative file paths (e.g. from `git diff --name-only`)
 * to only include files suitable for AST/document ingestion.
 *
 * Applies the same criteria as `collectSourceFiles` in repo-ingest:
 * - Extension in SOURCE_EXTENSIONS or filename starts with "dockerfile"
 * - No path segment in EXCLUDED_DIRS
 * - File size <= MAX_FILE_SIZE_BYTES
 * - File must exist on disk
 */
export function filterChangedSourceFiles(cwd: string, files: string[]): string[] {
  const result: string[] = [];

  for (const file of files) {
    const segments = file.split(path.sep);
    if (segments.some((seg) => EXCLUDED_DIRS.has(seg))) continue;

    const basename = path.basename(file).toLowerCase();
    const ext = path.extname(file).toLowerCase();
    if (!SOURCE_EXTENSIONS.has(ext) && !basename.startsWith('dockerfile')) continue;

    const fullPath = path.join(cwd, file);
    try {
      const stat = fs.statSync(fullPath);
      if (stat.size > MAX_FILE_SIZE_BYTES) continue;
    } catch {
      continue; // file may have been deleted in a later commit
    }

    result.push(file);
  }

  return result;
}
