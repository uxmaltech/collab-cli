/**
 * Type declarations for @clack/prompts (ESM-only package).
 * Used with dynamic import() since the project compiles to CommonJS.
 */
declare module '@clack/prompts' {
  export interface SelectOption<T> {
    value: T;
    label: string;
    hint?: string;
  }

  export function select<T>(opts: {
    message: string;
    options: SelectOption<T>[];
    initialValue?: T;
  }): Promise<T | symbol>;

  export function multiselect<T>(opts: {
    message: string;
    options: SelectOption<T>[];
    initialValues?: T[];
    required?: boolean;
  }): Promise<T[] | symbol>;

  export function confirm(opts: {
    message: string;
    initialValue?: boolean;
  }): Promise<boolean | symbol>;

  export function text(opts: {
    message: string;
    placeholder?: string;
    defaultValue?: string;
    validate?: (value: string) => string | void;
  }): Promise<string | symbol>;

  export function password(opts: {
    message: string;
    validate?: (value: string) => string | void;
  }): Promise<string | symbol>;

  export function isCancel(value: unknown): value is symbol;

  export function intro(title?: string): void;
  export function outro(message?: string): void;

  export function spinner(): {
    start: (msg?: string) => void;
    stop: (msg?: string) => void;
    message: (msg?: string) => void;
  };

  export function note(message: string, title?: string): void;

  export const log: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
    step: (msg: string) => void;
    success: (msg: string) => void;
    message: (msg: string) => void;
  };
}
