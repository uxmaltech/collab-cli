import { CliError } from '../lib/errors';
import { runOAuthFlow, saveTokens, getTokenFilePath } from '../lib/oauth';
import type { OrchestrationStage, StageContext } from '../lib/orchestrator';
import { promptChoice, promptMultiSelect, promptText } from '../lib/prompt';
import {
  PROVIDER_DEFAULTS,
  PROVIDER_KEYS,
  autoDetectProviders,
  parseProviderList,
  type AssistantsConfig,
  type AuthMethod,
  type OAuthProviderConfig,
  type ProviderAuthConfig,
  type ProviderConfig,
  type ProviderKey,
} from '../lib/providers';
import { serializeUserConfig } from '../lib/config';

async function configureApiKey(
  provider: ProviderKey,
  ctx: StageContext,
): Promise<ProviderAuthConfig> {
  const defaults = PROVIDER_DEFAULTS[provider];
  const isNonInteractive = Boolean(ctx.options?.yes);

  const envVar = isNonInteractive
    ? defaults.envVar
    : await promptText(`Environment variable for ${defaults.label} API key`, defaults.envVar);

  if (process.env[envVar]) {
    ctx.logger.info(`  ✓ ${envVar} detected in environment`);
  } else {
    ctx.logger.warn(
      `${envVar} is not set in current environment. Set it before running collab commands.`,
    );
  }

  return {
    method: 'api-key',
    envVar,
  };
}

/**
 * Validates that a client_id looks like an OAuth application ID, not an email
 * or other obviously invalid value. OAuth client IDs are assigned by providers
 * when you register an application — they are NOT user emails or API keys.
 */
function validateClientId(clientId: string, providerLabel: string): void {
  // Check for email-like values
  if (clientId.includes('@')) {
    throw new CliError(
      `Invalid OAuth Client ID for ${providerLabel}: "${clientId}" looks like an email address.\n` +
        `A Client ID is an application identifier assigned by the provider when you register an OAuth application.\n` +
        `It is NOT your email, username, or API key.\n\n` +
        `Note: Most providers (OpenAI, Anthropic, Google) require you to register an OAuth application\n` +
        `in their developer portal to obtain a Client ID. For standard API access, use "api-key" auth instead.`,
    );
  }

  // Check for API key-like values (sk-..., anthropic-..., etc.)
  if (/^(sk-|anthropic-|AIza)/.test(clientId)) {
    throw new CliError(
      `Invalid OAuth Client ID for ${providerLabel}: "${clientId.slice(0, 8)}..." looks like an API key.\n` +
        `A Client ID is an application identifier, not a secret key.\n` +
        `If you have an API key, use "api-key" authentication method instead.`,
    );
  }
}

