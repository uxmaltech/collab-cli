import { Command } from 'commander';

import { createCommandContext } from '../../lib/command-context';
import { runDockerCompose } from '../../lib/docker-compose';
import {
  parseComposePs,
  buildServiceStatusList,
  printStatusTable,
  type ContainerInfo,
} from '../../lib/docker-status';
import { checkHttpHealth } from '../../lib/health-checker';
import { ensureCommandAvailable, ensureFileExists } from '../../lib/preconditions';
import { loadRuntimeEnv } from '../../lib/service-health';
import { resolveMcpComposeFile } from './shared';

/** Fast health check options for status display (no retries). */
const QUICK_HEALTH_OPTIONS = { timeoutMs: 2_000, retries: 1, retryDelayMs: 0 };

const MCP_SERVICES = ['mcp'] as const;

interface McpCommandOptions {
  file?: string;
  outputDir?: string;
}

export function registerMcpStatusCommand(program: Command): void {
  program
    .command('status')
    .description('Show MCP runtime service status')
    .option('--file <path>', 'Compose file to use')
    .option('--output-dir <directory>', 'Directory used to locate generated compose files')
    .addHelpText(
      'after',
      `
Examples:
  collab mcp status
  collab mcp status --file docker-compose.mcp.yml
`,
    )
    .action(async (options: McpCommandOptions, command: Command) => {
      const context = createCommandContext(command);
      const selection = resolveMcpComposeFile(context.config, options.outputDir, options.file);

      ensureCommandAvailable('docker', { dryRun: context.executor.dryRun });
      if (!context.executor.dryRun) {
        ensureFileExists(selection.filePath, 'Compose file');
      }

      // Query container status via docker compose ps --format json
      const serviceScope = selection.source === 'consolidated' ? ['mcp'] : [];
      let containers: ContainerInfo[] = [];
      try {
        const result = runDockerCompose({
          executor: context.executor,
          files: [selection.filePath],
          arguments: ['ps', '--format', 'json', ...serviceScope],
          cwd: context.config.workspaceDir,
          projectName: context.config.compose.projectName,
          check: false,
        });
        containers = parseComposePs(result.stdout);
      } catch {
        // docker compose ps failed — treat as no running containers
      }

      // Run quick health check (skip in dry-run mode)
      const env = loadRuntimeEnv(context.config);
      const mcpHost = env['MCP_HOST'] || '127.0.0.1';
      const mcpPort = Number(env['MCP_PORT']) || 7337;

      const healthChecks = context.executor.dryRun
        ? []
        : await Promise.all([
            checkHttpHealth('mcp', `http://${mcpHost}:${mcpPort}/health`, QUICK_HEALTH_OPTIONS),
          ]);

      // Build and display status table
      const services = buildServiceStatusList([...MCP_SERVICES], containers, healthChecks);
      printStatusTable(context.logger, 'MCP Service', services, selection.filePath);
    });
}
