import { normalizeAgentBootstrapOptions } from './normalize';
import { renderAgentBootstrapFiles } from './render';
import type {
  AgentBootstrapInput,
  AgentBootstrapResult,
  AgentBootstrapSummary,
} from './types';
import { validateAgentBootstrapOptions } from './validate';

export function generateAgentBootstrap(input: AgentBootstrapInput): AgentBootstrapResult {
  const options = normalizeAgentBootstrapOptions(input);
  validateAgentBootstrapOptions(options);

  return {
    options,
    files: renderAgentBootstrapFiles(options),
  };
}

export function summarizeAgentBootstrap(result: AgentBootstrapResult): AgentBootstrapSummary {
  return {
    agent: {
      name: result.options.agentName,
      slug: result.options.agentSlug,
      id: result.options.agentId,
      scope: result.options.scope,
      provider: result.options.provider,
      providerAuthMethod: result.options.providerAuthMethod,
      model: result.options.model,
      outputDir: result.options.outputDir,
      cognitiveMcpUrl: result.options.cognitiveMcpUrl,
      selfRepository: result.options.selfRepository,
      assignedRepositories: result.options.assignedRepositories,
    },
    files: result.files.map((file) => ({ path: file.relativePath })),
  };
}
