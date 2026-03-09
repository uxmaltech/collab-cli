import fs from 'node:fs';
import path from 'node:path';

import type { CollabConfig } from '../../lib/config';
import type { ComposeMode } from '../../lib/compose-paths';
import { CliError } from '../../lib/errors';

export function parseComposeMode(value: string | undefined, fallback: ComposeMode = 'consolidated'): ComposeMode {
  if (!value) {
    return fallback;
  }

  if (value === 'consolidated' || value === 'split') {
    return value;
  }

  throw new CliError(`Invalid compose mode '${value}'. Use 'consolidated' or 'split'.`);
}

export function inferComposeMode(config: CollabConfig): ComposeMode {
  const infraPath = path.resolve(config.workspaceDir, config.compose.infraFile);
  const mcpPath = path.resolve(config.workspaceDir, config.compose.mcpFile);

  if (fs.existsSync(infraPath) && fs.existsSync(mcpPath)) {
    return 'split';
  }

  return 'consolidated';
}
