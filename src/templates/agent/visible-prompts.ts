import type { AgentBootstrapOptions } from '../../lib/agent-bootstrap/types';

export function agentVisiblePromptsTemplate(options: AgentBootstrapOptions): string {
  const { birthProfile } = options;
  const payload = {
    persona_contract: {
      purpose: birthProfile.purpose,
      persona: birthProfile.personaRole,
      soul: birthProfile.soulMission,
      non_negotiables: [
        'Identity is loaded before mutating project or task state.',
        'Sessions, tasks, projects, and memories stay visible in recorded artifacts.',
        'The operator profile is reserved for recovery and admin surfaces.',
      ],
    },
    visible_prompts: {
      project_create: {
        title: 'Create project scaffold',
        prompt: `Create a project named "${options.agentName} Delivery System" in scope "${options.scope}". Bind the self repository ${options.selfRepository}, keep the purpose "${birthProfile.purpose}" visible, and record one decision about why the agent uses ${options.runtimeSource}.`,
        expected_calls: ['agent.identity.get-profile', 'agent.project.bind-repository', 'agent.project.record-decision'],
      },
      task_create: {
        title: 'Create first task',
        prompt: `Create a task for "${options.agentName} Delivery System" called "Bootstrap visible Collab flow". The task must reference the self repository ${options.selfRepository}${options.assignedRepositories.length > 0 ? ` and the assigned repositories ${options.assignedRepositories.join(', ')}` : ''}.`,
        expected_calls: ['agent.task.load', 'agent.task.record-result'],
      },
      session_bootstrap: {
        title: 'Start session',
        prompt: `Start a development session for ${options.agentName}. Load identity, attach the active project, keep the scope "${options.scope}" visible in the session metadata, and preserve ${options.selfRepository} as the self repository of record.`,
        expected_calls: ['agent.identity.get-profile', 'agent.session.start', 'agent.session.checkpoint'],
      },
      memory_append: {
        title: 'Append memory',
        prompt: `Append a durable memory fact that ${options.agentName} must follow this soul mission: "${birthProfile.soulMission}" and keep identity, project, task, session, and memory state persisted in the cognitive infrastructure behind Collab contracts only.`,
        expected_calls: ['agent.memory.upsert-fact', 'agent.memory.append-event'],
      },
      turn_execute: {
        title: 'Run visible end-to-end turn',
        prompt: `Run one visible turn for ${options.agentName}: load identity, create or retrieve the project for ${options.selfRepository}, create the bootstrap task${options.assignedRepositories.length > 0 ? ` scoped to ${options.assignedRepositories.join(', ')}` : ''}, append the memory fact, checkpoint the session, persist all durable state in the cognitive infrastructure, and summarize the visible artifacts produced.`,
        expected_calls: [
          'agent.identity.*',
          'agent.project.*',
          'agent.task.*',
          'agent.session.*',
          'agent.memory.*',
        ],
      },
    },
  };

  return JSON.stringify(payload, null, 2) + '\n';
}
