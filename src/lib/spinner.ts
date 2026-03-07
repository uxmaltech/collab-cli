/**
 * Spinner utility wrapping @clack/prompts spinner for long-running operations.
 *
 * Uses the same ESM dynamic-import indirection as prompt.ts.
 * Degrades gracefully in non-TTY environments (logs start/stop messages).
 */

import { dim, green, red, CHECK, CROSS } from './ansi';

// ── Lazy loader for @clack/prompts spinner ───────────────────

type ClackModule = typeof import('@clack/prompts');

// eslint-disable-next-line @typescript-eslint/no-implied-eval
const importClack = new Function('return import("@clack/prompts")') as () => Promise<ClackModule>;

let _clack: ClackModule | null = null;

async function clack(): Promise<ClackModule> {
  if (!_clack) {
    _clack = await importClack();
  }
  return _clack;
}

// ── Public API ───────────────────────────────────────────────

export interface SpinnerHandle {
  /** Update the spinner message while running. */
  message(text: string): void;
  /** Stop with a success indicator. */
  stop(text?: string): void;
  /** Stop with a failure indicator. */
  fail(text?: string): void;
}

/**
 * Start a spinner with an initial message.
 * Returns a handle to update, stop, or fail the spinner.
 *
 * When `quiet` is true, all output is suppressed.
 */
export async function startSpinner(message: string, quiet = false): Promise<SpinnerHandle> {
  if (quiet) {
    return {
      message: () => {},
      stop: () => {},
      fail: () => {},
    };
  }

  const { spinner } = await clack();
  const s = spinner();
  s.start(message);

  return {
    message(text: string) {
      s.message(text);
    },
    stop(text?: string) {
      s.stop(text ?? message);
    },
    fail(text?: string) {
      s.stop(text ?? `${message} failed`);
    },
  };
}

/**
 * Wraps an async operation with a spinner.
 *
 * Shows the spinner during execution, then ✓ on success or ✗ on failure.
 * Returns the operation result or re-throws on error.
 *
 * @param message - Text shown while the operation runs
 * @param fn - The async operation to execute
 * @param quiet - Suppress all output when true (e.g. --quiet flag)
 */
export async function withSpinner<T>(
  message: string,
  fn: (update: (text: string) => void) => Promise<T>,
  quiet = false,
): Promise<T> {
  if (quiet) {
    return fn(() => {});
  }

  // Non-TTY: simple log lines instead of animated spinner
  if (!process.stdout.isTTY) {
    process.stdout.write(`        ${dim('...')} ${message}\n`);
    try {
      const result = await fn(() => {});
      process.stdout.write(`        ${green(CHECK)} ${message}\n`);
      return result;
    } catch (error) {
      process.stdout.write(`        ${red(CROSS)} ${message}\n`);
      throw error;
    }
  }

  const s = await startSpinner(message, quiet);

  try {
    const result = await fn((text) => s.message(text));
    s.stop(message);
    return result;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    s.fail(`${message}: ${detail}`);
    throw error;
  }
}
