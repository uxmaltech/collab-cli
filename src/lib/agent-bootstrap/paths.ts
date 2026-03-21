import path from 'node:path';

import type { AgentBootstrapOptions, AgentBootstrapPaths } from './types';

export function buildAgentBootstrapPaths(options: AgentBootstrapOptions): AgentBootstrapPaths {
  return {
    configFile: path.join(options.outputDir, '.collab', 'config.json'),
    envExampleFile: path.join(options.outputDir, '.env.example'),
    envFile: path.join(options.outputDir, '.env'),
    gitignoreFile: path.join(options.outputDir, '.gitignore'),
    packageJsonFile: path.join(options.outputDir, 'package.json'),
    dockerfile: path.join(options.outputDir, 'Dockerfile'),
    entrypointFile: path.join(options.outputDir, 'index.js'),
    birthFile: path.join(options.outputDir, 'fixtures', options.agentSlug, 'agent-birth.json'),
    visiblePromptsFile: path.join(
      options.outputDir,
      'fixtures',
      options.agentSlug,
      'visible-prompts.json',
    ),
    birthDocFile: path.join(options.outputDir, 'docs', `${options.agentSlug}-birth.md`),
    skillFile: path.join(
      options.outputDir,
      'skills',
      `${options.agentSlug}-bootstrap`,
      'SKILL.md',
    ),
    skillManifestFile: path.join(
      options.outputDir,
      'skills',
      `${options.agentSlug}-bootstrap`,
      'skill.json',
    ),
    composeFile: path.join(options.outputDir, 'infra', 'docker-compose.yml'),
    infraComposeFile: path.join(options.outputDir, 'infra', 'docker-compose.infra.yml'),
    mcpComposeFile: path.join(options.outputDir, 'infra', 'docker-compose.mcp.yml'),
  };
}
