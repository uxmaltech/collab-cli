import fs from 'node:fs';
import path from 'node:path';

import type { CollabConfig } from './config';

export interface GeneratedFileState {
  hash: string;
  generatedAt: string;
}

export interface CollabState {
  generatedFiles: Record<string, GeneratedFileState>;
}

const EMPTY_STATE: CollabState = {
  generatedFiles: {},
};

export function loadState(config: CollabConfig): CollabState {
  if (!fs.existsSync(config.stateFile)) {
    return { ...EMPTY_STATE };
  }

  const raw = fs.readFileSync(config.stateFile, 'utf8');
  const parsed = JSON.parse(raw) as Partial<CollabState>;

  return {
    generatedFiles: parsed.generatedFiles ?? {},
  };
}

export function saveState(config: CollabConfig, state: CollabState): void {
  fs.mkdirSync(path.dirname(config.stateFile), { recursive: true });
  fs.writeFileSync(config.stateFile, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

export function toStateKey(config: CollabConfig, filePath: string): string {
  const relative = path.relative(config.workspaceDir, filePath);
  return relative === '' ? path.basename(filePath) : relative;
}
