import type { CollabConfig } from '../../lib/config';
import { parseInfraType, validateMcpUrl } from '../../lib/infra-type';
import { parseMode } from '../../lib/mode';
import type { Logger } from '../../lib/logger';
import { promptChoice } from '../../lib/prompt';

import type { InitOptions, WizardSelection } from './types';
import { parseComposeMode } from './helpers';
import { validateMcpServerContract } from './mcp-helpers';

export async function resolveWizardSelection(
  options: InitOptions,
  config: CollabConfig,
  logger: Logger,
  dryRun: boolean,
): Promise<WizardSelection> {
  const defaults: WizardSelection = {
    mode: parseMode(options.mode, 'file-only'),
    composeMode: parseComposeMode(options.composeMode, 'consolidated'),
    infraType: parseInfraType(options.infraType, 'local'),
  };

  // --yes: accept defaults
  if (options.yes) {
    const mode = options.mode ? parseMode(options.mode) : 'file-only';

    if (!options.mode) {
      logger.warn('No --mode specified with --yes; defaults to file-only.');
    }

    const infraType = options.infraType
      ? parseInfraType(options.infraType)
      : 'local';

    const mcpUrl = options.mcpUrl
      ? validateMcpUrl(options.mcpUrl)
      : undefined;

    if (mcpUrl) {
      await validateMcpServerContract(mcpUrl, logger, dryRun);
    }

    return {
      mode,
      composeMode: options.composeMode ? parseComposeMode(options.composeMode) : 'consolidated',
      infraType,
      mcpUrl,
    };
  }

  // Interactive: prompt for each selection
  const mode = options.mode
    ? parseMode(options.mode)
    : await promptChoice(
        'Select setup mode:',
        [
          { value: 'file-only', label: 'file-only (architecture files only, no infrastructure)' },
          { value: 'indexed', label: 'indexed (full infrastructure with Docker + MCP)' },
        ],
        defaults.mode,
      );

  let infraType = defaults.infraType;
  let mcpUrl = options.mcpUrl;

  if (mode === 'indexed') {
    infraType = options.infraType
      ? parseInfraType(options.infraType)
      : await promptChoice(
          'Infrastructure type:',
          [
            { value: 'local', label: 'local (Docker-based, local MCP)' },
            { value: 'remote', label: 'remote (connect to existing MCP server)' },
          ],
          'local',
        );

    if (infraType === 'remote') {
      mcpUrl = options.mcpUrl
        ? validateMcpUrl(options.mcpUrl)
        : validateMcpUrl(
            await promptChoice('MCP server base URL:', [{ value: 'http://127.0.0.1:7337', label: 'http://127.0.0.1:7337' }], 'http://127.0.0.1:7337'),
          );
    }

    if (mcpUrl) {
      await validateMcpServerContract(mcpUrl, logger, dryRun);
    }
  }

  // Skip compose-mode prompt when mode is file-only or infra is remote —
  // compose generation is N/A in those flows.
  const composeMode = mode === 'file-only' || infraType === 'remote'
    ? options.composeMode ? parseComposeMode(options.composeMode, 'consolidated') : 'consolidated'
    : options.composeMode
      ? parseComposeMode(options.composeMode)
      : await promptChoice(
          'Select compose generation mode:',
          [
            { value: 'consolidated', label: 'consolidated (single compose file)' },
            { value: 'split', label: 'split (separate infra + MCP files)' },
          ],
          'consolidated',
        );

  return { mode, composeMode, infraType, mcpUrl };
}
