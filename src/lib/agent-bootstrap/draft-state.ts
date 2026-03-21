import fs from 'node:fs';
import path from 'node:path';

import type { AuthMethod, ProviderKey } from '../providers';
import type { BirthInterviewMessage } from './chat';
import type { AgentBirthProfile, AgentBootstrapForceMode } from './types';

export interface AgentBirthWizardDraftAnswers {
  agentName?: string;
  agentSlug?: string;
  agentId?: string;
  scope?: string;
  provider?: ProviderKey;
  providerAuthMethod?: AuthMethod;
  model?: string;
  operatorId?: string;
  cognitiveMcpUrl?: string;
  cognitiveMcpApiKey?: string;
  redisUrl?: string;
  redisPassword?: string;
  approvedNamespaces?: string;
  egressUrl?: string[];
  telegramEnabled?: boolean;
  telegramBotToken?: string;
  telegramDefaultChatId?: string;
  telegramThreadId?: string;
  telegramAllowTopicCommands?: boolean;
  telegramWebhookPublicBaseUrl?: string;
  telegramWebhookSecret?: string;
  telegramWebhookBindHost?: string;
  telegramWebhookPort?: string;
  selfRepository?: string;
  assignedRepositories?: string;
  output?: string;
  birthProfile?: Partial<AgentBirthProfile>;
  forceMode?: AgentBootstrapForceMode;
  interviewTranscript?: BirthInterviewMessage[];
}

interface AgentBirthWizardDraftFile {
  version: 1;
  answers: AgentBirthWizardDraftAnswers;
}

const BIRTH_WIZARD_DRAFT_FILE = path.join('.collab', 'agent-birth-wizard.json');

export function buildBirthWizardDraftPath(outputDir: string): string {
  return path.join(outputDir, BIRTH_WIZARD_DRAFT_FILE);
}

export function loadBirthWizardDraft(outputDir: string): AgentBirthWizardDraftAnswers | undefined {
  const draftPath = buildBirthWizardDraftPath(outputDir);

  if (!fs.existsSync(draftPath)) {
    return undefined;
  }

  const raw = fs.readFileSync(draftPath, 'utf8');
  const parsed = JSON.parse(raw) as Partial<AgentBirthWizardDraftFile>;

  if (!parsed || parsed.version !== 1 || !parsed.answers || typeof parsed.answers !== 'object') {
    throw new Error(`Invalid birth wizard draft state at ${draftPath}`);
  }

  return parsed.answers;
}

export function saveBirthWizardDraft(
  outputDir: string,
  answers: AgentBirthWizardDraftAnswers,
): string {
  const draftPath = buildBirthWizardDraftPath(outputDir);
  const payload: AgentBirthWizardDraftFile = {
    version: 1,
    answers,
  };

  fs.mkdirSync(path.dirname(draftPath), { recursive: true });
  fs.writeFileSync(draftPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');

  return draftPath;
}

export function clearBirthWizardDraft(outputDir: string): void {
  const draftPath = buildBirthWizardDraftPath(outputDir);

  if (!fs.existsSync(draftPath)) {
    return;
  }

  fs.rmSync(draftPath, { force: true });
}
