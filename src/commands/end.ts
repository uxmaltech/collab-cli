import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { Command } from 'commander';

import { createCommandContext } from '../lib/command-context';
import { CliError } from '../lib/errors';
import { resolveGitHubOwnerRepo } from '../lib/github-api';

// ────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────

interface EndOptions {
  dryRun?: boolean;
  skipCanonSync?: boolean;
  title?: string;
  base?: string;
}

// ────────────────────────────────────────────────────────────────
// Context detection helpers
// ────────────────────────────────────────────────────────────────

/**
 * Parses an issue number from a branch name following the convention:
 * `feature/42-add-login`, `fix/88-align-flow`, `refactor/10-cleanup`, etc.
 */
export function parseIssueFromBranch(branch: string): number | null {
  const match = branch.match(/^(?:feature|fix|refactor|chore|docs|test)\/(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

function getCurrentBranch(cwd: string): string {
  return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

function getCommitLog(cwd: string, base: string): string {
  try {
    return execFileSync('git', ['log', '--oneline', `${base}..HEAD`], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

function hasGhCli(): boolean {
  try {
    execFileSync('gh', ['--version'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return true;
  } catch {
    return false;
  }
}

// ────────────────────────────────────────────────────────────────
// PR body generation
// ────────────────────────────────────────────────────────────────

function buildPrBody(opts: {
  issueNumber: number | null;
  commitLog: string;
  canonSlug: string | undefined;
  isIndexed: boolean;
}): string {
  const lines: string[] = ['## Summary', ''];

  if (opts.issueNumber) {
    lines.push(`Resolves #${opts.issueNumber}`, '');
  }

  if (opts.isIndexed) {
    lines.push('## Governance', '');
    if (opts.issueNumber) {
      lines.push(`- **Issue**: #${opts.issueNumber}`);
    }
    lines.push('- **Phase**: Implementation (GOV-R-002)', '');

    lines.push('## GOV-R-001 Phase Checklist', '');
    lines.push('- [x] Phase 1: Epic Definition');
    lines.push('- [x] Phase 2: User Story Decomposition');
    lines.push('- [x] Phase 3: Sub-issue Assignment');
    lines.push('- [x] Phase 4: Implementation');
    lines.push('- [ ] Phase 5: Canon Sync');
    lines.push('');
  }

  if (opts.commitLog) {
    lines.push('## Changes', '', '```', opts.commitLog, '```', '');
  }

  return lines.join('\n');
}

// ────────────────────────────────────────────────────────────────
// Canon sync PR generation (#94)
// ────────────────────────────────────────────────────────────────

function createCanonSyncPr(opts: {
  cwd: string;
  canonSlug: string;
  repoSlug: string;
  issueNumber: number | null;
  branch: string;
  dryRun: boolean;
  logger: { info: (msg: string) => void; warn: (msg: string) => void };
}): void {
  const { cwd, canonSlug, repoSlug, issueNumber, dryRun, logger } = opts;

  // Check if there are architecture changes
  const archDir = path.join(cwd, 'docs', 'architecture');
  if (!fs.existsSync(archDir)) {
    logger.info('No docs/architecture directory found; skipping canon sync PR.');
    return;
  }

  // Check for changes in architecture dir relative to base
  let archChanges: string;
  try {
    archChanges = execFileSync('git', ['diff', '--name-only', 'development..HEAD', '--', 'docs/architecture/'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    archChanges = '';
  }

  if (!archChanges) {
    logger.info('No architecture changes detected; skipping canon sync PR.');
    return;
  }

  const changedFiles = archChanges.split('\n').filter(Boolean);
  const syncBranch = `canon-sync/${repoSlug.split('/')[1]}${issueNumber ? `-${issueNumber}` : ''}`;

  const body = [
    '## Canon Sync',
    '',
    `Source: ${repoSlug}${issueNumber ? `#${issueNumber}` : ''}`,
    '',
    '### Updated files',
    '',
    ...changedFiles.map((f) => `- \`${f}\``),
    '',
    '### Governance',
    '',
    `This PR completes Phase 5 (Canon Sync) of GOV-R-001.`,
    '',
  ].join('\n');

  if (dryRun) {
    logger.info(`[dry-run] Would create canon sync PR in ${canonSlug}:`);
    logger.info(`  Branch: ${syncBranch}`);
    logger.info(`  Changed files: ${changedFiles.length}`);
    return;
  }

  // Create canon sync PR via gh CLI
  try {
    execFileSync('gh', [
      'pr', 'create',
      '-R', canonSlug,
      '--base', 'development',
      '--head', syncBranch,
      '--title', `Canon sync — ${repoSlug.split('/')[1]}${issueNumber ? ` #${issueNumber}` : ''}`,
      '--body', body,
    ], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    logger.info(`Canon sync PR created in ${canonSlug}.`);
  } catch {
    logger.warn(
      `Could not create canon sync PR in ${canonSlug}.\n` +
        `Create it manually with: gh pr create -R ${canonSlug} --base development`,
    );
  }
}

// ────────────────────────────────────────────────────────────────
// Command registration
// ────────────────────────────────────────────────────────────────

export function registerEndCommand(program: Command): void {
  program
    .command('end')
    .description('Finalize current work: create PR with governance references')
    .option('--dry-run', 'Show what would be done without executing')
    .option('--skip-canon-sync', 'Skip canon sync PR generation')
    .option('--title <title>', 'Override PR title')
    .option('--base <branch>', 'Target branch (default: development)')
    .addHelpText(
      'after',
      `
Examples:
  collab end
  collab end --dry-run
  collab end --title "feat: add login page" --base development
  collab end --skip-canon-sync
`,
    )
    .action((options: EndOptions, command: Command) => {
      const context = createCommandContext(command);
      const cwd = context.config.workspaceDir;
      const base = options.base ?? 'development';

      // Validate: collab workspace exists
      if (!fs.existsSync(context.config.configFile)) {
        throw new CliError('Not in a collab workspace. Run collab init first.');
      }

      // Validate: gh CLI available
      if (!hasGhCli()) {
        throw new CliError(
          'GitHub CLI (gh) is required for collab end.\n' +
            'Install it: https://cli.github.com/',
        );
      }

      // Detect context
      const branch = getCurrentBranch(cwd);

      if (branch === 'development' || branch === 'main') {
        throw new CliError(
          `Cannot create PR from "${branch}". Switch to a feature branch first.\n` +
            'Example: git checkout -b feature/42-description',
        );
      }

      const commitLog = getCommitLog(cwd, base);
      if (!commitLog) {
        throw new CliError(`No commits ahead of "${base}". Nothing to create a PR for.`);
      }

      const issueNumber = parseIssueFromBranch(branch);
      const identity = resolveGitHubOwnerRepo(cwd);
      const canonSlug = context.config.canons?.business?.repo;
      const isIndexed = context.config.mode === 'indexed';

      // Build PR title
      const prTitle = options.title ?? (issueNumber
        ? `${branch.replace(/^(feature|fix|refactor|chore|docs|test)\/\d+-?/, '').replace(/-/g, ' ').trim() || `Resolve #${issueNumber}`}`
        : branch.replace(/^(feature|fix|refactor|chore|docs|test)\//, '').replace(/-/g, ' ').trim());

      // Build PR body
      const prBody = buildPrBody({
        issueNumber,
        commitLog,
        canonSlug,
        isIndexed,
      });

      if (options.dryRun) {
        context.logger.info(`[dry-run] Would create PR:`);
        context.logger.info(`  Repo:   ${identity?.slug ?? cwd}`);
        context.logger.info(`  Branch: ${branch} → ${base}`);
        context.logger.info(`  Title:  ${prTitle}`);
        if (issueNumber) context.logger.info(`  Issue:  #${issueNumber}`);
        context.logger.info('');
        context.logger.info('PR body:');
        context.logger.info(prBody);

        if (!options.skipCanonSync && isIndexed && canonSlug) {
          createCanonSyncPr({
            cwd,
            canonSlug,
            repoSlug: identity?.slug ?? '',
            issueNumber,
            branch,

            dryRun: true,
            logger: context.logger,
          });
        }

        return;
      }

      // Create implementation PR
      context.logger.info(`Creating PR: ${branch} → ${base}...`);
      let prResult: string;
      try {
        prResult = execFileSync('gh', [
          'pr', 'create',
          '--base', base,
          '--title', prTitle,
          '--body', prBody,
        ], {
          cwd,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        }).trim();
      } catch {
        throw new CliError(
          `Failed to create PR. Ensure you are authenticated with gh CLI.\n` +
            `Run: gh auth login`,
        );
      }

      context.logger.info(`PR created: ${prResult}`);

      // Canon sync PR (Phase 5)
      if (!options.skipCanonSync && isIndexed && canonSlug) {
        createCanonSyncPr({
          cwd,
          canonSlug,
          repoSlug: identity?.slug ?? '',
          issueNumber,
          branch,
          dryRun: false,
          logger: context.logger,
        });
      }
    });
}
