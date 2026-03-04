import { generateCanonScaffold } from '../lib/canon-scaffold';
import type { OrchestrationStage } from '../lib/orchestrator';

export const canonScaffoldStage: OrchestrationStage = {
  id: 'canon-scaffold',
  title: 'Generate canonical architecture scaffold',
  recovery: [
    'Verify write permissions for docs/architecture directory.',
    'Run collab init --resume to retry scaffold generation.',
  ],
  run: (ctx) => {
    generateCanonScaffold(ctx);
  },
};
