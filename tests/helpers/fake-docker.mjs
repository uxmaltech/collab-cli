import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function createFakeDockerEnv(options = {}) {
  const composeExitCode = options.composeExitCode ?? 0;
  const dockerVersion = options.dockerVersion ?? 'Docker version 0.0.0';
  const composeVersion = options.composeVersion ?? 'Docker Compose version v2.0.0';

  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'collab-cli-bin-'));
  const dockerPath = path.join(binDir, 'docker');

  fs.writeFileSync(
    dockerPath,
    `#!/bin/sh
if [ "$1" = "compose" ] && [ "$2" = "version" ]; then
  echo "${composeVersion}"
  exit 0
fi
if [ "$1" = "compose" ]; then
  exit ${composeExitCode}
fi
echo "${dockerVersion}"
exit 0
`,
    'utf8',
  );
  fs.chmodSync(dockerPath, 0o755);

  return {
    ...process.env,
    PATH: `${binDir}:${process.env.PATH || ''}`,
  };
}
