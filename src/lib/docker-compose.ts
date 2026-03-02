import type { Executor } from './executor';
import { runProcess } from './process';

export interface DockerComposeExecution {
  executor: Executor;
  files: readonly string[];
  arguments: readonly string[];
  cwd: string;
  check?: boolean;
}

function composeArgs(files: readonly string[], args: readonly string[]): string[] {
  const fileArgs = files.flatMap((filePath) => ['-f', filePath]);
  return ['compose', ...fileArgs, ...args];
}

export function runDockerCompose(command: DockerComposeExecution) {
  return runProcess(command.executor, 'docker', composeArgs(command.files, command.arguments), {
    cwd: command.cwd,
    check: command.check,
  });
}
