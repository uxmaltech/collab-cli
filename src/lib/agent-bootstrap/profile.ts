import type { AgentBootstrapOptions, AgentBirthProfile } from './types';

interface BirthProfileSeed {
  agentName: string;
  agentId: string;
  scope: string;
  runtimeSource: string;
  provider: string;
  model?: string;
  selfRepository: string;
  assignedRepositories: string[];
  approvedNamespaces: string[];
  operatorNamespaces: string[];
  cognitiveMcpUrl: string;
  egressUrls: string[];
  birthProfile?: Partial<AgentBirthProfile>;
}

function trimArray(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
}

export function defaultBirthProfileFields(seed: BirthProfileSeed): AgentBirthProfile {
  const assignedRepos =
    seed.assignedRepositories.length > 0
      ? ` and the assigned repositories ${seed.assignedRepositories.join(', ')}`
      : '';
  const explicitPurpose = seed.birthProfile?.purpose?.trim();
  const explicitRole = seed.birthProfile?.personaRole?.trim();
  const explicitMission = seed.birthProfile?.soulMission?.trim();
  const personaRole = explicitRole || `${seed.scope} architecture and delivery operator`;
  const purpose =
    explicitPurpose
    || `Operate ${seed.scope} through visible Collab artifacts, using ${seed.selfRepository}${assignedRepos} as the durable delivery boundary.`;
  const soulMission =
    explicitMission
    || 'Keep collaboration state explicit, recoverable, and inspectable through Collab contracts instead of hidden local state.';
  const personaSummary = seed.birthProfile?.personaSummary?.trim()
    || `${seed.agentName} acts as the ${personaRole}, turning requests into visible project, task, session, and memory state with contract-backed outcomes.`;
  const soulEthos = seed.birthProfile?.soulEthos?.trim()
    || 'Prefer durable contract calls, traceable artifacts, and bounded execution over informal coordination and implicit memory.';

  return {
    purpose,
    personaRole,
    personaTone: seed.birthProfile?.personaTone?.trim() || 'direct, explicit, test-first',
    personaSummary,
    soulMission,
    soulEthos,
    soulGuardrails: [
      'Persist durable project, task, session, and memory state only through agent.* or approved MCP surfaces.',
      'Use the cognitive infrastructure as the durable persistence layer for agent lifecycle state.',
      'Treat persona as operating policy that shapes decisions, not as decorative copy.',
      'Produce visible artifacts after each bootstrap or development turn.',
    ],
    systemPrompt: [
      `You are ${seed.agentName} (${seed.agentId}), responsible for ${seed.scope}.`,
      `Your principal role is ${personaRole}.`,
      `Your purpose is ${purpose}.`,
      `Your self repository is ${seed.selfRepository}${assignedRepos}.`,
      `Use ${seed.runtimeSource} as the runtime foundation and ${seed.cognitiveMcpUrl} as the cognitive MCP endpoint.`,
      `Your soul mission is ${soulMission}.`,
      'Resolve identity first, then keep project, task, session, and memory state visible through explicit Collab contracts backed by the cognitive infrastructure.',
    ].join(' '),
    styleRules: [
      'State assumptions before crossing a contract boundary.',
      'Prefer concise, implementation-oriented responses.',
      'Reference visible artifacts and recorded outcomes after each significant action.',
    ],
    workStylePlanningMode: 'explicit-checkpoints',
    workStyleApprovalPosture: 'safe-defaults',
    workStyleCollaborationStyle: 'artifact-first',
  };
}

export function mergeBirthProfileFields(
  defaults: AgentBirthProfile,
  overrides?: Partial<AgentBirthProfile>,
): AgentBirthProfile {
  if (!overrides) {
    return defaults;
  }

  return {
    purpose: overrides.purpose?.trim() || defaults.purpose,
    personaRole: overrides.personaRole?.trim() || defaults.personaRole,
    personaTone: overrides.personaTone?.trim() || defaults.personaTone,
    personaSummary: overrides.personaSummary?.trim() || defaults.personaSummary,
    soulMission: overrides.soulMission?.trim() || defaults.soulMission,
    soulEthos: overrides.soulEthos?.trim() || defaults.soulEthos,
    soulGuardrails:
      overrides.soulGuardrails && overrides.soulGuardrails.length > 0
        ? trimArray(overrides.soulGuardrails)
        : defaults.soulGuardrails,
    systemPrompt: overrides.systemPrompt?.trim() || defaults.systemPrompt,
    styleRules:
      overrides.styleRules && overrides.styleRules.length > 0
        ? trimArray(overrides.styleRules)
        : defaults.styleRules,
    workStylePlanningMode:
      overrides.workStylePlanningMode?.trim() || defaults.workStylePlanningMode,
    workStyleApprovalPosture:
      overrides.workStyleApprovalPosture?.trim() || defaults.workStyleApprovalPosture,
    workStyleCollaborationStyle:
      overrides.workStyleCollaborationStyle?.trim() || defaults.workStyleCollaborationStyle,
  };
}

export function defaultBirthProfileFromOptions(
  options: Pick<
    AgentBootstrapOptions,
    | 'agentName'
    | 'agentId'
    | 'scope'
    | 'runtimeSource'
    | 'provider'
    | 'model'
    | 'selfRepository'
    | 'assignedRepositories'
    | 'approvedNamespaces'
    | 'operatorNamespaces'
    | 'cognitiveMcpUrl'
    | 'egressUrls'
  >,
  birthProfile?: Partial<AgentBirthProfile>,
): AgentBirthProfile {
  return defaultBirthProfileFields({
    ...options,
    birthProfile,
  });
}
