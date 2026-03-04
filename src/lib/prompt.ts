import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

export interface Choice<T extends string> {
  value: T;
  label: string;
  description?: string;
}

export async function promptChoice<T extends string>(
  question: string,
  choices: readonly Choice<T>[],
  defaultValue: T,
): Promise<T> {
  const rl = readline.createInterface({ input, output });

  try {
    const menu = choices
      .map((choice, index) => {
        const marker = choice.value === defaultValue ? ' (default)' : '';
        return `${index + 1}. ${choice.label}${marker}`;
      })
      .join('\n');

    const answer = await rl.question(`${question}\n${menu}\n> `);
    const trimmed = answer.trim();

    if (!trimmed) {
      return defaultValue;
    }

    const index = Number.parseInt(trimmed, 10);
    if (!Number.isNaN(index) && index >= 1 && index <= choices.length) {
      return choices[index - 1].value;
    }

    const byValue = choices.find((choice) => choice.value === trimmed);
    if (byValue) {
      return byValue.value;
    }

    return defaultValue;
  } finally {
    rl.close();
  }
}

export async function promptBoolean(
  question: string,
  defaultValue: boolean,
): Promise<boolean> {
  const rl = readline.createInterface({ input, output });

  try {
    const suffix = defaultValue ? '[Y/n]' : '[y/N]';
    const answer = await rl.question(`${question} ${suffix} `);
    const trimmed = answer.trim().toLowerCase();

    if (!trimmed) {
      return defaultValue;
    }

    if (trimmed === 'y' || trimmed === 'yes') {
      return true;
    }

    if (trimmed === 'n' || trimmed === 'no') {
      return false;
    }

    return defaultValue;
  } finally {
    rl.close();
  }
}

export async function promptMultiSelect<T extends string>(
  question: string,
  choices: readonly Choice<T>[],
  defaults: readonly T[] = [],
): Promise<T[]> {
  const rl = readline.createInterface({ input, output });

  try {
    const defaultSet = new Set<string>(defaults);
    const menu = choices
      .map((choice, index) => {
        const marker = defaultSet.has(choice.value) ? ' (default)' : '';
        const desc = choice.description ? ` — ${choice.description}` : '';
        return `${index + 1}. ${choice.label}${desc}${marker}`;
      })
      .join('\n');

    const hint = 'Enter numbers separated by commas, * for all, or empty for defaults';
    const answer = await rl.question(`${question}\n${menu}\n(${hint})\n> `);
    const trimmed = answer.trim();

    if (!trimmed) {
      return defaults.length > 0 ? [...defaults] : [];
    }

    if (trimmed === '*') {
      return choices.map((c) => c.value);
    }

    const selected: T[] = [];
    const parts = trimmed.split(',').map((p) => p.trim());

    for (const part of parts) {
      const index = Number.parseInt(part, 10);
      if (!Number.isNaN(index) && index >= 1 && index <= choices.length) {
        const value = choices[index - 1].value;
        if (!selected.includes(value)) {
          selected.push(value);
        }

        continue;
      }

      const byValue = choices.find((c) => c.value === part);
      if (byValue && !selected.includes(byValue.value)) {
        selected.push(byValue.value);
      }
    }

    return selected.length > 0 ? selected : defaults.length > 0 ? [...defaults] : [];
  } finally {
    rl.close();
  }
}

export async function promptText(question: string, defaultValue?: string): Promise<string> {
  const rl = readline.createInterface({ input, output });

  try {
    const suffix = defaultValue ? ` (${defaultValue})` : '';
    const answer = await rl.question(`${question}${suffix}\n> `);
    const trimmed = answer.trim();

    return trimmed || defaultValue || '';
  } finally {
    rl.close();
  }
}

export async function promptPassword(question: string): Promise<string> {
  const rl = readline.createInterface({ input, output });

  try {
    const answer = await rl.question(`${question}\n> `);
    return answer;
  } finally {
    rl.close();
  }
}
