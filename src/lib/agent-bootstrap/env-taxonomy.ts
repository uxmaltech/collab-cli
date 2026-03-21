import type { ProviderKey } from '../providers';

export type BirthLlmProvider = 'gemini' | 'openai' | 'xai' | 'anthropic';
const DEFAULT_BIRTH_PROVIDER_ORDER: BirthLlmProvider[] = ['gemini', 'openai', 'anthropic', 'xai'];

export interface BirthLlmTaxonomyEntry {
  label: string;
  apiKeyEnvVar: string;
  apiKeyEnvVars?: string[];
  modelEnvVar: string;
  modelEnvVars?: string[];
  defaultModel?: string;
}

export const BIRTH_LLM_TAXONOMY: Record<BirthLlmProvider, BirthLlmTaxonomyEntry> = {
  gemini: {
    label: 'Gemini',
    apiKeyEnvVar: 'GEMINI_API_KEY',
    modelEnvVar: 'GEMINI_MODEL',
    defaultModel: 'gemini-2.5-pro',
  },
  openai: {
    label: 'OpenAI',
    apiKeyEnvVar: 'OPENAI_API_KEY',
    modelEnvVar: 'OPENAI_MODEL',
    defaultModel: 'gpt-4.1',
  },
  xai: {
    label: 'xAI',
    apiKeyEnvVar: 'XAI_API_KEY',
    modelEnvVar: 'XAI_MODEL',
  },
  anthropic: {
    label: 'Anthropic',
    apiKeyEnvVar: 'ANTHROPIC_API_KEY',
    apiKeyEnvVars: ['ANTHROPIC_API_KEY', 'CLAUDE_API_KEY'],
    modelEnvVar: 'ANTHROPIC_MODEL',
    modelEnvVars: ['ANTHROPIC_MODEL', 'CLAUDE_MODEL'],
    defaultModel: 'claude-sonnet-4-20250514',
  },
};

export interface DetectedBirthLlmProvider {
  provider: BirthLlmProvider;
  apiKeyEnvVar: string;
  apiKey: string;
  modelEnvVar: string;
  model: string;
  label: string;
}

export interface BirthWizardPrevalidation {
  mode: 'structured' | 'conversational';
  selectedProvider?: DetectedBirthLlmProvider;
  reason: string;
}

function resolveFirstEnvValue(envVars: readonly string[]): { envVar: string; value: string } | null {
  for (const envVar of envVars) {
    const value = process.env[envVar]?.trim();
    if (value) {
      return {
        envVar,
        value,
      };
    }
  }

  return null;
}

export function resolveBirthLlmProviderOrder(_provider?: ProviderKey): BirthLlmProvider[] {
  return [...DEFAULT_BIRTH_PROVIDER_ORDER];
}

export function resolveBirthLlmModel(provider: BirthLlmProvider): string | null {
  const entry = BIRTH_LLM_TAXONOMY[provider];
  const model = resolveFirstEnvValue(entry.modelEnvVars ?? [entry.modelEnvVar])?.value;

  if (model) {
    return model;
  }

  return entry.defaultModel ?? null;
}

export function detectBirthLlmProviders(preferredProvider: ProviderKey): DetectedBirthLlmProvider[] {
  const preferred = resolveBirthLlmProviderOrder(preferredProvider);
  const remaining = (Object.keys(BIRTH_LLM_TAXONOMY) as BirthLlmProvider[]).filter(
    (provider) => !preferred.includes(provider),
  );

  return [...preferred, ...remaining]
    .map((provider) => {
      const entry = BIRTH_LLM_TAXONOMY[provider];
      const apiKeyMatch = resolveFirstEnvValue(entry.apiKeyEnvVars ?? [entry.apiKeyEnvVar]);
      const model = resolveBirthLlmModel(provider);

      if (!apiKeyMatch || !model) {
        return null;
      }

      const modelMatch = resolveFirstEnvValue(entry.modelEnvVars ?? [entry.modelEnvVar]);

      return {
        provider,
        apiKeyEnvVar: apiKeyMatch.envVar,
        apiKey: apiKeyMatch.value,
        modelEnvVar: modelMatch?.envVar ?? entry.modelEnvVar,
        model,
        label: entry.label,
      };
    })
    .filter((entry): entry is DetectedBirthLlmProvider => entry !== null);
}

export function prevalidateBirthWizardMode(preferredProvider: ProviderKey): BirthWizardPrevalidation {
  const selectedProvider = detectBirthLlmProviders(preferredProvider)[0];

  if (!selectedProvider) {
    return {
      mode: 'structured',
      reason:
        'No conversational birth provider credentials were found. Falling back to the structured wizard.',
    };
  }

  return {
    mode: 'conversational',
    selectedProvider,
    reason: `Using ${selectedProvider.label} from ${selectedProvider.apiKeyEnvVar} for the conversational birth interview.`,
  };
}
