import type { Executor } from './executor';
import { resolveCommandPath } from './shell';

export interface DaemonCheckResult {
  ok: boolean;
  version?: string;
  error?: string;
}

export interface ImageCheckResult {
  image: string;
  ok: boolean;
  error?: string;
}

/**
 * Checks whether the Docker daemon is running and returns its server version.
 */
export function checkDockerDaemon(executor: Executor): DaemonCheckResult {
  const dockerPath = resolveCommandPath('docker');
  if (!dockerPath) {
    return { ok: false, error: 'docker command not found in PATH' };
  }

  if (executor.dryRun) {
    return { ok: true, version: 'dry-run' };
  }

  const result = executor.run('docker', ['info', '--format', '{{.ServerVersion}}'], {
    check: false,
    verboseOnly: true,
  });

  if (result.status === 0 && result.stdout.trim()) {
    return { ok: true, version: result.stdout.trim() };
  }

  const stderr = result.stderr.trim();
  if (/cannot connect to.*docker daemon|is the docker daemon running/i.test(stderr)) {
    return { ok: false, error: 'Docker daemon is not running. Start Docker Desktop or run: sudo systemctl start docker' };
  }

  return { ok: false, error: stderr || 'Docker daemon check failed' };
}

/**
 * Checks whether Docker images are locally available.
 *
 * Uses `docker image inspect` to check local presence only — avoids
 * network calls that may fail behind firewalls or require authentication.
 */
export function checkDockerImages(
  executor: Executor,
  images: readonly string[],
): ImageCheckResult[] {
  const dockerPath = resolveCommandPath('docker');
  if (!dockerPath) {
    return images.map((image) => ({
      image,
      ok: false,
      error: 'docker command not found',
    }));
  }

  return images.map((image) => {
    if (executor.dryRun) {
      return { image, ok: true };
    }

    const result = executor.run('docker', ['image', 'inspect', image, '--format', '{{.Id}}'], {
      check: false,
      verboseOnly: true,
    });

    if (result.status === 0 && result.stdout.trim()) {
      return { image, ok: true };
    }

    const stderr = result.stderr.trim();

    // Distinguish daemon/auth errors from genuine "image not found"
    if (/cannot connect to.*docker daemon|is the docker daemon running/i.test(stderr)) {
      return {
        image,
        ok: false,
        error: 'Docker daemon is not running. Start Docker Desktop or run: sudo systemctl start docker',
      };
    }

    return {
      image,
      ok: false,
      error: /no such image|not found/i.test(stderr)
        ? `Image not found locally. Pull with: docker pull ${image}`
        : (stderr || `docker image inspect failed for ${image}`),
    };
  });
}
