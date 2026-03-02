import { COMPOSE_ENV_DEFAULTS, COMPOSE_ENV_ORDER } from './compose-defaults';
import { readEnvFile, mergeEnvWithDefaults, writeEnvFile, type EnvMap } from './env-file';
import type { Executor } from './executor';
import type { Logger } from './logger';

export function ensureComposeEnvFile(envFilePath: string, logger: Logger, executor?: Executor): EnvMap {
  const existing = readEnvFile(envFilePath);
  const merged = mergeEnvWithDefaults(existing, COMPOSE_ENV_DEFAULTS);
  writeEnvFile(envFilePath, merged, COMPOSE_ENV_ORDER, executor);

  if (Object.keys(existing).length === 0) {
    logger.info(`Created env file: ${envFilePath}`);
  } else {
    logger.debug(`Updated env file while preserving overrides: ${envFilePath}`);
  }

  return merged;
}
