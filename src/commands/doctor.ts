import { Command } from 'commander';

export function registerDoctorCommand(program: Command): void {
  program
    .command('doctor')
    .description('Run basic environment diagnostics')
    .action(() => {
      console.log('collab-cli diagnostics');
      console.log(`node: ${process.version}`);
      console.log(`platform: ${process.platform}/${process.arch}`);
    });
}
