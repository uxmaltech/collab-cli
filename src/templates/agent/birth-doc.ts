import type { AgentBootstrapOptions } from '../../lib/agent-bootstrap/types';

export function birthDocTemplate(options: AgentBootstrapOptions): string {
  const { birthProfile } = options;
  const providerLine =
    options.providerAuthMethod === 'cli'
      ? options.providerCli.configuredModel
        ? `- Default provider: \`${options.provider}\` via \`${options.providerAuthMethod}\` (CLI configured model: \`${options.providerCli.configuredModel}\`)`
        : `- Default provider: \`${options.provider}\` via \`${options.providerAuthMethod}\``
      : options.model
        ? `- Default provider: \`${options.provider}\` via \`${options.providerAuthMethod}\` (\`${options.model}\`)`
        : `- Default provider: \`${options.provider}\` via \`${options.providerAuthMethod}\``;
  return (
    [
    `# ${options.agentName} Birth Guide`,
    '',
    '## Identity',
    '',
    `- Agent id: \`${options.agentId}\``,
    `- Scope: \`${options.scope}\``,
    `- Runtime source: \`${options.runtimeSource}\``,
    providerLine,
    `- Self repository: \`${options.selfRepository}\``,
    `- Assigned repositories: ${options.assignedRepositories.length > 0 ? options.assignedRepositories.map((item) => `\`${item}\``).join(', ') : 'none'}`,
    '',
    '## Purpose',
    '',
    birthProfile.purpose,
    '',
    '## Persona',
    '',
    `- Role: ${birthProfile.personaRole}`,
    `- Tone: ${birthProfile.personaTone}`,
    `- Behavior: ${birthProfile.personaSummary}`,
    '',
    '## Soul',
    '',
    `- Mission: ${birthProfile.soulMission}`,
    `- Ethos: ${birthProfile.soulEthos}`,
    ...birthProfile.soulGuardrails.map((guardrail) => `- Guardrail: ${guardrail}`),
    '',
    '## Boundaries',
    '',
    `- Worker namespaces: ${options.approvedNamespaces.map((item) => `\`${item}\``).join(', ')}`,
    `- Operator namespaces: ${options.operatorNamespaces.map((item) => `\`${item}\``).join(', ')}`,
    `- Cognitive MCP URL: \`${options.cognitiveMcpUrl}\``,
    '- Durable state backend: `cognitive-mcp` via `agent.identity.*`, `agent.project.*`, `agent.task.*`, `agent.session.*`, and `agent.memory.*`',
    `- Egress policy: ${options.egressUrls.map((item) => `\`${item}\``).join(', ')}`,
    `- Redis URL: \`${options.redisUrl}\``,
    '- Environment taxonomy: `.env.example` plus local `.env`',
    '',
    '## First E2E Scenario',
    '',
    '1. Load identity through `agent.identity.*`.',
    '2. Create or bind a project through `agent.project.*`.',
    '3. Create the first task through `agent.task.*`.',
    '4. Start and checkpoint a session through `agent.session.*`.',
    '5. Append a durable memory fact through `agent.memory.*`.',
    '6. Produce a human-readable summary that references those visible artifacts.',
    '',
    '## Visible Artifacts',
    '',
    `- Birth definition: \`fixtures/${options.agentSlug}/agent-birth.json\``,
    `- Prompt catalog: \`fixtures/${options.agentSlug}/visible-prompts.json\``,
    `- Repo-owned skill: \`skills/${options.agentSlug}-bootstrap/SKILL.md\``,
    '- Environment example: `.env.example`',
    '- Local runtime env: `.env`',
    '',
  ].join('\n') + '\n'
  );
}
