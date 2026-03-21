import path from 'node:path';
import { spawnSync } from 'node:child_process';

import type { Command } from 'commander';

import { createCommandContext } from '../../lib/command-context';
import {
  buildActiveAgentPath,
  buildBornAgentsRegistryPath,
  findBornAgent,
  loadBornAgents,
  resolveBornAgentRootDir,
  saveActiveAgent,
  type BornAgentRecord,
} from '../../lib/agent-registry';
import { CliError } from '../../lib/errors';
import { promptChoice } from '../../lib/prompt';
import type { AgentStartCommandOptions } from './types';

function printStartJson(payload: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
}

async function resolveAgentSelection(
  workspaceDir: string,
  agents: readonly BornAgentRecord[],
  requestedAgentId: string | undefined,
  interactiveSession: boolean,
): Promise<BornAgentRecord> {
  if (requestedAgentId) {
    const matched = findBornAgent(agents, requestedAgentId);
    if (!matched) {
      throw new CliError(
        `Agent '${requestedAgentId}' was not found in the current workspace. Available agents: ${agents
          .map((agent) => agent.id)
          .join(', ')}`,
      );
    }

    return matched;
  }

  if (agents.length === 1) {
    return agents[0];
  }

  if (!interactiveSession) {
    throw new CliError(
      `Multiple born agents were found in ${buildBornAgentsRegistryPath(workspaceDir)}. Re-run with 'collab agent start <agent-id>'. Available agents: ${agents
        .map((agent) => agent.id)
        .join(', ')}`,
    );
  }

  const selectedAgentId = await promptChoice(
    'Select the agent to start',
    agents.map((agent) => ({
      value: agent.id,
      label: `${agent.name} (${agent.id})`,
      description: agent.selfRepository,
    })),
    agents[0].id,
  );
  return agents.find((agent) => agent.id === selectedAgentId) ?? agents[0];
}

export function registerAgentStartCommand(program: Command): void {
  program
    .command('start [agentId] [runtimeArgs...]')
    .description('Resolve, activate, and execute a born agent in the current workspace')
    .option('--json', 'Print a machine-readable summary after activation')
    .addHelpText(
      'after',
      `
Examples:
  collab agent start
  collab agent start agent.iot-development-agent
  collab agent start agent.iot-development-agent inspect
`,
    )
    .action(async (
      agentId: string | undefined,
      runtimeArgs: string[] | undefined,
      options: AgentStartCommandOptions,
      command: Command,
    ) => {
      const context = createCommandContext(command);
      const workspaceDir = context.cwd;
      const agents = loadBornAgents(workspaceDir);

      if (agents.length === 0) {
        throw new CliError(
          `No born agents were found in ${path.join(workspaceDir, '.collab')}. Run 'collab agent birth' first.`,
        );
      }

      const selectedAgent = await resolveAgentSelection(
        workspaceDir,
        agents,
        agentId,
        Boolean(process.stdin.isTTY && process.stdout.isTTY),
      );
      const activeAgentPath = buildActiveAgentPath(workspaceDir);
      const agentRootDir = resolveBornAgentRootDir(workspaceDir, selectedAgent);
      const entryFile = path.resolve(agentRootDir, selectedAgent.entryFile);
      const resolvedRuntimeArgs =
        runtimeArgs && runtimeArgs.length > 0
          ? runtimeArgs
          : selectedAgent.defaultArgs;
      const runtimeCommand = ['node', entryFile, ...resolvedRuntimeArgs];

      if (!context.dryRun) {
        saveActiveAgent(workspaceDir, selectedAgent);
      }

      const payload = {
        workspaceDir,
        registryFile: buildBornAgentsRegistryPath(workspaceDir),
        activeFile: activeAgentPath,
        agent: {
          ...selectedAgent,
          rootDir: agentRootDir,
          entryFile,
          configFile: path.resolve(agentRootDir, selectedAgent.configFile),
          birthFile: path.resolve(agentRootDir, selectedAgent.birthFile),
        },
        runtime: {
          cwd: agentRootDir,
          command: runtimeCommand,
        },
      };

      if (options.json) {
        printStartJson(payload);
        return;
      }

      if (context.dryRun) {
        context.logger.result(`Planned activation of ${selectedAgent.name} (${selectedAgent.id})`);
        context.logger.summaryFooter([
          { label: 'workspace', value: workspaceDir },
          { label: 'agent root', value: agentRootDir },
          { label: 'self repo', value: selectedAgent.selfRepository },
          {
            label: 'provider',
            value: selectedAgent.model ? `${selectedAgent.provider} (${selectedAgent.model})` : selectedAgent.provider,
          },
          { label: 'entry', value: entryFile },
          { label: 'command', value: runtimeCommand.join(' ') },
          { label: 'active file', value: activeAgentPath },
        ]);
        return;
      }

      const child = spawnSync('node', [entryFile, ...resolvedRuntimeArgs], {
        cwd: agentRootDir,
        stdio: 'inherit',
        env: process.env,
      });

      if (child.error) {
        const code = (child.error as NodeJS.ErrnoException).code;
        throw new CliError(
          code === 'ENOENT'
            ? `Node.js was not found while starting ${selectedAgent.id}.`
            : child.error.message,
        );
      }

      if ((child.status ?? 0) !== 0) {
        throw new CliError(
          `Agent ${selectedAgent.id} exited with status ${child.status ?? 1}.`,
          child.status ?? 1,
        );
      }
    });
}
