import path from 'node:path';

import {
  agentBirthTemplate,
  agentComposeTemplate,
  agentConfigTemplate,
  agentDockerfileTemplate,
  agentEnvTemplate,
  agentEntrypointTemplate,
  agentEnvExampleTemplate,
  agentGitignoreTemplate,
  agentPackageJsonTemplate,
  agentVisiblePromptsTemplate,
  bootstrapSkillTemplate,
  bootstrapSkillManifestTemplate,
  birthDocTemplate,
  infraComposeTemplate,
  mcpComposeTemplate,
} from '../../templates/agent';
import { buildAgentBootstrapPaths } from './paths';
import type { AgentBootstrapOptions, GeneratedFile } from './types';

function fileEntry(outputDir: string, absolutePath: string, content: string, description: string): GeneratedFile {
  return {
    absolutePath,
    relativePath: path.relative(outputDir, absolutePath),
    content,
    description,
  };
}

export function renderAgentBootstrapFiles(options: AgentBootstrapOptions): GeneratedFile[] {
  const paths = buildAgentBootstrapPaths(options);

  return [
    fileEntry(
      options.outputDir,
      paths.configFile,
      agentConfigTemplate(options),
      'write .collab/config.json',
    ),
    fileEntry(
      options.outputDir,
      paths.envExampleFile,
      agentEnvExampleTemplate(options),
      'write .env.example',
    ),
    fileEntry(
      options.outputDir,
      paths.envFile,
      agentEnvTemplate(options),
      'write .env',
    ),
    fileEntry(
      options.outputDir,
      paths.gitignoreFile,
      agentGitignoreTemplate(options),
      'write .gitignore',
    ),
    fileEntry(
      options.outputDir,
      paths.packageJsonFile,
      agentPackageJsonTemplate(options),
      'write package.json',
    ),
    fileEntry(
      options.outputDir,
      paths.dockerfile,
      agentDockerfileTemplate(options),
      'write Dockerfile',
    ),
    fileEntry(
      options.outputDir,
      paths.entrypointFile,
      agentEntrypointTemplate(options),
      'write index.js entrypoint',
    ),
    fileEntry(
      options.outputDir,
      paths.birthFile,
      agentBirthTemplate(options),
      'write fixtures agent-birth.json',
    ),
    fileEntry(
      options.outputDir,
      paths.visiblePromptsFile,
      agentVisiblePromptsTemplate(options),
      'write fixtures visible-prompts.json',
    ),
    fileEntry(
      options.outputDir,
      paths.birthDocFile,
      birthDocTemplate(options),
      'write birth guide',
    ),
    fileEntry(
      options.outputDir,
      paths.skillFile,
      bootstrapSkillTemplate(options),
      'write bootstrap skill',
    ),
    fileEntry(
      options.outputDir,
      paths.skillManifestFile,
      bootstrapSkillManifestTemplate(options),
      'write bootstrap skill manifest',
    ),
    fileEntry(
      options.outputDir,
      paths.composeFile,
      agentComposeTemplate(options),
      'write infra docker-compose.yml',
    ),
    fileEntry(
      options.outputDir,
      paths.infraComposeFile,
      infraComposeTemplate(options),
      'write infra docker-compose.infra.yml',
    ),
    fileEntry(
      options.outputDir,
      paths.mcpComposeFile,
      mcpComposeTemplate(options),
      'write infra docker-compose.mcp.yml',
    ),
  ];
}
