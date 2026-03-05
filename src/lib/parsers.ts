import { CliError } from './errors';
import type { ServiceHealthOptions } from './service-health';

/**
 * Parses a string to a number, returning the fallback when the value
 * is undefined or not a valid integer.
 */
export function parseNumber(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

/**
 * Parses a string to a positive integer, throwing a CliError when the
 * value is present but invalid. Returns the fallback for undefined values.
 */
export function parsePositiveInt(flagName: string, value: string | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new CliError(`${flagName} must be a positive integer.`);
  }

  return parsed;
}

/**
 * Builds a ServiceHealthOptions object from raw CLI option strings.
 */
export function parseHealthOptions(options: {
  timeoutMs?: string;
  retries?: string;
  retryDelayMs?: string;
}): ServiceHealthOptions {
  return {
    timeoutMs: parseNumber(options.timeoutMs, 5_000),
    retries: parseNumber(options.retries, 15),
    retryDelayMs: parseNumber(options.retryDelayMs, 2_000),
  };
}
