import { CliError } from './errors';

/** Supported infrastructure types for indexed mode. */
export const INFRA_TYPES = ['local', 'remote'] as const;

/** Union type of all valid infrastructure types. */
export type InfraType = (typeof INFRA_TYPES)[number];

const INFRA_SET = new Set<string>(INFRA_TYPES);

/** Default infra type used when none is explicitly configured. */
export const DEFAULT_INFRA_TYPE: InfraType = 'local';

/** Type guard that checks whether a string is a valid {@link InfraType}. */
export function isInfraType(value: string): value is InfraType {
  return INFRA_SET.has(value);
}

/**
 * Parses an infra-type string from CLI flags or config, returning the fallback
 * when undefined. Throws on invalid values.
 */
export function parseInfraType(
  value: string | undefined,
  fallback: InfraType = DEFAULT_INFRA_TYPE,
): InfraType {
  if (value === undefined) {
    return fallback;
  }

  if (isInfraType(value)) {
    return value;
  }

  throw new CliError(`Invalid infra type '${value}'. Valid values: ${INFRA_TYPES.join(', ')}`);
}

/**
 * Validates and normalises an MCP base URL.
 *
 * - Must start with `http://` or `https://`.
 * - Must be parseable by the URL constructor.
 * - Trailing slashes are stripped from the origin.
 *
 * @returns The normalised base URL (e.g. `http://my-server:7337`).
 */
export function validateMcpUrl(url: string): string {
  const trimmed = url.trim();

  if (!trimmed) {
    throw new CliError('MCP URL cannot be empty.');
  }

  if (!/^https?:\/\//i.test(trimmed)) {
    throw new CliError(`MCP URL must start with http:// or https://. Got: ${trimmed}`);
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new CliError(`Invalid MCP URL: ${trimmed}`);
  }

  // Return origin (scheme + host + port) without trailing path/slash
  return parsed.origin;
}
