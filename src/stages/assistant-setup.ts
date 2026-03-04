import { execSync } from 'node:child_process';

import { detectProviderCli } from '../lib/cli-detection';
import { loadApiKey, saveApiKey } from '../lib/credentials';
import { CliError } from '../lib/errors';
import { listModels, type ModelInfo } from '../lib/model-listing';
import { saveProviderModels } from '../lib/model-registry';
import type { OrchestrationStage, StageContext } from '../lib/orchestrator';
import { promptChoice, promptMultiSelect, promptText } from '../lib/prompt';
import {
  PROVIDER_DEFAULTS,
  PROVIDER_KEYS,
  autoDetectProviders,
  parseProviderList,
  type AssistantsConfig,
  type AuthMethod,
  type ProviderAuthConfig,
  type ProviderConfig,
  type ProviderKey,
} from '../lib/providers';
import { serializeUserConfig } from '../lib/config';

/**
 * Resolves the effective API key for a provider from env var or stored credentials.
 */
function resolveEffectiveKey(provider: ProviderKey, ctx: StageContext): string | null {
  const envKey = process.env[PROVIDER_DEFAULTS[provider].envVar];
  if (envKey) {
    return envKey;
  }

  return loadApiKey(ctx.config, provider);
}

async function configureApiKey(
  provider: ProviderKey,
  ctx: StageContext,
): Promise<ProviderAuthConfig> {
  const defaults = PROVIDER_DEFAULTS[provider];
  const isNonInteractive = Boolean(ctx.options?.yes);
  const envVar = defaults.envVar;

  if (process.env[envVar]) {
    ctx.logger.info(`  \u2713 ${envVar} detected in environment`);

    return { method: 'api-key', envVar };
  }

  // Env var is not set — prompt for API key or let user set it later
  if (isNonInteractive) {
    ctx.logger.warn(
      `${envVar} is not set in current environment. Set it before running collab commands, ` +
        `or run collab init interactively to enter it directly.`,
    );

    return { method: 'api-key', envVar };
  }

  ctx.logger.info(`  ${envVar} is not set in current environment.`);

  const apiKey = await promptText(
    `Enter API key for ${defaults.label} (or leave empty to use ${envVar} env var later)`,
  );

  if (apiKey) {
    // Save the key securely to .collab/credentials.json
    if (!ctx.executor.dryRun) {
      saveApiKey(ctx.config, provider, apiKey);
      ctx.logger.info(`  \u2713 API key saved to .collab/credentials.json`);
    } else {
      ctx.logger.info(`  [dry-run] Would save API key to .collab/credentials.json`);
    }
  } else {
    ctx.logger.warn(
      `No API key provided. Set ${envVar} before running collab commands.`,
    );
  }

  return { method: 'api-key', envVar };
}

/**
 * Queries the provider API for available models, prints a summary,
 * and persists results to the model registry.
 * Returns the model list, or null if the query fails or is skipped.
 */
async function fetchAndShowModels(
  provider: ProviderKey,
  apiKey: string,
  ctx: StageContext,
): Promise<ModelInfo[] | null> {
  try {
    const models = await listModels(provider, apiKey);

    if (models.length === 0) {
      ctx.logger.warn(`  API key accepted but no generative models found.`);
      return null;
    }

    ctx.logger.info(`  \u2713 API key validated \u2014 ${models.length} model(s) available:`);

    for (const m of models) {
      const label = m.name ? `${m.id}  (${m.name})` : m.id;
      ctx.logger.info(`      ${label}`);
    }

    // Persist to model registry for future features
    if (!ctx.executor.dryRun) {
      saveProviderModels(ctx.config, provider, models);
    }

    return models;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    ctx.logger.warn(`  Could not query models: ${message}`);
    ctx.logger.info(`  Falling back to default model list.`);

    return null;
  }
}

/**
 * Selects a model — from the live API list when available, otherwise from hardcoded defaults.
 */
