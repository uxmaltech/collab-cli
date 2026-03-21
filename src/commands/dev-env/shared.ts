import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { loadBornAgents, resolveBornAgentRootDir } from '../../lib/agent-registry';
import { generateComposeFiles } from '../../lib/compose-renderer';
import { fileExists, getComposeFilePaths } from '../../lib/compose-paths';
import type { CollabConfig } from '../../lib/config';
import { loadCollabConfig } from '../../lib/config';
import { runDockerCompose } from '../../lib/docker-compose';
import { CliError } from '../../lib/errors';
import type { Executor } from '../../lib/executor';
import type { Logger } from '../../lib/logger';
import { ensureCommandAvailable, ensureFileExists } from '../../lib/preconditions';
import {
  dryRunHealthOptions,
  loadRuntimeEnv,
  logServiceHealth,
  waitForInfraHealth,
  waitForMcpHealth,
  type ServiceHealthOptions,
} from '../../lib/service-health';
import { startSpinner } from '../../lib/spinner';
import { resolveInfraComposeFile } from '../infra/shared';
import { resolveMcpComposeFile } from '../mcp/shared';

const ARCHITECTURE_MCP_REPO = 'collab-architecture-mcp';
const ARCHITECTURE_MCP_CLONE_URL = 'https://github.com/uxmaltech/collab-architecture-mcp.git';
const DEV_ARCHITECTURE_MCP_IMAGE = 'collab-architecture-mcp:dev';

export interface DevEnvStartOptions {
  outputDir?: string;
  infraFile?: string;
  mcpFile?: string;
  sourceArchitectureMcp?: string;
  timeoutMs?: string;
  retries?: string;
  retryDelayMs?: string;
}

export interface PreparedDevEnv {
  readonly workspaceDir: string;
  readonly infraFile: string;
  readonly sourceMcpFile: string;
  readonly mcpFile: string;
  readonly dockerfile: string;
  readonly architectureMcpSource: string;
  readonly architectureMcpImage: string;
}

function hasLocalWorkspaceConfig(config: CollabConfig): boolean {
  return fs.existsSync(config.configFile);
}

export function resolveDevEnvConfig(
  logger: Logger,
  controlConfig: CollabConfig,
): CollabConfig {
  if (hasLocalWorkspaceConfig(controlConfig)) {
    return controlConfig;
  }

  const agents = loadBornAgents(controlConfig.workspaceDir);
  if (agents.length === 1) {
    const agentRootDir = resolveBornAgentRootDir(controlConfig.workspaceDir, agents[0]);
    logger.info(`Using born agent workspace for dev-env: ${agentRootDir}`);
    return loadCollabConfig(agentRootDir);
  }

  if (agents.length > 1) {
    throw new CliError(
      `No local .collab/config.json was found in ${controlConfig.workspaceDir}, and multiple born agents exist there. Re-run from the target agent root or use --cwd on that agent directory.`,
    );
  }

  return controlConfig;
}

function ensureBaseComposeFiles(
  logger: Logger,
  executor: Executor,
  config: CollabConfig,
  outputDirectory: string | undefined,
): boolean {
  const composePaths = getComposeFilePaths(config, outputDirectory);
  const missingCompose =
    !fileExists(composePaths.infra)
    || !fileExists(composePaths.mcp);

  if (!missingCompose) {
    return false;
  }

  logger.info(`Generating split compose files in ${config.workspaceDir} for dev-env start`);
  generateComposeFiles({
    config,
    logger,
    executor,
    mode: 'split',
    outputDirectory,
  });
  return true;
}

function candidateSourceRoots(): string[] {
  const home = os.homedir();
  return [
    path.join(home, 'Documents', 'Github'),
    path.join(home, 'Documents', 'GitHub'),
    path.join(home, 'Github'),
    path.join(home, 'GitHub'),
  ];
}

function findLocalCheckout(repoName: string): string | undefined {
  for (const root of candidateSourceRoots()) {
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
      continue;
    }

    for (const ownerEntry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!ownerEntry.isDirectory()) {
        continue;
      }

      const candidate = path.join(root, ownerEntry.name, repoName);
      if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
        return candidate;
      }
    }
  }

  return undefined;
}

function assertDockerfile(sourceDir: string): void {
  const dockerfilePath = path.join(sourceDir, 'Dockerfile');
  if (!fs.existsSync(dockerfilePath)) {
    throw new CliError(
      `The local MCP source at ${sourceDir} does not contain a Dockerfile.`,
    );
  }
}

