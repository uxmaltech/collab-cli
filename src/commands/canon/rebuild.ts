import type { Command } from 'commander';

import { createCommandContext } from '../../lib/command-context';
import { CliError } from '../../lib/errors';
import { runOrchestration, type OrchestrationStage } from '../../lib/orchestrator';

import { canonRebuildSnapshotStage } from '../../stages/canon-rebuild-snapshot';
import { canonRebuildIndexesStage } from '../../stages/canon-rebuild-indexes';
import { canonRebuildGraphStage } from '../../stages/canon-rebuild-graph';
import { canonRebuildVectorsStage } from '../../stages/canon-rebuild-vectors';
import { canonRebuildValidateStage } from '../../stages/canon-rebuild-validate';

interface RebuildFlags {
  confirm?: boolean;
  graph?: boolean;
  vectors?: boolean;
  indexes?: boolean;
}

/**
 * Builds the ordered list of orchestration stages for a canon rebuild.
 *
 * The pipeline always starts with a snapshot and ends with validation.
 * Middle stages depend on the workspace mode and the selective flags
 * provided by the user.
 */
export function buildRebuildPipeline(
  isFileOnly: boolean,
  flags: Pick<RebuildFlags, 'graph' | 'vectors' | 'indexes'>,
): OrchestrationStage[] {
  const selective = flags.graph || flags.vectors || flags.indexes;
  const stages: OrchestrationStage[] = [];

  // 1. Snapshot always runs first
  stages.push(canonRebuildSnapshotStage);

  // 2. Selective or full rebuild
  if (!selective) {
    // Full rebuild: all applicable stages for the mode
    stages.push(canonRebuildIndexesStage);
    if (!isFileOnly) {
      stages.push(canonRebuildGraphStage);
      stages.push(canonRebuildVectorsStage);
    }
  } else {
    if (flags.indexes) stages.push(canonRebuildIndexesStage);
    if (flags.graph) stages.push(canonRebuildGraphStage);
    if (flags.vectors) stages.push(canonRebuildVectorsStage);
  }

  // 3. Validation always runs last
  stages.push(canonRebuildValidateStage);

  return stages;
}

export function registerCanonRebuildCommand(parent: Command): void {
  parent
    .command('rebuild')
    .description('Destroy and recreate all derived canon artifacts for the current workspace')
    .option('--confirm', 'Required flag to confirm destructive rebuild')
    .option('--graph', 'Only rebuild graph seeds via MCP')
    .option('--vectors', 'Only rebuild vector embeddings')
    .option('--indexes', 'Only rebuild README/index files')
    .addHelpText(
      'after',
      `
Examples:
  collab canon rebuild --confirm
  collab canon rebuild --confirm --indexes
  collab canon rebuild --confirm --graph --vectors
  collab canon rebuild --dry-run
`,
    )
    .action(async (options: RebuildFlags, command: Command) => {
      const context = createCommandContext(command);

      // Safety: --confirm is mandatory unless in dry-run
      if (!options.confirm && !context.dryRun) {
        throw new CliError(
          'Canon rebuild is destructive. Pass --confirm to proceed, or --dry-run to preview.',
        );
      }

      const isFileOnly = context.config.mode === 'file-only';
      const selectiveMode = options.graph || options.vectors || options.indexes;

      // Mode-aware validation
      if (isFileOnly && (options.graph || options.vectors)) {
        throw new CliError(
          'Flags --graph and --vectors require indexed mode. ' +
            'Current workspace is file-only. Only --indexes is available.',
        );
      }

      const stages = buildRebuildPipeline(isFileOnly, options);

      const modeLabel = isFileOnly ? 'file-only' : 'indexed';
      const scopeLabel = selectiveMode
        ? [options.graph && 'graph', options.vectors && 'vectors', options.indexes && 'indexes']
            .filter(Boolean)
            .join('+')
        : 'full';

      await runOrchestration(
        {
          workflowId: 'canon-rebuild',
          config: context.config,
          executor: context.executor,
          logger: context.logger,
          mode: `${modeLabel} (${scopeLabel})`,
          stageOptions: {
            rebuildGraph: !selectiveMode || Boolean(options.graph),
            rebuildVectors: !selectiveMode || Boolean(options.vectors),
            rebuildIndexes: !selectiveMode || Boolean(options.indexes),
          },
        },
        stages,
      );

      context.logger.result('Canon rebuild complete.');
    });
}
