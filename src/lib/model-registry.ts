import fs from 'node:fs';
import path from 'node:path';

import type { CollabConfig } from './config';
import type { ModelInfo } from './model-listing';
import type { ProviderKey } from './providers';

export interface ProviderModelEntry {
  queriedAt: string;
  models: ModelInfo[];
}

export interface ModelRegistry {
  updatedAt: string;
  providers: Partial<Record<ProviderKey, ProviderModelEntry>>;
}

export function getRegistryPath(config: CollabConfig): string {
  return path.join(config.collabDir, 'models.json');
}

/**
 * Loads the full model registry. Returns an empty registry if the file
 * does not exist or cannot be parsed.
 */
export function loadRegistry(config: CollabConfig): ModelRegistry {
  const registryPath = getRegistryPath(config);

  if (!fs.existsSync(registryPath)) {
    return { updatedAt: new Date().toISOString(), providers: {} };
  }

  try {
    const raw = fs.readFileSync(registryPath, 'utf8');
    return JSON.parse(raw) as ModelRegistry;
  } catch {
    return { updatedAt: new Date().toISOString(), providers: {} };
  }
}

/**
 * Saves model listing results for a provider into the registry.
 * Merges with existing entries for other providers.
 */
export function saveProviderModels(
  config: CollabConfig,
  provider: ProviderKey,
  models: ModelInfo[],
): void {
  const registry = loadRegistry(config);
  const now = new Date().toISOString();

  registry.updatedAt = now;
  registry.providers[provider] = {
    queriedAt: now,
    models,
  };

  const registryPath = getRegistryPath(config);
  fs.mkdirSync(path.dirname(registryPath), { recursive: true });
  fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2), 'utf8');
}

/**
 * Loads stored models for a single provider.
 * Returns null if no entry exists.
 */
export function loadProviderModels(
  config: CollabConfig,
  provider: ProviderKey,
): ProviderModelEntry | null {
  const registry = loadRegistry(config);
  return registry.providers[provider] ?? null;
}
