import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

interface Choice<T extends string> {
  value: T;
  label: string;
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