async function configureOAuth(
  provider: ProviderKey,
  ctx: StageContext,
): Promise<ProviderAuthConfig> {
  const defaults = PROVIDER_DEFAULTS[provider];
  const isNonInteractive = Boolean(ctx.options?.yes);
  const isDryRun = ctx.executor.dryRun;

  ctx.logger.warn(
    `OAuth for ${defaults.label} requires a registered OAuth application.\n` +
      `  You must register an app in the provider's developer portal to get a Client ID.\n` +
      `  For standard API usage, "api-key" authentication is simpler and recommended.`,
  );

  // Get client ID
  let clientId: string;
  const clientIdFromEnv = process.env[defaults.oauth.clientIdEnvVar];

  if (isNonInteractive) {
    if (!clientIdFromEnv) {
      throw new CliError(
        `OAuth non-interactive mode requires ${defaults.oauth.clientIdEnvVar} environment variable for ${defaults.label}.\n` +
          `This must be a registered OAuth application Client ID, not an email or API key.`,
      );
    }

    clientId = clientIdFromEnv;
  } else {
    const clientIdDefault = clientIdFromEnv ?? '';
    const hint = clientIdFromEnv
      ? `from ${defaults.oauth.clientIdEnvVar}`
      : `or set ${defaults.oauth.clientIdEnvVar}`;
    clientId = await promptText(
      `OAuth Client ID for ${defaults.label} (registered app ID, ${hint})`,
      clientIdDefault,
    );

    if (!clientId) {
      throw new CliError(`OAuth Client ID is required for ${defaults.label}.`);
    }
  }

  validateClientId(clientId, defaults.label);

  const oauthConfig: OAuthProviderConfig = {
    clientId,
    clientIdEnvVar: clientIdFromEnv ? defaults.oauth.clientIdEnvVar : undefined,
    authorizationUrl: defaults.oauth.authorizationUrl,
    tokenUrl: defaults.oauth.tokenUrl,
    scopes: defaults.oauth.scopes,
    tokenFile: `tokens/${provider}.json`,
  };

  // Run the OAuth flow (skip in dry-run mode)
  if (isDryRun) {
    ctx.logger.info(`  [dry-run] Would run OAuth flow for ${defaults.label}`);
    ctx.logger.info(`    Authorization URL: ${oauthConfig.authorizationUrl}`);
    ctx.logger.info(`    Token URL: ${oauthConfig.tokenUrl}`);
    ctx.logger.info(`    Scopes: ${oauthConfig.scopes.join(', ')}`);
  } else {
    const tokens = await runOAuthFlow(
      {
        provider,
        clientId,
        authorizationUrl: oauthConfig.authorizationUrl,
        tokenUrl: oauthConfig.tokenUrl,
        scopes: oauthConfig.scopes,
      },
      ctx.logger,
    );

    // Save tokens securely
    saveTokens(ctx.config, provider, tokens);
    ctx.logger.info(`  ✓ OAuth tokens saved to ${getTokenFilePath(ctx.config, provider)}`);
  }

  return {
    method: 'oauth',
    oauth: oauthConfig,
  };
}

async function configureProvider(
  provider: ProviderKey,
  ctx: StageContext,
): Promise<ProviderConfig> {
  const defaults = PROVIDER_DEFAULTS[provider];
  const isNonInteractive = Boolean(ctx.options?.yes);

  ctx.logger.info(`\nConfiguring ${defaults.label}...`);

  // Select auth method
  let authMethod: AuthMethod;

  if (isNonInteractive) {
    // In non-interactive mode, use api-key if env var is set, otherwise check for OAuth client ID
    authMethod = process.env[defaults.envVar] ? 'api-key' : 'oauth';
  } else {
    authMethod = await promptChoice<AuthMethod>(
      `Authentication method for ${defaults.label}:`,
      [
        { value: 'api-key', label: 'API Key (environment variable reference)' },
        { value: 'oauth', label: 'OAuth HTTPS (browser-based authorization)' },
      ],
      'api-key',
    );
  }

  // Configure auth
  const auth =
    authMethod === 'oauth'
      ? await configureOAuth(provider, ctx)
      : await configureApiKey(provider, ctx);

  // Select default model
  let model: string;

  if (isNonInteractive) {
    model = defaults.models[0];
  } else {
    model = await promptChoice(
      `Default model for ${defaults.label}:`,
      defaults.models.map((m) => ({ value: m, label: m })),
      defaults.models[0],
    );
  }

  return {
    enabled: true,
    auth,
    model,
  };
}

export const assistantSetupStage: OrchestrationStage = {
  id: 'assistant-setup',
  title: 'Configure AI assistant providers',
  recovery: [
    'Re-run collab init --resume to reconfigure providers.',
    'Ensure required environment variables are set for your chosen providers.',
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
      selectedProviders = autoDetectProviders();

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
      providerConfigs[provider] = await configureProvider(provider, ctx);
    }

    // Mark unselected providers as disabled (preserve any previous config)
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
      const authLabel = cfg.auth.method === 'oauth' ? 'OAuth' : 'API key';
      return `${PROVIDER_DEFAULTS[k].label} (${authLabel}, model: ${cfg.model})`;
    });

    ctx.logger.result(`Configured providers: ${enabledNames.join(', ')}`);
  },
};
