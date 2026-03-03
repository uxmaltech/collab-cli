/**
 * ANSI escape code utilities for terminal output.
 * Zero external dependencies — uses raw escape sequences.
 */

const ESC = '\x1b[';
const RESET = `${ESC}0m`;

function supportsColor(): boolean {
  if (process.env['NO_COLOR'] !== undefined) {
    return false;
  }

  if (process.env['FORCE_COLOR'] !== undefined) {
    return true;
  }

  return Boolean(process.stdout.isTTY);
}

const colorEnabled = supportsColor();

function wrap(code: string, text: string): string {
  if (!colorEnabled) {
    return text;
  }

  return `${ESC}${code}m${text}${RESET}`;
}

export function bold(text: string): string {
  return wrap('1', text);
}

export function dim(text: string): string {
  return wrap('2', text);
}

export function green(text: string): string {
  return wrap('32', text);
}

export function red(text: string): string {
  return wrap('31', text);
}

export function yellow(text: string): string {
  return wrap('33', text);
}

export function cyan(text: string): string {
  return wrap('36', text);
}

export function gray(text: string): string {
  return wrap('90', text);
}

export const CHECK = '\u2713';
export const CROSS = '\u2717';
export const BULLET = '\u2022';
