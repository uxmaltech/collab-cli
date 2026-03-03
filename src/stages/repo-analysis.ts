import path from 'node:path';

import { createFirstAvailableClient, type AiMessage } from '../lib/ai-client';
import { isCanonsAvailable, resolveCanonFile, syncCanons } from '../lib/canon-resolver';
import type { OrchestrationStage } from '../lib/orchestrator';
import { getEnabledProviders } from '../lib/providers';
import { buildUserMessage, extractJson, writeAnalysisResults, type AnalysisResult } from '../lib/repo-analysis-helpers';
import { scanRepository } from '../lib/repo-scanner';

export const repoAnalysisStage: OrchestrationStage = {
  id: 'repo-analysis',
  title: 'AI-powered repository analysis',
  recovery: [
    'Ensure AI provider API keys are set in environment, or configure a CLI provider (codex, claude, gemini).',
    'Run collab init --resume to retry repository analysis.',
  ],
  run: async (ctx) => {
    if (ctx.options?.skipAnalysis) {
      ctx.logger.info('Skipping repository analysis by user choice.');
      return;
    }

    const enabledProviders = getEnabledProviders(ctx.config);
    if (enabledProviders.length === 0) {
      ctx.logger.info('No providers enabled; skipping repository analysis.');
      return;
    }

    // In dry-run mode, just show what would happen
    if (ctx.executor.dryRun) {
      ctx.logger.info('[dry-run] Would analyze repository and generate architecture files.');
      return;
    }

    const client = createFirstAvailableClient(enabledProviders, ctx.config, ctx.logger);
    if (!client) {
      ctx.logger.warn(
        'No AI provider credentials or CLI available; skipping repository analysis. ' +
          'Set an API key or configure a CLI provider to enable analysis.',
      );
      return;
    }

    // Load system prompt from canons — auto-clone if missing
    if (!isCanonsAvailable()) {
      ctx.logger.info('Canons not installed. Downloading collab-architecture...');
      const ok = syncCanons((msg) => ctx.logger.info(msg));
      if (!ok || !isCanonsAvailable()) {
        ctx.logger.warn('Failed to download canons. Skipping repository analysis.');
        return;
      }
    }

    const systemPrompt = resolveCanonFile('prompts/init/system-prompt.md');
    if (!systemPrompt) {
      ctx.logger.warn(
        'System prompt not found in canons (prompts/init/system-prompt.md). Run "collab update-canons" to refresh. Skipping repository analysis.',
      );
      return;
    }

    ctx.logger.info('Scanning repository structure...');
    const repoCtx = scanRepository(ctx.config.workspaceDir);

    ctx.logger.info(
      `Repository: ${repoCtx.name} (${repoCtx.language}${repoCtx.framework ? ` / ${repoCtx.framework}` : ''}, ${repoCtx.totalSourceFiles} source files)`,
    );

    const messages: AiMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: buildUserMessage(repoCtx) },
    ];

    // Write the init prompt to .collab/ for debugging and tracking
    const promptDebugPath = path.join(
      ctx.config.workspaceDir,
      '.collab',
      `init-prompt-${client.provider}-cli.md`,
    );
    const promptContent = [
      `# Init Prompt — ${client.provider} CLI`,
      `<!-- Generated: ${new Date().toISOString()} -->`,
      '',
      '## System Prompt',
      '',
      messages[0].content,
      '',
      '## User Prompt',
      '',
      messages[1].content,
      '',
    ].join('\n');
    ctx.executor.ensureDirectory(path.dirname(promptDebugPath));
    ctx.executor.writeFile(promptDebugPath, promptContent, {
      description: `write init prompt debug file for ${client.provider}`,
    });

    ctx.logger.info('Analyzing repository with AI provider...');
    const response = await client.complete(messages, { maxTokens: 8192 });

    // Parse the response
    let analysis: AnalysisResult;
    try {
      const jsonStr = extractJson(response);
      analysis = JSON.parse(jsonStr);
    } catch (err) {
      ctx.logger.warn(`Failed to parse AI analysis response: ${err}`);
      ctx.logger.debug(`Raw response (first 500 chars): ${response.slice(0, 500)}`);
      return;
    }

    // Indexed mode writes to architectureDir
    writeAnalysisResults(ctx, ctx.config.architectureDir, analysis);
  },
};
