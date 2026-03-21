import type { AgentBootstrapOptions } from '../../lib/agent-bootstrap/types';

export function agentPackageJsonTemplate(options: AgentBootstrapOptions): string {
  const payload = {
    name: options.agentSlug,
    private: true,
    version: '0.1.0',
    type: 'commonjs',
    description: `${options.agentName} Collab runtime agent workspace`,
    scripts: {
      start: 'node index.js development',
      development: 'node index.js development',
      inspect: 'node index.js inspect',
    },
  };

  return JSON.stringify(payload, null, 2) + '\n';
}
