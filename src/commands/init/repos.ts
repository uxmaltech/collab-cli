import path from 'node:path';

import type { CollabConfig } from '../../lib/config';
import type { Executor } from '../../lib/executor';
import type { Logger } from '../../lib/logger';

import { CliError } from '../../lib/errors';

import type { InitOptions } from './types';
import { runRepoDomainGeneration } from './repo-domain';
import { runEcosystemChecks } from './mcp-helpers';

// ────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────

interface RepoRunResult {
  repoPath: string;
  repoName: string;
  ok: boolean;
  error?: string;
}

// ────────────────────────────────────────────────────────────────
// Multi-repo domain generation
// ────────────────────────────────────────────────────────────────

/**
 * Runs domain generation across one or more repos sequentially.
 *
 * - Mode and flags apply uniformly to all repos in the batch.
 * - Errors in one repo warn but do not abort subsequent repos.
 * - Aggregate stats are printed at the end.
 */
export async function runReposDomainGeneration(
  context: { config: CollabConfig; executor: Executor; logger: Logger },
  options: InitOptions,
  repoPaths: string[],
): Promise<void> {
  const total = repoPaths.length;
  const results: RepoRunResult[] = [];

  for (let i = 0; i < repoPaths.length; i++) {
    const repoPath = repoPaths[i];
    const repoName = path.basename(repoPath);

    if (total > 1) {
      context.logger.repoHeader(repoName, i + 1, total);
    }

    const perRepoOptions: InitOptions = {
      ...options,
      repo: repoPath,
    };

    try {
      await runRepoDomainGeneration(context, perRepoOptions);
      results.push({ repoPath, repoName, ok: true });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      context.logger.warn(`Failed for ${repoName}: ${message}`);
      results.push({ repoPath, repoName, ok: false, error: message });
    }
  }

  const succeeded = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;

  // Aggregate summary (only for multi-repo runs)
  if (total > 1) {
    context.logger.phaseHeader('Domain Generation Complete');
    context.logger.summaryFooter([
      { label: 'Total repos', value: String(total) },
      { label: 'Succeeded', value: String(succeeded) },
      ...(failed > 0 ? [{ label: 'Failed', value: String(failed) }] : []),
      { label: 'Dry-run', value: context.executor.dryRun ? 'yes' : 'no' },
    ]);

    if (failed > 0) {
      context.logger.warn('Failed repos:');
      for (const r of results.filter((r) => !r.ok)) {
        context.logger.warn(`  - ${r.repoName}: ${r.error}`);
      }
    }
  }

  // If ALL repos failed, propagate the error
  if (failed === total) {
    const firstError = results.find((r) => !r.ok)?.error ?? 'Unknown error';
    throw new CliError(
      total === 1
        ? firstError
        : `All ${total} repos failed. First error: ${firstError}`,
    );
  }

  // Ecosystem checks (once at end, not per-repo)
  await runEcosystemChecks(context.config, context.logger, context.executor.dryRun);
}
