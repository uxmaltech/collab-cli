import path from 'node:path';

import { createFirstAvailableClient, type AiMessage } from '../lib/ai-client';
import { isCanonsAvailable, resolveCanonFile, syncCanons } from '../lib/canon-resolver';
import type { OrchestrationStage } from '../lib/orchestrator';
import { getEnabledProviders, type ProviderKey } from '../lib/providers';
import { buildUserMessage, extractJson, generateAiHelpers, writeAnalysisResults, type AnalysisResult } from '../lib/repo-analysis-helpers';
import { scanRepository } from '../lib/repo-scanner';

/**
 * Checks if copilot is the only enabled provider.
 * Copilot doesn't support AI completion — skip analysis in that case.
 */
function onlyCopilotEnabled(providers: ProviderKey[]): boolean {
  return providers.length === 1 && providers[0] === 'copilot';
}

export const repoAnalysisFileOnlyStage: OrchestrationStage = {
  id: 'repo-analysis-fileonly',
  title: 'AI-powered repository analysis',
  recovery: [
    'Ensure AI provider API keys are set, or configure a CLI provider (codex, claude, gemini).',
    'Run collab init --resume to retry repository analysis.',
  ],
  run: async (ctx) => {
    if (ctx.options?.skipAnalysis) {
      ctx.logger.info('Skipping repository analysis by user choice.');
      return;
    }

    const enabledProviders = getEnabledProviders(ctx.config);
    if (enabledProviders.length === 0 || onlyCopilotEnabled(enabledProviders)) {
      ctx.logger.info('No AI-capable providers enabled; skipping repository analysis.');

      // Still scan repo for basic AI helper files
      const repoCtx = scanRepository(ctx.config.workspaceDir);
      generateAiHelpers(ctx, repoCtx, {});
      return;
    }

    if (ctx.executor.dryRun) {
      ctx.logger.info('[dry-run] Would analyze repository and generate architecture files.');
      return;
    }

    const client = createFirstAvailableClient(enabledProviders, ctx.config, ctx.logger);
    if (!client) {
      ctx.logger.warn(
        'No AI provider credentials or CLI available; generating basic AI helpers only.',
      );
      const repoCtx = scanRepository(ctx.config.workspaceDir);
      generateAiHelpers(ctx, repoCtx, {});
      return;
    }

    // Load system prompt from canons (should already exist from canon-sync stage)
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
        'System prompt not found in canons. Run "collab update-canons" to refresh. Skipping analysis.',
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

    // Write debug prompt
    const promptDebugPath = path.join(ctx.config.collabDir, `init-prompt-${client.provider}-cli.md`);
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

    let analysis: AnalysisResult;
    try {
      const jsonStr = extractJson(response);
      analysis = JSON.parse(jsonStr);
    } catch (err) {
      ctx.logger.warn(`Failed to parse AI analysis response: ${err}`);
      ctx.logger.debug(`Raw response (first 500 chars): ${response.slice(0, 500)}`);
      // Still generate AI helpers with empty analysis
      generateAiHelpers(ctx, repoCtx, {});
      return;
    }

    // File-only mode writes to repoDir (docs/architecture/repo/)
    writeAnalysisResults(ctx, ctx.config.repoDir, analysis);

    // Generate docs/ai/ helper files
    generateAiHelpers(ctx, repoCtx, analysis);
  },
};
