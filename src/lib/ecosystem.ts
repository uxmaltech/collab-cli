import fs from 'node:fs';
import path from 'node:path';

import semver from 'semver';

import type { CollabConfig } from './config';
import { checkHttpHealth } from './health-checker';

export interface EcosystemManifest {
  manifestVersion: string;
  cliVersionRange: string;
  collabArchitectureSchemaRange: string;
  collabArchitectureMcpVersionRange: string;
  collabArchitectureMcpContractRange: string;
}

export interface EcosystemCheck {
  id: string;
  ok: boolean;
  detail: string;
  fix?: string;
}

const MANIFEST_PATH = path.resolve(__dirname, '../../ecosystem.manifest.json');

function readJsonFile<T>(targetFile: string): T | null {
  try {
    const raw = fs.readFileSync(targetFile, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function readManifest(): EcosystemManifest {
  const manifest = readJsonFile<EcosystemManifest>(MANIFEST_PATH);
  if (!manifest) {
    return {
      manifestVersion: '1.0.0',
      cliVersionRange: '>=0.1.0',
      collabArchitectureSchemaRange: '^1.0.0',
      collabArchitectureMcpVersionRange: '^0.1.0',
      collabArchitectureMcpContractRange: '^1.0.0',
    };
  }

  return manifest;
}

function readCliVersion(): string {
  const packagePath = path.resolve(__dirname, '../../package.json');
  const pkg = readJsonFile<{ version?: string }>(packagePath);
  return pkg?.version ?? '0.0.0';
}

function findSchemaVersionFile(config: CollabConfig): string | null {
  const envOverride = process.env.COLLAB_ARCHITECTURE_SCHEMA_PATH;
  if (envOverride && fs.existsSync(envOverride)) {
    return path.resolve(envOverride);
  }

  const candidates = [
    path.resolve(config.workspaceDir, '../collab-architecture/schema/version.json'),
    path.resolve(config.workspaceDir, 'collab-architecture/schema/version.json'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

export async function checkEcosystemCompatibility(
  config: CollabConfig,
  options: { dryRun?: boolean; mcpHealthUrl?: string } = {},
): Promise<EcosystemCheck[]> {
  const manifest = readManifest();
  const checks: EcosystemCheck[] = [];

  const cliVersion = readCliVersion();
  const cliCompatible = semver.satisfies(cliVersion, manifest.cliVersionRange, {
    includePrerelease: true,
  });
  checks.push({
    id: 'cli-version',
    ok: cliCompatible,
    detail: `CLI ${cliVersion} vs required ${manifest.cliVersionRange}`,
    fix: `Upgrade collab-cli to satisfy ${manifest.cliVersionRange}.`,
  });

  const schemaFile = findSchemaVersionFile(config);
  if (!schemaFile) {
    checks.push({
      id: 'canon-schema-version',
      ok: false,
      detail: 'schema/version.json not found for collab-architecture',
      fix: 'Clone collab-architecture next to this workspace or set COLLAB_ARCHITECTURE_SCHEMA_PATH.',
    });
  } else {
    const schema = readJsonFile<{ schemaVersion?: string; minCompatibleCLI?: string }>(schemaFile);
    const schemaVersion = schema?.schemaVersion ?? '0.0.0';
    const schemaCompatible = semver.satisfies(schemaVersion, manifest.collabArchitectureSchemaRange, {
      includePrerelease: true,
    });

    checks.push({
      id: 'canon-schema-version',
      ok: schemaCompatible,
      detail: `schema ${schemaVersion} vs required ${manifest.collabArchitectureSchemaRange}`,
      fix: 'Update collab-architecture to a compatible schema version.',
    });

    if (schema?.minCompatibleCLI) {
      const minCliCompatible = semver.gte(cliVersion, schema.minCompatibleCLI);
      checks.push({
        id: 'canon-min-cli',
        ok: minCliCompatible,
        detail: `CLI ${cliVersion} vs schema minCompatibleCLI ${schema.minCompatibleCLI}`,
        fix: `Upgrade collab-cli to >= ${schema.minCompatibleCLI}.`,
      });
    }
  }

  const mcpHealthUrl =
    options.mcpHealthUrl ??
    `http://${process.env.MCP_HOST || '127.0.0.1'}:${process.env.MCP_PORT || '7337'}/health`;

  const mcpHealth = await checkHttpHealth('mcp-health', mcpHealthUrl, {
    retries: 1,
    timeoutMs: 3_000,
    retryDelayMs: 0,
    dryRun: options.dryRun,
  });

  if (!mcpHealth.ok || mcpHealth.skipped) {
    checks.push({
      id: 'mcp-version',
      ok: Boolean(mcpHealth.skipped),
      detail: mcpHealth.skipped
        ? 'skipped in dry-run mode'
        : `MCP health endpoint unreachable (${mcpHealth.error ?? mcpHealth.detail})`,
      fix: 'Start MCP service and retry doctor or compatibility checks.',
    });
  } else {
    try {
      const response = await fetch(mcpHealthUrl);
      const payload = (await response.json()) as { version?: string; contractVersion?: string };
      const mcpVersion = payload.version ?? '0.0.0';
      const contractVersion = payload.contractVersion ?? '0.0.0';

      checks.push({
        id: 'mcp-version',
        ok: semver.satisfies(mcpVersion, manifest.collabArchitectureMcpVersionRange, {
          includePrerelease: true,
        }),
        detail: `MCP ${mcpVersion} vs required ${manifest.collabArchitectureMcpVersionRange}`,
        fix: 'Upgrade/downgrade collab-architecture-mcp to a compatible version.',
      });

      checks.push({
        id: 'mcp-contract-version',
        ok: semver.satisfies(contractVersion, manifest.collabArchitectureMcpContractRange, {
          includePrerelease: true,
        }),
        detail: `MCP contract ${contractVersion} vs required ${manifest.collabArchitectureMcpContractRange}`,
        fix: 'Upgrade collab-architecture-mcp or update compatibility manifest.',
      });
    } catch (error: unknown) {
      checks.push({
        id: 'mcp-version',
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
        fix: 'Verify MCP /health endpoint returns JSON with version and contractVersion.',
      });
    }
  }

  return checks;
}
