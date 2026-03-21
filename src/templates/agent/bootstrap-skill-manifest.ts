import type { AgentBootstrapOptions } from '../../lib/agent-bootstrap/types';

export function bootstrapSkillManifestTemplate(options: AgentBootstrapOptions): string {
  return (
    JSON.stringify(
      {
        skill_id: `${options.agentSlug}.bootstrap`,
        title: `${options.agentName} Bootstrap Skill`,
        description:
          `Bootstrap visible Collab project, task, session, and memory artifacts for ${options.agentName}.`,
        instructions_path: 'SKILL.md',
      },
      null,
      2,
    ) + '\n'
  );
}
