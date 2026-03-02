import { run } from './cli';
import { CliError } from './lib/errors';

void run().catch((error: unknown) => {
  if (error instanceof CliError) {
    console.error(error.message);
    process.exitCode = error.exitCode;
    return;
  }

  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
