import type { CollabMode } from '../../lib/mode';
import type { ComposeMode } from '../../lib/compose-paths';
import type { InfraType } from '../../lib/infra-type';
import type { WorkspaceType } from '../../lib/config';

export interface InitOptions {
  force?: boolean;
  yes?: boolean;
  resume?: boolean;
  mode?: string;
  composeMode?: string;
  infraType?: string;
  mcpUrl?: string;
  outputDir?: string;
  repos?: string;
  repo?: string;
  skipMcpSnippets?: boolean;
  skipAnalysis?: boolean;
  skipCi?: boolean;
  skipGithubSetup?: boolean;
  skipIngest?: boolean;
  timeoutMs?: string;
  retries?: string;
  retryDelayMs?: string;
  providers?: string;
  businessCanon?: string;
  githubToken?: string;
}

export interface WizardSelection {
  mode: CollabMode;
  composeMode: ComposeMode;
  infraType: InfraType;
  mcpUrl?: string;
}

export interface WorkspaceResolution {
  name: string;
  type: WorkspaceType;
  repos: string[];
}

export const LOCAL_PATH_RE = /^[/~.]/;
