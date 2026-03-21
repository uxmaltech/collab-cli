import { CliError } from './errors';

export type ForceModeSet = readonly string[];

export function parseForceMode<TModes extends ForceModeSet>(
  value: string | undefined,
  allowedModes: TModes,
  commandLabel = 'command',
): TModes[number] | undefined {
  if (value === undefined) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0) {
    return undefined;
  }

  if (allowedModes.includes(normalized)) {
    return normalized as TModes[number];
  }

  throw new CliError(
    `Invalid force mode '${value}' for ${commandLabel}. Use one of: ${allowedModes.join(', ')}.`,
  );
}

export function formatForceModeList(allowedModes: ForceModeSet): string {
  return allowedModes.join('|');
}
