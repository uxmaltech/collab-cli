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

type ClackModule = typeof import('@clack/prompts');

let _clack: ClackModule | null = null;

async function clack(): Promise<ClackModule> {
  if (!_clack) {
    _clack = await import('@clack/prompts');
  }
  return _clack;
}

// ── Prompt functions ────────────────────────────────────────────

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
