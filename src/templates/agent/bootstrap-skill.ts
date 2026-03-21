import type { AgentBootstrapOptions } from '../../lib/agent-bootstrap/types';

export function bootstrapSkillTemplate(options: AgentBootstrapOptions): string {
  const { birthProfile } = options;
  return (
    [
    `# ${options.agentName} Bootstrap Skill`,
    '',
    '## When To Use',
    '',
    `Use this skill when ${options.agentName} needs to turn a new request into a visible Collab project, task, session, and memory bootstrap flow while honoring this purpose: ${birthProfile.purpose}`,
    '',
    '## Inputs',
    '',
    '- Requested outcome and success criteria',
    '- Active scope and operator context',
    '- Self repository of the agent',
    '- Assigned repositories for the current work',
    '- Runtime source, MCP endpoint, and environment taxonomy to bind',
    '',
    '## Outputs',
    '',
    '- Project binding or creation record',
    '- First task record with a concrete objective',
    '- Session checkpoint for the active run',
    '- Durable memory fact that captures the operating rule',
    '',
    '## Procedure',
    '',
    '1. Resolve identity first and confirm the active scope.',
    '2. Create or bind the project before creating new work.',
    '3. Open the first task with a visible objective and acceptance signal.',
    '4. Start the session and checkpoint before publishing results.',
    '5. Append a memory fact when a durable rule is established.',
    '',
    '## Guardrails',
    '',
    '- Do not create durable state in ad hoc local files.',
    '- Persist durable identity, project, task, session, and memory state in the cognitive infrastructure through Collab contracts.',
    '- Keep operator-only recovery surfaces out of the worker flow.',
    '- Publish artifacts that a human operator can inspect after the turn.',
    `- Keep the soul mission visible: ${birthProfile.soulMission}`,
    '',
  ].join('\n') + '\n'
  );
}
