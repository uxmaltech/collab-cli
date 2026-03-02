import fs from 'node:fs';
import path from 'node:path';

import type { CollabConfig } from './config';
import type { Executor } from './executor';

export interface GeneratedFileState {
  hash: string;
  generatedAt: string;
}

export interface WorkflowFailureState {
  stage: string;
  message: string;
  command?: string;
  stderr?: string;
  recovery: string[];
  failedAt: string;
}

export interface WorkflowRunState {
  completedStages: string[];
  updatedAt: string;
  failure?: WorkflowFailureState;
}

export interface CollabState {
  generatedFiles: Record<string, GeneratedFileState>;
  workflows: Record<string, WorkflowRunState>;
}

const EMPTY_STATE: CollabState = {
  generatedFiles: {},
  workflows: {},
};

export function loadState(config: CollabConfig): CollabState {
  if (!fs.existsSync(config.stateFile)) {
    return { ...EMPTY_STATE };
  }

  const raw = fs.readFileSync(config.stateFile, 'utf8');
  const parsed = JSON.parse(raw) as Partial<CollabState>;

  return {
    generatedFiles: parsed.generatedFiles ?? {},
    workflows: parsed.workflows ?? {},
  };
}

export function saveState(config: CollabConfig, state: CollabState, executor?: Executor): void {
  const content = `${JSON.stringify(state, null, 2)}\n`;

  if (executor) {
    executor.writeFile(config.stateFile, content, { description: 'write state file' });
    return;
  }

  fs.mkdirSync(path.dirname(config.stateFile), { recursive: true });
  fs.writeFileSync(config.stateFile, content, 'utf8');
}

export function toStateKey(config: CollabConfig, filePath: string): string {
  const relative = path.relative(config.workspaceDir, filePath);
  return relative === '' ? path.basename(filePath) : relative;
}
