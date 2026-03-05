import { CliError } from './errors';

/** Supported execution modes for the collab workspace. */
export const COLLAB_MODES = ['file-only', 'indexed'] as const;

/** Union type of all valid execution modes. */
export type CollabMode = (typeof COLLAB_MODES)[number];

const MODE_SET = new Set<string>(COLLAB_MODES);

/** Default mode used when none is explicitly configured. */
export const DEFAULT_MODE: CollabMode = 'file-only';

/** Type guard that checks whether a string is a valid {@link CollabMode}. */
export function isCollabMode(value: string): value is CollabMode {
  return MODE_SET.has(value);
}

/**
 * Parses a mode string from CLI flags or config, returning the fallback
 * when undefined. Throws on invalid values.
 */
export function parseMode(value: string | undefined, fallback: CollabMode = DEFAULT_MODE): CollabMode {
  if (value === undefined) {
    return fallback;
  }

  if (isCollabMode(value)) {
    return value;
  }

  throw new CliError(`Invalid mode '${value}'. Valid values: ${COLLAB_MODES.join(', ')}`);
}

/** Returns a human-readable description of a mode. */
export function describeMode(mode: CollabMode): string {
  if (mode === 'indexed') {
    return 'indexed (starts infra + MCP and enables retrieval services)';
  }

  return 'file-only (no infra/MCP startup, local file workflow only)';
}