async function selectModel(
  provider: ProviderKey,
  availableModels: ModelInfo[] | null,
  isNonInteractive: boolean,
  cliConfiguredModel?: string,
): Promise<string> {
  const defaults = PROVIDER_DEFAULTS[provider];

  if (isNonInteractive) {
    // Prefer CLI-configured model, then first hardcoded default
    return cliConfiguredModel ?? defaults.models[0];
  }

  if (availableModels && availableModels.length > 0) {
    const defaultSet = new Set(defaults.models);
    const apiIds = new Set(availableModels.map((m) => m.id));
    const byId = new Map(availableModels.map((m) => [m.id, m]));

    const choices: { value: string; label: string }[] = [];

    // If CLI has a configured model not in defaults, add it first
    if (cliConfiguredModel && !defaultSet.has(cliConfiguredModel) && !apiIds.has(cliConfiguredModel)) {
      choices.push({ value: cliConfiguredModel, label: `${cliConfiguredModel} (CLI configured)` });
    }

    // Defaults that are available in the API
    for (const d of defaults.models) {
      if (apiIds.has(d)) {
        const m = byId.get(d)!;
        choices.push({ value: m.id, label: m.name ? `${m.id} \u2014 ${m.name}` : m.id });
      }
    }

    // CLI-configured model from the API list (move to front if found)
    if (cliConfiguredModel && apiIds.has(cliConfiguredModel) && !defaultSet.has(cliConfiguredModel)) {
      const m = byId.get(cliConfiguredModel)!;
      const label = m.name ? `${m.id} \u2014 ${m.name} (CLI configured)` : `${m.id} (CLI configured)`;
      // Insert at beginning
      choices.unshift({ value: m.id, label });
    }

    // Remaining models from the API
    const others = availableModels.filter(
      (m) => !defaultSet.has(m.id) && m.id !== cliConfiguredModel,
    );
    for (const m of others) {
      choices.push({ value: m.id, label: m.name ? `${m.id} \u2014 ${m.name}` : m.id });
    }

    if (choices.length > 0) {
      const defaultChoice = cliConfiguredModel
        ? choices.find((c) => c.value === cliConfiguredModel)?.value ?? choices[0].value
        : choices[0].value;
      return promptChoice(
        `Default model for ${defaults.label}:`,
        choices,
        defaultChoice,
      );
    }

    return availableModels[0].id;
  }

  // Hardcoded fallback — include CLI-configured model if not already in defaults
  const fallbackChoices = [...defaults.models];
  if (cliConfiguredModel && !fallbackChoices.includes(cliConfiguredModel)) {
    fallbackChoices.unshift(cliConfiguredModel);
  }

  const defaultValue = cliConfiguredModel ?? fallbackChoices[0];
  return promptChoice(
    `Default model for ${defaults.label}:`,
    fallbackChoices.map((m) => ({
      value: m,
      label: m === cliConfiguredModel ? `${m} (CLI configured)` : m,
    })),
    defaultValue,
  );
}

/**
 * Configures the Copilot (GitHub) provider.
 * Copilot doesn't use API keys or models — it works via `gh` CLI and GitHub issues.
 * Validates that `gh` is installed and authenticated.
 */
function configureCopilotProvider(ctx: StageContext): ProviderConfig {
  ctx.logger.info(`\nConfiguring ${PROVIDER_DEFAULTS.copilot.label}...`);

  const cli = detectProviderCli('copilot');

  if (!cli.available) {
    // gh not installed or not authenticated
    const ghExists = (() => {
      try {
        const whichCmd = process.platform === 'win32' ? 'where' : 'which';
        execSync(`${whichCmd} gh`, {
          encoding: 'utf8',
          timeout: 3_000,
          stdio: ['ignore', 'pipe', 'ignore'],
        });
        return true;
      } catch {
        return false;
      }
    })();

    if (!ghExists) {
      ctx.logger.warn('  gh CLI not found. Install it from https://cli.github.com/');
      return { enabled: false, auth: { method: 'cli' } };
    }

    // gh exists but not authenticated
    ctx.logger.warn('  gh CLI found but not authenticated. Run: gh auth login');
    return { enabled: false, auth: { method: 'cli' } };
  }

  const ver = cli.version ? ` (${cli.version})` : '';
  ctx.logger.info(`  \u2713 gh CLI detected${ver}`);
  ctx.logger.info(`  \u2713 GitHub authentication verified`);

  return {
    enabled: true,
    auth: { method: 'cli' },
    cli: cli,
  };
}

async function configureProvider(
  provider: ProviderKey,
  ctx: StageContext,
): Promise<ProviderConfig> {
  const defaults = PROVIDER_DEFAULTS[provider];
  const isNonInteractive = Boolean(ctx.options?.yes);

  ctx.logger.info(`\nConfiguring ${defaults.label}...`);

  // Detect official CLI
  const cli = detectProviderCli(provider);

  if (cli.available) {
    const ver = cli.version ? ` (${cli.version})` : '';
    ctx.logger.info(`  \u2713 ${cli.command} CLI detected${ver}`);
  }

  // Determine auth method
  let authMethod: AuthMethod;
  const hasEnvKey = Boolean(process.env[defaults.envVar]);

  if (cli.available && !hasEnvKey) {
    // CLI is available and no env var — offer CLI vs API key choice
    if (isNonInteractive) {
      // Non-interactive: default to CLI when detected and no env var
      authMethod = 'cli';
      ctx.logger.info(`  Using ${cli.command} CLI (no ${defaults.envVar} set).`);
    } else {
      authMethod = await promptChoice<AuthMethod>(
        `Authentication for ${defaults.label}:`,
        [
          { value: 'cli', label: `Use ${cli.command} CLI directly (no API key needed)` },
          { value: 'api-key', label: `Enter API key (${defaults.envVar})` },
        ],
        'cli',
      );
    }
  } else if (cli.available && hasEnvKey) {
    // Both CLI and env var available — let user pick
    if (isNonInteractive) {
      authMethod = 'api-key';
    } else {
      authMethod = await promptChoice<AuthMethod>(
        `Authentication for ${defaults.label}:`,
        [
          { value: 'cli', label: `Use ${cli.command} CLI directly (no API key needed)` },
          { value: 'api-key', label: `API key via ${defaults.envVar} (detected)` },
        ],
        'api-key',
      );
    }
  } else {
    // No CLI — API key is the only option
    authMethod = 'api-key';
  }

  // Configure based on chosen method
  let auth: ProviderAuthConfig;
  let availableModels: ModelInfo[] | null = null;

  if (authMethod === 'cli') {
    auth = { method: 'cli' };
    ctx.logger.info(`  \u2713 Will use ${cli.command} CLI for ${defaults.label}.`);

    if (cli.configuredModel) {
      ctx.logger.info(`  \u2713 CLI configured model: ${cli.configuredModel}`);
    }
  } else {
    auth = await configureApiKey(provider, ctx);

    // Fetch and show models when we have an API key
    const effectiveKey = resolveEffectiveKey(provider, ctx);
    if (effectiveKey && !ctx.executor.dryRun) {
      availableModels = await fetchAndShowModels(provider, effectiveKey, ctx);
    }
  }

  // Model selection — prefer CLI-configured model when using CLI auth
  const cliModel = authMethod === 'cli' ? cli.configuredModel : undefined;
  const model = await selectModel(provider, availableModels, isNonInteractive, cliModel);

  return {
    enabled: true,
    auth,
    model,
    cli: cli.available ? cli : undefined,
  };
}

