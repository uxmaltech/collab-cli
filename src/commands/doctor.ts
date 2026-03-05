import fs from 'node:fs';

import { Command } from 'commander';

import { createCommandContext } from '../lib/command-context';
import { COMPOSE_ENV_DEFAULTS } from '../lib/compose-defaults';
import { getComposeFilePaths } from '../lib/compose-paths';
import { validateComposeFiles } from '../lib/compose-validator';
import { checkDockerDaemon, checkDockerImages } from '../lib/docker-checks';
import { checkEcosystemCompatibility } from '../lib/ecosystem';
import { CliError } from '../lib/errors';
import { loadRuntimeEnv, waitForInfraHealth, waitForMcpHealth } from '../lib/service-health';
import { runPreflightChecks } from '../lib/preflight';

interface DoctorCheck {
  id: string;
  ok: boolean;
  detail: string;
  fix?: string;
}

function printCheck(check: DoctorCheck): void {
  const prefix = check.ok ? '[PASS]' : '[FAIL]';
  process.stdout.write(`${prefix} ${check.id}: ${check.detail}\n`);
  if (!check.ok && check.fix) {
    process.stdout.write(`       fix: ${check.fix}\n`);
  }
}

export function registerDoctorCommand(program: Command): void {
  program
    .command('doctor')
    .description('Run diagnostics across system, infra, MCP, config, and versions')
    .addHelpText(
      'after',
      `
Examples:
  collab doctor
  collab doctor --verbose
`,
    )
    .action(async (_options: unknown, command: Command) => {
      const context = createCommandContext(command);
      const checks: DoctorCheck[] = [];

      checks.push({
        id: 'workspace',
        ok: true,
        detail: context.config.workspaceDir,
      });

      const preflight = runPreflightChecks(context.executor);
      checks.push(
        ...preflight.map((item) => ({
          id: `system:${item.id}`,
          ok: item.ok,
          detail: item.detail,
          fix: item.fix,
        })),
      );

      // ── Docker daemon check ───────────────────────────────
      const dockerBinaryOk = preflight.find((item) => item.id === 'docker')?.ok ?? false;
      const daemonResult = checkDockerDaemon(context.executor);
      const daemonFix = !dockerBinaryOk
        ? 'Install Docker Desktop or Docker Engine.'
        : 'Start Docker Desktop or run: sudo systemctl start docker';
      checks.push({
        id: 'docker:daemon',
        ok: daemonResult.ok,
        detail: daemonResult.ok
          ? `Docker daemon v${daemonResult.version}`
          : (daemonResult.error ?? 'Docker daemon unavailable'),
        fix: daemonFix,
      });

      // ── Docker image checks ────────────────────────────────
      const env = loadRuntimeEnv(context.config);
      const imagesToCheck = [
        env.MCP_IMAGE || COMPOSE_ENV_DEFAULTS.MCP_IMAGE,
        env.QDRANT_IMAGE || COMPOSE_ENV_DEFAULTS.QDRANT_IMAGE,
      ];
      const imageResults = checkDockerImages(context.executor, imagesToCheck);
      for (const img of imageResults) {
        checks.push({
          id: `docker:image:${img.image.split('/').pop()?.split(':')[0] ?? img.image}`,
          ok: img.ok,
          detail: img.ok ? `${img.image} available locally` : (img.error ?? `${img.image} not found`),
          fix: img.error && !/not found locally/i.test(img.error)
            ? img.error
            : `Pull with: docker pull ${img.image}`,
        });
      }

      const envFileExists = fs.existsSync(context.config.envFile);
      checks.push({
        id: 'config:env-file',
        ok: envFileExists,
        detail: envFileExists ? `${context.config.envFile} found` : `${context.config.envFile} missing`,
        fix: 'Run collab init or collab compose generate to create .env defaults.',
      });

      const composePaths = getComposeFilePaths(context.config);
      const composeCandidates = [composePaths.consolidated, composePaths.infra, composePaths.mcp].filter((p) =>
        fs.existsSync(p),
      );

      if (composeCandidates.length === 0) {
        checks.push({
          id: 'config:compose-files',
          ok: false,
          detail: 'No compose files found in workspace.',
          fix: 'Run collab compose generate first.',
        });
      } else {
        const errors = validateComposeFiles(composeCandidates, context.config.workspaceDir, context.executor);
        checks.push({
          id: 'config:compose-files',
          ok: errors.length === 0,
          detail:
            errors.length === 0
              ? `${composeCandidates.length} compose file(s) validated`
              : `${errors.length} compose validation error(s)` ,
          fix: 'Run collab compose validate to inspect exact compose errors.',
        });
      }

      const infraHealth = await waitForInfraHealth(env, {
        timeoutMs: 2_000,
        retries: 1,
        retryDelayMs: 0,
        dryRun: context.executor.dryRun,
      });
      checks.push({
        id: 'infra:qdrant-nebula',
        ok: infraHealth.ok,
        detail: infraHealth.ok
          ? infraHealth.checks.join('; ')
          : infraHealth.errors.join('; '),
        fix: 'Run collab infra up and verify ports in .env.',
      });

      const mcpHealth = await waitForMcpHealth(env, {
        timeoutMs: 2_000,
        retries: 1,
        retryDelayMs: 0,
        dryRun: context.executor.dryRun,
      });
      checks.push({
        id: 'mcp:health',
        ok: mcpHealth.ok,
        detail: mcpHealth.ok ? mcpHealth.checks.join('; ') : mcpHealth.errors.join('; '),
        fix: 'Run collab mcp start and verify MCP_PORT/MCP_HOST in .env.',
      });

      const compatibility = await checkEcosystemCompatibility(context.config, {
        dryRun: context.executor.dryRun,
      });
      checks.push(
        ...compatibility.map((item) => ({
          id: `version:${item.id}`,
          ok: item.ok,
          detail: item.detail,
          fix: item.fix,
        })),
      );

      process.stdout.write(`node: ${process.version}\n`);
      process.stdout.write(`platform: ${process.platform}/${process.arch}\n`);
      process.stdout.write(`docker: ${daemonResult.version ?? 'not available'}\n`);
      for (const check of checks) {
        printCheck(check);
      }

      const failed = checks.filter((item) => !item.ok);
      if (failed.length > 0) {
        throw new CliError(`Doctor found ${failed.length} failing check(s).`);
      }
    });
}
