import { COMPOSE_ENV_DEFAULTS, COMPOSE_ENV_ORDER } from './compose-defaults';
import { readEnvFile, mergeEnvWithDefaults, writeEnvFile, type EnvMap } from './env-file';
import type { Executor } from './executor';
import type { Logger } from './logger';

export function ensureComposeEnvFile(
  envFilePath: string,
  logger: Logger,
  executor?: Executor,
  overrides?: EnvMap,
  defaults: EnvMap = COMPOSE_ENV_DEFAULTS,
): EnvMap {
  const existing = readEnvFile(envFilePath);
  const merged = mergeEnvWithDefaults(existing, defaults);

  if (overrides) {
    for (const [key, value] of Object.entries(overrides)) {
      merged[key] = value;
    }
  }

  writeEnvFile(envFilePath, merged, COMPOSE_ENV_ORDER, executor);

  if (Object.keys(existing).length === 0) {
    logger.info(
      executor?.dryRun ? `[dry-run] Would create env file: ${envFilePath}` : `Created env file: ${envFilePath}`,
    );
  } else {
    logger.debug(
      executor?.dryRun
        ? `[dry-run] Would update env file while preserving overrides: ${envFilePath}`
        : `Updated env file while preserving overrides: ${envFilePath}`,
    );
  }

  return merged;
}