export const assistantSetupStage: OrchestrationStage = {
  id: 'assistant-setup',
  title: 'Configure AI assistant providers',
  recovery: [
    'Re-run collab init --resume to reconfigure providers.',
    'Ensure required API keys are set (env var or collab init interactive).',
  ],
  run: async (ctx: StageContext) => {
    const isNonInteractive = Boolean(ctx.options?.yes);
    const providersFlag = ctx.options?.providers as string | undefined;

    // Determine which providers to configure
    let selectedProviders: ProviderKey[];

    if (providersFlag) {
      // Explicit --providers flag
      selectedProviders = parseProviderList(providersFlag);
    } else if (isNonInteractive) {
      // Auto-detect from environment variables
      selectedProviders = await autoDetectProviders();

      if (selectedProviders.length === 0) {
        ctx.logger.warn(
          'No AI provider environment variables detected. ' +
            `Set one of: ${PROVIDER_KEYS.map((k) => PROVIDER_DEFAULTS[k].envVar).join(', ')} ` +
            'or use --providers to specify explicitly.',
        );
        ctx.logger.info('Skipping assistant-setup stage (no providers configured).');

        return;
      }

      ctx.logger.info(
        `Auto-detected providers: ${selectedProviders.map((k) => PROVIDER_DEFAULTS[k].label).join(', ')}`,
      );
    } else {
      // Interactive multi-select
      selectedProviders = await promptMultiSelect<ProviderKey>(
        'Select AI providers to configure:',
        PROVIDER_KEYS.map((key) => ({
          value: key,
          label: PROVIDER_DEFAULTS[key].label,
          description: PROVIDER_DEFAULTS[key].description,
        })),
      );
    }

    if (selectedProviders.length === 0) {
      if (providersFlag) {
        // Explicit --providers flag with empty/invalid list: error
        throw new CliError(
          'At least one AI provider must be selected. ' +
            `Available providers: ${PROVIDER_KEYS.join(', ')}`,
        );
      }

      // Interactive with no selection: skip gracefully
      ctx.logger.info('No providers selected. You can configure providers later with collab init --resume.');

      return;
    }

    // Configure each selected provider
    const providerConfigs: Partial<Record<ProviderKey, ProviderConfig>> = {};

    for (const provider of selectedProviders) {
      providerConfigs[provider] =
        provider === 'copilot'
          ? configureCopilotProvider(ctx)
          : await configureProvider(provider, ctx);
    }

    // Mark unselected providers as disabled
    for (const key of PROVIDER_KEYS) {
      if (!selectedProviders.includes(key)) {
        providerConfigs[key] = { enabled: false, auth: { method: 'api-key' } };
      }
    }

    // Persist to config
    const assistants: AssistantsConfig = { providers: providerConfigs };
    ctx.config.assistants = assistants;

    // Write updated config
    ctx.executor.writeFile(
      ctx.config.configFile,
      `${serializeUserConfig(ctx.config)}\n`,
      { description: 'write assistant provider configuration' },
    );

    // Summary
    const enabledNames = selectedProviders.map((k) => {
      const cfg = providerConfigs[k]!;
      const authTag = cfg.auth.method === 'cli' ? `${cfg.cli?.command ?? 'cli'} CLI` : `API key`;
      return `${PROVIDER_DEFAULTS[k].label} (${authTag}, model: ${cfg.model})`;
    });

    ctx.logger.result(`Configured providers: ${enabledNames.join(', ')}`);
  },
};
