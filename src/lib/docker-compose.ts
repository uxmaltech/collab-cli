import type { Logger } from './logger';
import { runProcess } from './process';

export interface DockerComposeExecution {
  files: readonly string[];
  arguments: readonly string[];
  cwd: string;
  logger: Logger;
  check?: boolean;
}

function composeArgs(files: readonly string[], args: readonly string[]): string[] {
  const fileArgs = files.flatMap((filePath) => ['-f', filePath]);
  return ['compose', ...fileArgs, ...args];
}

export function runDockerCompose(command: DockerComposeExecution) {
  return runProcess('docker', composeArgs(command.files, command.arguments), command.logger, {
    cwd: command.cwd,
    check: command.check,
  });
}
