import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import type { Platform } from './types';

export function detectPlatform(repoDir: string): Platform {
  const has = (file: string): boolean => existsSync(path.join(repoDir, file));

  const readJson = (file: string): Record<string, unknown> | null => {
    try {
      return JSON.parse(readFileSync(path.join(repoDir, file), 'utf8')) as Record<string, unknown>;
    } catch {
      return null;
    }
  };

  // PHP / Laravel
  if (has('composer.json')) {
    const composer = readJson('composer.json');
    const deps: Record<string, unknown> = {
      ...(composer?.require as Record<string, unknown> | undefined),
      ...(composer?.['require-dev'] as Record<string, unknown> | undefined),
    };
    if (deps['laravel/framework'] || deps['laravel/lumen-framework']) {
      return 'laravel';
    }
    return 'php';
  }

  // Node / JavaScript / TypeScript
  if (has('package.json')) {
    return 'node';
  }

  // Kotlin / Android / JVM
  if (
    has('build.gradle') ||
    has('build.gradle.kts') ||
    has('settings.gradle') ||
    has('settings.gradle.kts')
  ) {
    return 'kotlin';
  }

  // Swift / iOS / macOS
  const hasExtension = (ext: string): boolean => {
    try {
      return readdirSync(repoDir).some((f) => f.endsWith(ext));
    } catch {
      return false;
    }
  };
  if (has('Package.swift') || hasExtension('.xcodeproj') || hasExtension('.xcworkspace')) {
    return 'swift';
  }

  return 'unknown';
}
