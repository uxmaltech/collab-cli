import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { loadBornAgents, resolveBornAgentRootDir } from '../../lib/agent-registry';
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

export interface DevEnvStopOptions {
  outputDir?: string;
  infraFile?: string;
  mcpFile?: string;
}

export interface PreparedDevEnv {
  readonly workspaceDir: string;
  readonly infraFile: string;
  readonly mcpFile: string;
  readonly dockerfile: string;
  readonly architectureMcpSource: string;
  readonly architectureMcpImage: string;
}

interface PersistedDevEnvState {
  startedAt?: string;
  stoppedAt?: string;
  workspaceDir?: string;
  architectureMcpSource?: string;
  architectureMcpImage?: string;
  dockerfile?: string;
  composeFiles?: string[];
}

export interface ResolvedDevEnvStop {
  readonly workspaceDir: string;
  readonly infraFile: string;
  readonly mcpFile: string;
  readonly stateFile: string;
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

function getDevEnvStateFile(config: CollabConfig): string {
  return path.join(config.collabDir, 'dev-env', 'state.json');
}

function loadPersistedDevEnvState(stateFile: string): PersistedDevEnvState | null {
  if (!fs.existsSync(stateFile)) {
    return null;
  }

  const raw = fs.readFileSync(stateFile, 'utf8');
  try {
    return JSON.parse(raw) as PersistedDevEnvState;
  } catch (error) {
    throw new CliError(
      `The dev-env state file is invalid JSON: ${stateFile} (${error instanceof Error ? error.message : String(error)})`,
    );
  }
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
    '      NEBULA_ADDR: nebula-graphd',
    '      NEBULA_PORT: "9669"',
    '      NEBULA_USER: root',
    '      NEBULA_PASSWORD: nebula',
    '      RECOVERY_S3_ENDPOINT: http://minio:9000',
    '      RECOVERY_S3_REGION: us-east-1',
    '      RECOVERY_S3_BUCKET: ${RECOVERY_S3_BUCKET:-collab-recovery}',
    '      RECOVERY_S3_PREFIX: ${RECOVERY_S3_PREFIX:-recovery}',
    '      RECOVERY_S3_ACCESS_KEY: ${RECOVERY_S3_ACCESS_KEY:-collabminio}',
    '      RECOVERY_S3_SECRET_KEY: ${RECOVERY_S3_SECRET_KEY:-collabminiosecret}',
    '      RECOVERY_S3_FORCE_PATH_STYLE: ${RECOVERY_S3_FORCE_PATH_STYLE:-true}',
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

export function renderArchitectureInfrastructureCompose(): string {
  return [
    'services:',
    '  redis:',
    '    image: redis:7.4-alpine',
    '    container_name: collab-agent-redis',
    '    command:',
    '      - redis-server',
    '      - --appendonly',
    '      - "yes"',
    '      - --requirepass',
    '      - ${REDIS_PASSWORD:-collab-dev-redis}',
    '    ports:',
    '      - "6379:6379"',
    '    volumes:',
    '      - redis-data:/data',
    '',
    '  qdrant:',
    '    image: qdrant/qdrant:v1.8.1',
    '    container_name: collab-agent-qdrant',
    '    ports:',
    '      - "6333:6333"',
    '    volumes:',
    '      - qdrant-data:/qdrant/storage',
    '',
    '  metad0:',
    '    image: vesoft/nebula-metad:${NEBULA_VERSION:-v3.6.0}',
    '    container_name: nebula-metad0',
    '    ports:',
    '      - "9559:9559"',
    '      - "19559:19559"',
    '    volumes:',
    '      - nebula-metad0:/usr/local/nebula/data/meta',
    '    command:',
    '      - nebula-metad',
    '      - --meta_server_addrs=metad0:9559',
    '      - --local_ip=metad0',
    '      - --ws_ip=metad0',
    '      - --port=9559',
    '      - --ws_http_port=19559',
    '      - --data_path=/usr/local/nebula/data/meta',
    '',
    '  storaged0:',
    '    image: vesoft/nebula-storaged:${NEBULA_VERSION:-v3.6.0}',
    '    container_name: nebula-storaged0',
    '    depends_on:',
    '      - metad0',
    '    ports:',
    '      - "9779:9779"',
    '      - "19779:19779"',
    '    volumes:',
    '      - nebula-storaged0:/usr/local/nebula/data/storage',
    '    command:',
    '      - nebula-storaged',
    '      - --meta_server_addrs=metad0:9559',
    '      - --local_ip=storaged0',
    '      - --ws_ip=storaged0',
    '      - --port=9779',
    '      - --ws_http_port=19779',
    '      - --data_path=/usr/local/nebula/data/storage',
    '',
    '  nebula-graphd:',
    '    image: vesoft/nebula-graphd:${NEBULA_VERSION:-v3.6.0}',
    '    container_name: nebula-graphd',
    '    depends_on:',
    '      - metad0',
    '      - storaged0',
    '    ports:',
    '      - "9669:9669"',
    '      - "19669:19669"',
    '    volumes:',
    '      - ../graph/seed:/seed:ro',
    '    command:',
    '      - nebula-graphd',
    '      - --meta_server_addrs=metad0:9559',
    '      - --local_ip=graphd',
    '      - --ws_ip=graphd',
    '      - --port=9669',
    '      - --ws_http_port=19669',
    '',
    '  minio:',
    '    image: minio/minio:RELEASE.2026-01-18T00-31-37Z',
    '    container_name: collab-recovery-minio',
    '    command: server /data --console-address ":9001"',
    '    environment:',
    '      MINIO_ROOT_USER: ${RECOVERY_S3_ACCESS_KEY:-collabminio}',
    '      MINIO_ROOT_PASSWORD: ${RECOVERY_S3_SECRET_KEY:-collabminiosecret}',
    '    ports:',
    '      - "9000:9000"',
    '      - "9001:9001"',
    '    volumes:',
    '      - minio-data:/data',
    '',
    '  minio-init:',
    '    image: minio/mc:RELEASE.2025-08-13T08-35-41Z',
    '    container_name: collab-recovery-minio-init',
    '    depends_on:',
    '      - minio',
    '    environment:',
    '      MINIO_ROOT_USER: ${RECOVERY_S3_ACCESS_KEY:-collabminio}',
    '      MINIO_ROOT_PASSWORD: ${RECOVERY_S3_SECRET_KEY:-collabminiosecret}',
    '      RECOVERY_S3_BUCKET: ${RECOVERY_S3_BUCKET:-collab-recovery}',
    '    entrypoint: >',
    '      /bin/sh -c "',
    '      until /usr/bin/mc alias set local http://minio:9000 $$MINIO_ROOT_USER $$MINIO_ROOT_PASSWORD; do',
    '        sleep 1;',
    '      done;',
    '      /usr/bin/mc mb --ignore-existing local/$$RECOVERY_S3_BUCKET;',
    '      "',
    '',
    'volumes:',
    '  redis-data:',
    '  qdrant-data:',
    '  nebula-metad0:',
    '  nebula-storaged0:',
    '  minio-data:',
    '',
  ].join('\n');
}

function ensureArchitectureInfrastructureCompose(
  logger: Logger,
  executor: Executor,
  architectureMcpSource: string,
): string {
  const infraFile = path.join(architectureMcpSource, 'infra', 'docker-compose.yml');
  const infraTemplateFile = path.join(
    architectureMcpSource,
    'infra',
    'docker-compose.template.yml',
  );
  const templateContent = renderArchitectureInfrastructureCompose();

  if (!fs.existsSync(infraTemplateFile)) {
    logger.info(`Writing collab-architecture-mcp infrastructure template: ${infraTemplateFile}`);
    executor.writeFile(
      infraTemplateFile,
      templateContent,
      { description: 'write dev-env infrastructure template file' },
    );
  }

  if (fs.existsSync(infraFile)) {
    logger.info(`Using collab-architecture-mcp infrastructure compose: ${infraFile}`);
    return infraFile;
  }

  logger.info(`Copying collab-architecture-mcp infrastructure template into ${infraFile}`);
  executor.writeFile(
    infraFile,
    fs.existsSync(infraTemplateFile)
      ? fs.readFileSync(infraTemplateFile, 'utf8')
      : templateContent,
    { description: 'write dev-env infrastructure compose file' },
  );
  return infraFile;
}

export function prepareDevEnv(
  logger: Logger,
  executor: Executor,
  config: CollabConfig,
  options: DevEnvStartOptions,
): PreparedDevEnv {
  const architectureMcpSource = resolveArchitectureMcpSource(
    logger,
    executor,
    config.workspaceDir,
    config.collabDir,
    options.sourceArchitectureMcp,
  );
  const infraFile = options.infraFile
    ? path.resolve(config.workspaceDir, options.infraFile)
    : ensureArchitectureInfrastructureCompose(logger, executor, architectureMcpSource);
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
    renderDevelopmentMcpCompose(
      path.resolve(config.workspaceDir, config.envFile),
      DEV_ARCHITECTURE_MCP_IMAGE,
    ),
    { description: 'write dev-env MCP compose file' },
  );

  return {
    workspaceDir: config.workspaceDir,
    infraFile,
    mcpFile,
    dockerfile,
    architectureMcpSource,
    architectureMcpImage: DEV_ARCHITECTURE_MCP_IMAGE,
  };
}

export function resolveDevEnvStop(
  logger: Logger,
  config: CollabConfig,
  options: DevEnvStopOptions,
): ResolvedDevEnvStop {
  const stateFile = getDevEnvStateFile(config);
  const persisted = loadPersistedDevEnvState(stateFile);
  const persistedComposeFiles = persisted?.composeFiles ?? [];

  const infraFile = options.infraFile
    ? path.resolve(config.workspaceDir, options.infraFile)
    : persistedComposeFiles[0];
  const mcpFile = options.mcpFile
    ? path.resolve(config.workspaceDir, options.mcpFile)
    : persistedComposeFiles[1];

  if (!infraFile || !mcpFile) {
    throw new CliError(
      `No dev-env state was found in ${stateFile}. Run collab dev-env start first or provide --infra-file and --mcp-file explicitly.`,
    );
  }

  if (persisted?.workspaceDir && persisted.workspaceDir !== config.workspaceDir) {
    logger.warn(
      `The saved dev-env state references ${persisted.workspaceDir}, but the current workspace is ${config.workspaceDir}. Using the current workspace with the saved compose files.`,
    );
  }

  return {
    workspaceDir: config.workspaceDir,
    infraFile,
    mcpFile,
    stateFile,
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
    composeFiles: [prepared.infraFile, prepared.mcpFile],
  };
  executor.writeFile(
    stateFile,
    JSON.stringify(payload, null, 2) + '\n',
    { description: 'write dev-env state file' },
  );
}

export async function stopDevEnv(
  logger: Logger,
  executor: Executor,
  config: CollabConfig,
  resolved: ResolvedDevEnvStop,
): Promise<void> {
  ensureCommandAvailable('docker', { dryRun: executor.dryRun });
  if (!executor.dryRun) {
    ensureFileExists(resolved.infraFile, 'Infrastructure compose file');
    ensureFileExists(resolved.mcpFile, 'Generated dev environment MCP compose file');
  }

  const spinner = await startSpinner(
    'Stopping local development environment...',
    logger.verbosity === 'quiet',
  );

  runDockerCompose({
    executor,
    files: [resolved.infraFile, resolved.mcpFile],
    arguments: ['stop'],
    cwd: config.workspaceDir,
    projectName: config.compose.projectName,
  });

  spinner.stop('Development environment stopped');

  const existingState = loadPersistedDevEnvState(resolved.stateFile) ?? {};
  const payload = {
    ...existingState,
    workspaceDir: config.workspaceDir,
    composeFiles: [resolved.infraFile, resolved.mcpFile],
    stoppedAt: new Date().toISOString(),
  };
  executor.writeFile(
    resolved.stateFile,
    JSON.stringify(payload, null, 2) + '\n',
    { description: 'write dev-env state file' },
  );
}