export function resolveArchitectureMcpSource(
  logger: Logger,
  executor: Executor,
  workspaceDir: string,
  collabDir: string,
  explicitSource: string | undefined,
): string {
  const managedSourceDir = path.join(
    collabDir,
    'dev-env',
    'sources',
    ARCHITECTURE_MCP_REPO,
  );
  const requestedSource = explicitSource
    ? path.resolve(workspaceDir, explicitSource)
    : undefined;

  if (requestedSource) {
    if (!fs.existsSync(requestedSource)) {
      throw new CliError(
        `The requested MCP source directory does not exist: ${requestedSource}`,
      );
    }
    assertDockerfile(requestedSource);
    logger.info(`Using explicit collab-architecture-mcp source: ${requestedSource}`);
    return requestedSource;
  }

  const localCheckout = findLocalCheckout(ARCHITECTURE_MCP_REPO);
  if (localCheckout) {
    assertDockerfile(localCheckout);
    logger.info(`Using local collab-architecture-mcp checkout: ${localCheckout}`);
    return localCheckout;
  }

  if (fs.existsSync(managedSourceDir)) {
    assertDockerfile(managedSourceDir);
    logger.info(`Using managed collab-architecture-mcp checkout: ${managedSourceDir}`);
    return managedSourceDir;
  }

  ensureCommandAvailable('git', { dryRun: executor.dryRun });
  executor.ensureDirectory(path.dirname(managedSourceDir));
  logger.info(`Cloning collab-architecture-mcp into ${managedSourceDir}`);
  executor.run(
    'git',
    ['clone', ARCHITECTURE_MCP_CLONE_URL, managedSourceDir],
    { cwd: workspaceDir },
  );

  if (!executor.dryRun) {
    assertDockerfile(managedSourceDir);
  }

  return managedSourceDir;
}

function yamlQuote(value: string): string {
  return JSON.stringify(value);
}

export function renderArchitectureMcpDockerfile(): string {
  return [
    'FROM node:23-bookworm-slim AS deps',
    '',
    'WORKDIR /app',
    'ENV CXXFLAGS=-std=gnu++20',
    '',
    'RUN apt-get update \\',
    '  && apt-get install -y --no-install-recommends python3 make g++ \\',
    '  && rm -rf /var/lib/apt/lists/*',
    '',
    'COPY package*.json ./',
    'RUN npm install --omit=dev --package-lock=false',
    '',
    'FROM node:23-bookworm-slim AS runner',
    '',
    'WORKDIR /app',
    'ENV NODE_ENV=production',
    '',
    'COPY --from=deps /app/node_modules ./node_modules',
    'COPY . .',
    'RUN set -eu; \\',
    '  for mapping in \\',
    '    "context-scopes-list.mjs:architecture-scopes-list.mjs" \\',
    '    "context-vector-search.mjs:architecture-vector-search.mjs" \\',
    '    "context-graph-degree-search.mjs:architecture-graph-degree-search.mjs" \\',
    '    "context-file-read.mjs:architecture-file-read.mjs" \\',
    '    "context-files-list.mjs:architecture-files-list.mjs" \\',
    '    "context-grep.mjs:architecture-grep.mjs"; do \\',
    '    alias_name="${mapping%%:*}"; \\',
    '    source_name="${mapping##*:}"; \\',
    '    if [ ! -e "tools/${alias_name}" ] && [ -e "tools/${source_name}" ]; then \\',
    '      ln -s "${source_name}" "tools/${alias_name}"; \\',
    '    fi; \\',
    '  done',
    '',
    'EXPOSE 7337',
    '',
    'CMD ["node", "server.mjs"]',
    '',
  ].join('\n');
}

export function renderDevelopmentMcpCompose(
  envFilePath: string,
  imageName: string,
): string {
  return [
    'services:',
    '  cognitive-mcp:',
    `    image: ${yamlQuote(imageName)}`,
    '    pull_policy: never',
    '    env_file:',
    `      - ${yamlQuote(envFilePath)}`,
    '    environment:',
    '      MCP_ENV: "local"',
    '      MCP_HOST: "0.0.0.0"',
    '      MCP_PORT: "7337"',
    '      REDIS_URL: ${REDIS_URL:-redis://:${REDIS_PASSWORD:-collab-dev-redis}@redis:6379}',
    '      QDRANT_URL: http://qdrant:6333',
    '      QDRANT_API_KEY: ""',
    '      NEBULA_GRAPHD_ADDRESS: nebula-graphd:9669',
    '      NEBULA_USERNAME: root',
    '      NEBULA_PASSWORD: nebula',
    '      MINIO_ENDPOINT: http://minio:9000',
    '      MINIO_ACCESS_KEY: collabminio',
    '      MINIO_SECRET_KEY: collabminiosecret',
    '      MINIO_BUCKET: collab',
    '      COGNITIVE_MCP_API_KEY: ${COGNITIVE_MCP_API_KEY:-}',
    '    ports:',
    '      - "${COGNITIVE_MCP_PORT:-8787}:7337"',
    '    depends_on:',
    '      - redis',
    '      - qdrant',
    '      - minio',
    '      - nebula-graphd',
    '',
  ].join('\n');
}

