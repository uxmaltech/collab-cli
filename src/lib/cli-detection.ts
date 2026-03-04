import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { ProviderKey } from './providers';

export interface CliInfo {
  command: string;
  available: boolean;
  version?: string;
  configuredModel?: string;
}

/** CLI commands for each provider. */
const CLI_COMMANDS: Record<ProviderKey, string> = {
  codex: 'codex',
  claude: 'claude',
  gemini: 'gemini',
  copilot: 'gh',
};

/**
 * Tries to run `<command> --version` and returns the trimmed stdout.
 * Returns null if the command is not found or fails.
 */
function probeVersion(command: string): string | null {
  try {
    const output = execSync(`${command} --version`, {
      encoding: 'utf8',
      timeout: 5_000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });

    return output.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Checks if a command exists on the system PATH.
 */
function commandExists(command: string): boolean {
  try {
    const whichCmd = process.platform === 'win32' ? 'where' : 'which';
    execSync(`${whichCmd} ${command}`, {
      encoding: 'utf8',
      timeout: 3_000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });

    return true;
  } catch {
    return false;
  }
}

/** Config file paths for each provider CLI (relative to home dir). */
const CLI_CONFIG_PATHS: Record<ProviderKey, string> = {
  codex: '.codex/config.toml',
  claude: '.claude.json',
  gemini: '.gemini/settings.json',
  copilot: '',
};

/**
 * Reads the configured model from a provider's CLI config file.
 * Returns null if the config doesn't exist or can't be parsed.
 */
function readCliConfigModel(provider: ProviderKey): string | null {
  try {
    const configRelPath = CLI_CONFIG_PATHS[provider];
    if (!configRelPath) {
      return null;
    }

    const homeDir = os.homedir();
    const configPath = path.join(homeDir, configRelPath);

    if (!fs.existsSync(configPath)) {
      return null;
    }

    const content = fs.readFileSync(configPath, 'utf8');

    if (provider === 'codex') {
      // TOML: look for top-level `model = "..."` line
      const match = content.match(/^\s*model\s*=\s*"([^"]+)"/m);
      return match?.[1] ?? null;
    }

    // JSON-based configs (claude, gemini)
    const parsed = JSON.parse(content) as { model?: string; defaultModel?: string };
    return parsed.model ?? parsed.defaultModel ?? null;
  } catch {
    return null;
  }
}

/**
 * Checks whether `gh auth status` reports an authenticated session.
 */
export function checkGhAuth(): boolean {
  try {
    execSync('gh auth status', {
      encoding: 'utf8',
      timeout: 5_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Detects whether the official CLI for a provider is installed.
 * Also reads the CLI config to detect the currently configured model.
 *
 * - codex   → `codex` (OpenAI Codex CLI)
 * - claude  → `claude` (Claude Code CLI)
 * - gemini  → `gemini` (Google Gemini CLI)
 * - copilot → `gh` (GitHub CLI with auth)
 */
export function detectProviderCli(provider: ProviderKey): CliInfo {
  const command = CLI_COMMANDS[provider];
  const available = commandExists(command);

  if (!available) {
    return { command, available: false };
  }

  // Copilot requires gh auth — not just gh installed
  if (provider === 'copilot') {
    const authenticated = checkGhAuth();
    if (!authenticated) {
      return { command, available: false };
    }
    const version = probeVersion(command);
    return { command, available: true, version: version ?? undefined };
  }

  const version = probeVersion(command);
  const configuredModel = readCliConfigModel(provider);

  return {
    command,
    available: true,
    version: version ?? undefined,
    configuredModel: configuredModel ?? undefined,
  };
}

/**
 * Detects all provider CLIs at once. Returns a record keyed by provider.
 */
export function detectAllClis(): Record<ProviderKey, CliInfo> {
  return {
    codex: detectProviderCli('codex'),
    claude: detectProviderCli('claude'),
    gemini: detectProviderCli('gemini'),
    copilot: detectProviderCli('copilot'),
  };
}
