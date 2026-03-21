import type { AgentBootstrapOptions } from '../../lib/agent-bootstrap/types';

export function agentBirthTemplate(options: AgentBootstrapOptions): string {
  const { birthProfile } = options;
  const payload = {
    agent_id: options.agentId,
    display_name: options.agentName,
    purpose: birthProfile.purpose,
    persona: {
      role: birthProfile.personaRole,
      tone: birthProfile.personaTone,
      summary: birthProfile.personaSummary,
    },
    soul: {
      mission: birthProfile.soulMission,
      ethos: birthProfile.soulEthos,
      guardrails: birthProfile.soulGuardrails,
    },
    prompt_profile: {
      system_prompt: birthProfile.systemPrompt,
      style_rules: birthProfile.styleRules,
    },
    work_style: {
      planning_mode: birthProfile.workStylePlanningMode,
      approval_posture: birthProfile.workStyleApprovalPosture,
      collaboration_style: birthProfile.workStyleCollaborationStyle,
    },
    operating_boundaries: {
      approved_namespaces: options.approvedNamespaces,
      durable_state_policy:
        'Do not keep durable collaboration state in ad hoc local files; persist identity, project, task, session, and memory state in the cognitive infrastructure through agent.* and approved MCP namespaces.',
      egress_policy: options.egressUrls,
      self_repository: options.selfRepository,
      assigned_repositories: options.assignedRepositories,
      runtime_source: options.runtimeSource,
      cognitive_mcp_endpoint: options.cognitiveMcpUrl,
      env_example_file: '.env.example',
      local_env_file: '.env',
    },
  };

  return JSON.stringify(payload, null, 2) + '\n';
}
