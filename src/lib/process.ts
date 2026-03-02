import type { Executor } from './executor';

export interface RunProcessOptions {
  cwd?: string;
  check?: boolean;
  verboseOnly?: boolean;
}

export interface RunProcessResult {
  status: number;
  stdout: string;
  stderr: string;
  command: string;
  simulated: boolean;
}

export function runProcess(
  executor: Executor,
  commandName: string,
  args: readonly string[],
  options: RunProcessOptions = {},
): RunProcessResult {
  return executor.run(commandName, args, options);
}
