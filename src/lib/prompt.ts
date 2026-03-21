/**
 * Prompt functions wrapping @clack/prompts for a modern CLI experience.
 *
 * @clack/prompts is ESM-only, so we use dynamic import() since the
 * project compiles to CommonJS. The module is loaded once and cached.
 */

export interface Choice<T extends string> {
  value: T;
  label: string;
  description?: string;
}

// ── Lazy loader for @clack/prompts ──────────────────────────────
//
// Use a runtime-native dynamic import indirection so that TypeScript
// (when compiling to CommonJS) does not downlevel import() into require().
// A bare `await import(...)` would be rewritten to `require(...)` by tsc,
// which throws ERR_REQUIRE_ESM for ESM-only packages.

type ClackModule = typeof import('@clack/prompts');

// eslint-disable-next-line @typescript-eslint/no-implied-eval
const importClack = new Function('return import("@clack/prompts")') as () => Promise<ClackModule>;

let _clack: ClackModule | null = null;

/**
 * Lazily loads the `@clack/prompts` module and returns a cached instance for subsequent calls.
 *
 * @returns The imported clack prompts module.
 */
async function clack(): Promise<ClackModule> {
  if (!_clack) {
    _clack = await importClack();
  }
  return _clack;
}

/**
 * Prompt the user to select a single option from the provided choices.
 *
 * If the user cancels the prompt, the process exits with code 0.
 *
 * @param question - The message displayed to the user
 * @param choices - Available selectable options with value, label, and optional description
 * @param defaultValue - The value that will be initially selected
 * @returns The selected choice value of type `T`
 */
export async function promptChoice<T extends string>(
  question: string,
  choices: readonly Choice<T>[],
  defaultValue: T,
): Promise<T> {
  const { select, isCancel } = await clack();

  const result = await select({
    message: question,
    options: choices.map((c) => ({
      value: c.value,
      label: c.label,
      hint: c.description,
    })),
    initialValue: defaultValue,
  });

  if (isCancel(result)) {
    process.exit(0);
  }

  return result;
}

/**
 * Prompt the user to confirm a yes/no question.
 *
 * @param question - The message shown to the user
 * @param defaultValue - The initial selected value when the prompt opens
 * @returns `true` if the user confirmed, `false` otherwise
 */
export async function promptBoolean(
  question: string,
  defaultValue: boolean,
): Promise<boolean> {
  const { confirm, isCancel } = await clack();

  const result = await confirm({
    message: question,
    initialValue: defaultValue,
  });

  if (isCancel(result)) {
    process.exit(0);
  }

  return result;
}

/**
 * Prompts the user to select one or more options from a list.
 *
 * If the user cancels the prompt, the process exits with code 0.
 *
 * @param question - The message shown to the user
 * @param choices - The available options (each with `value`, `label`, and optional `description` used as a hint)
 * @param defaults - Values that should be initially selected
 * @returns The array of selected values
 */
export async function promptMultiSelect<T extends string>(
  question: string,
  choices: readonly Choice<T>[],
  defaults: readonly T[] = [],
): Promise<T[]> {
  const { multiselect, isCancel } = await clack();

  const result = await multiselect({
    message: question,
    options: choices.map((c) => ({
      value: c.value,
      label: c.label,
      hint: c.description,
    })),
    initialValues: [...defaults],
    required: false,
  });

  if (isCancel(result)) {
    process.exit(0);
  }

  return result;
}

/**
 * Prompts the user for a line of text, optionally using a provided default.
 *
 * @param question - The message displayed to the user
 * @param defaultValue - Optional placeholder shown in the prompt and used as a fallback when the user submits no input
 * @returns The entered text, or `defaultValue` if the user submits nothing, or an empty string if neither is provided
 */
export async function promptText(question: string, defaultValue?: string): Promise<string> {
  const { text, isCancel } = await clack();

  const result = await text({
    message: question,
    placeholder: defaultValue,
    defaultValue,
  });

  if (isCancel(result)) {
    process.exit(0);
  }

  return result || defaultValue || '';
}

/**
 * Prompts the user to enter a password and returns the entered value.
 *
 * If the user cancels the prompt, the process exits with code 0.
 *
 * @returns The entered password string.
 */
export async function promptPassword(question: string): Promise<string> {
  const { password, isCancel } = await clack();

  const result = await password({
    message: question,
  });

  if (isCancel(result)) {
    process.exit(0);
  }

  return result;
}
