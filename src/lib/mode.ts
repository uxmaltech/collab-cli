export const COLLAB_MODES = ['file-only', 'indexed'] as const;

export type CollabMode = (typeof COLLAB_MODES)[number];

const MODE_SET = new Set<string>(COLLAB_MODES);

export const DEFAULT_MODE: CollabMode = 'file-only';

export function isCollabMode(value: string): value is CollabMode {
  return MODE_SET.has(value);
}

export function parseMode(value: string | undefined, fallback: CollabMode = DEFAULT_MODE): CollabMode {
  if (value === undefined) {
    return fallback;
  }

  if (isCollabMode(value)) {
    return value;
  }

  throw new Error(`Invalid mode '${value}'. Valid values: ${COLLAB_MODES.join(', ')}`);
}

export function describeMode(mode: CollabMode): string {
  if (mode === 'indexed') {
    return 'indexed (starts infra + MCP and enables retrieval services)';
  }

  return 'file-only (no infra/MCP startup, local file workflow only)';
}
