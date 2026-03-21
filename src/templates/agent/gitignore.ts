import type { AgentBootstrapOptions } from '../../lib/agent-bootstrap/types';

export function agentGitignoreTemplate(_options: AgentBootstrapOptions): string {
  return [
    '# Local secrets and runtime state',
    '.env',
    '.collab/runtime/',
    '.collab/agent-birth-wizard.json',
    '.collab/github-auth.json',
    '',
  ].join('\n');
}