export function prepareDevEnv(
  logger: Logger,
  executor: Executor,
  config: CollabConfig,
  options: DevEnvStartOptions,
): PreparedDevEnv {
  const generatedSplitCompose = ensureBaseComposeFiles(logger, executor, config, options.outputDir);
  const composePaths = getComposeFilePaths(config, options.outputDir);
  const infraSelection = generatedSplitCompose && !options.infraFile
    ? { filePath: composePaths.infra, source: 'split' as const }
    : resolveInfraComposeFile(config, options.outputDir, options.infraFile);
  const mcpSelection = generatedSplitCompose && !options.mcpFile
    ? { filePath: composePaths.mcp, source: 'split' as const }
    : resolveMcpComposeFile(config, options.outputDir, options.mcpFile);
  const architectureMcpSource = resolveArchitectureMcpSource(
    logger,
    executor,
    config.workspaceDir,
    config.collabDir,
    options.sourceArchitectureMcp,
  );
  const dockerfile = path.join(
    config.collabDir,
    'dev-env',
    'Dockerfile.architecture-mcp',
  );
  const mcpFile = path.join(
    config.collabDir,
    'dev-env',
    'docker-compose.mcp.generated.yml',
  );

  executor.writeFile(
    dockerfile,
    renderArchitectureMcpDockerfile(),
    { description: 'write dev-env MCP Dockerfile' },
  );
  executor.writeFile(
    mcpFile,
    renderDevelopmentMcpCompose(config.envFile, DEV_ARCHITECTURE_MCP_IMAGE),
    { description: 'write dev-env MCP compose file' },
  );

  return {
    workspaceDir: config.workspaceDir,
    infraFile: infraSelection.filePath,
    sourceMcpFile: mcpSelection.filePath,
    mcpFile,
    dockerfile,
    architectureMcpSource,
    architectureMcpImage: DEV_ARCHITECTURE_MCP_IMAGE,
  };
}

export async function startDevEnv(
  logger: Logger,
  executor: Executor,
  config: CollabConfig,
  prepared: PreparedDevEnv,
  health: ServiceHealthOptions,
): Promise<void> {
  ensureCommandAvailable('docker', { dryRun: executor.dryRun });
  if (!executor.dryRun) {
    ensureFileExists(prepared.infraFile, 'Infrastructure compose file');
    ensureFileExists(prepared.sourceMcpFile, 'Source MCP compose file');
    ensureFileExists(prepared.mcpFile, 'Generated dev environment MCP compose file');
  }

  const spinner = await startSpinner(
    'Starting local development environment...',
    logger.verbosity === 'quiet',
  );

  spinner.message('Building local collab-architecture-mcp image...');
  executor.run(
    'docker',
    [
      'build',
      '-t',
      prepared.architectureMcpImage,
      '-f',
      prepared.dockerfile,
      prepared.architectureMcpSource,
    ],
    {
      cwd: config.workspaceDir,
    },
  );

  spinner.message('Starting infrastructure and cognitive MCP services...');
  runDockerCompose({
    executor,
    files: [prepared.infraFile, prepared.mcpFile],
    arguments: ['up', '-d', '--build', '--force-recreate'],
    cwd: config.workspaceDir,
    projectName: config.compose.projectName,
  });

  spinner.message('Waiting for infrastructure and cognitive MCP health...');

  const env = loadRuntimeEnv(config);
  const runtimeHealth = dryRunHealthOptions(executor, health);
  const infraSummary = await waitForInfraHealth(env, runtimeHealth);
  const mcpSummary = await waitForMcpHealth(env, runtimeHealth);

  if (infraSummary.ok && mcpSummary.ok) {
    spinner.stop('Development environment healthy');
  } else {
    spinner.fail('Development environment did not become healthy');
  }

  logServiceHealth(logger, 'infra health', infraSummary);
  logServiceHealth(logger, 'mcp health', mcpSummary);

  if (!infraSummary.ok || !mcpSummary.ok) {
    throw new CliError('Development environment did not become healthy in time.');
  }

  const stateFile = path.join(config.collabDir, 'dev-env', 'state.json');
  const payload = {
    startedAt: new Date().toISOString(),
    workspaceDir: config.workspaceDir,
    architectureMcpSource: prepared.architectureMcpSource,
    architectureMcpImage: prepared.architectureMcpImage,
    dockerfile: prepared.dockerfile,
    sourceMcpFile: prepared.sourceMcpFile,
    composeFiles: [prepared.infraFile, prepared.mcpFile],
  };
  executor.writeFile(
    stateFile,
    JSON.stringify(payload, null, 2) + '\n',
    { description: 'write dev-env state file' },
  );
}
