import fs from 'node:fs';

import { CliError } from '../errors';
import type { Executor } from '../executor';
import type { GeneratedFile } from './types';

export interface WriteAgentBootstrapOptions {
  overwriteExistingManagedFiles: boolean;
}

export function writeAgentBootstrapFiles(
  executor: Executor,
  files: readonly GeneratedFile[],
  options: WriteAgentBootstrapOptions,
): void {
  const existingFiles = files.filter((file) => fs.existsSync(file.absolutePath));

  if (existingFiles.length > 0 && !options.overwriteExistingManagedFiles) {
    throw new CliError(
      `Refusing to overwrite existing bootstrap files: ${existingFiles
        .map((file) => file.relativePath)
        .join(', ')}. Re-run with --force overwrite or --force rebirth to overwrite.`,
    );
  }

  for (const file of files) {
    executor.writeFile(file.absolutePath, file.content, {
      description: file.description,
    });
  }
}
