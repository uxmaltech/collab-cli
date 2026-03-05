import { Command } from 'commander';

import { createCommandContext } from '../../lib/command-context';
import { runDockerCompose } from '../../lib/docker-compose';
import {
  parseComposePs,
  buildServiceStatusList,
  printStatusTable,
  type ContainerInfo,
} from '../../lib/docker-status';
import { checkHttpHealth, checkTcpHealth } from '../../lib/health-checker';
import { ensureCommandAvailable, ensureFileExists } from '../../lib/preconditions';
import { loadRuntimeEnv } from '../../lib/service-health';
import { resolveInfraComposeFile, INFRA_SERVICES } from './shared';

/** Fast health check options for status display (no retries). */
const QUICK_HEALTH_OPTIONS = { timeoutMs: 2_000, retries: 1, retryDelayMs: 0 };

interface InfraCommandOptions {
  file?: string;
  outputDir?: string;
}

export function registerInfraStatusCommand(program: Command): void {
  program
    .command('status')
    .description('Show infrastructure service status')
    .option('--file <path>', 'Compose file to use')
    .option('--output-dir <directory>', 'Directory used to locate generated compose files')
    .addHelpText(
      'after',
      `
Examples:
  collab infra status
  collab infra status --file docker-compose.infra.yml
`,
    )
    .action(async (options: InfraCommandOptions, command: Command) => {
      const context = createCommandContext(command);
      const selection = resolveInfraComposeFile(context.config, options.outputDir, options.file);

      ensureCommandAvailable('docker', { dryRun: context.executor.dryRun });
      if (!context.executor.dryRun) {
        ensureFileExists(selection.filePath, 'Compose file');
      }

      // Query container status via docker compose ps --format json
      const serviceScope = selection.source === 'consolidated' ? [...INFRA_SERVICES] : [];
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

      // Run quick health checks (skip in dry-run mode)
      const env = loadRuntimeEnv(context.config);
      const qdrantHost = env['QDRANT_HOST'] || '127.0.0.1';
      const qdrantPort = Number(env['QDRANT_PORT']) || 6333;
      const nebulaHost = env['NEBULA_HOST'] || '127.0.0.1';
      const nebulaPort = Number(env['NEBULA_GRAPHD_PORT']) || 9669;

      const healthChecks = context.executor.dryRun
        ? []
        : await Promise.all([
            checkHttpHealth('qdrant', `http://${qdrantHost}:${qdrantPort}/collections`, QUICK_HEALTH_OPTIONS),
            checkTcpHealth('graphd', nebulaHost, nebulaPort, QUICK_HEALTH_OPTIONS),
          ]);

      // Build and display status table
      const services = buildServiceStatusList([...INFRA_SERVICES], containers, healthChecks);
      printStatusTable(context.logger, 'Infrastructure Services', services, selection.filePath);
    });
}
