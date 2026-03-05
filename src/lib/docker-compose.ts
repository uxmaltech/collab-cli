import type { Executor } from './executor';
import { runProcess } from './process';

export interface DockerComposeExecution {
  executor: Executor;
  files: readonly string[];
  arguments: readonly string[];
  cwd: string;
  check?: boolean;
  /** Docker Compose project name for workspace isolation. */
  projectName?: string;
}

function composeArgs(
  files: readonly string[],
  args: readonly string[],
  projectName?: string,
): string[] {
  const projectArgs = projectName ? ['-p', projectName] : [];
  const fileArgs = files.flatMap((filePath) => ['-f', filePath]);
  return ['compose', ...projectArgs, ...fileArgs, ...args];
}

export function runDockerCompose(command: DockerComposeExecution) {
  return runProcess(
    command.executor,
    'docker',
    composeArgs(command.files, command.arguments, command.projectName),
    {
      cwd: command.cwd,
      check: command.check,
    },
  );
}
