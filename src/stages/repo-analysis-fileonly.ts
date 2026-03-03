import path from 'node:path';

import { createFirstAvailableClient, type AiMessage } from '../lib/ai-client';
import { isCanonsAvailable, resolveCanonFile, syncCanons } from '../lib/canon-resolver';
import type { OrchestrationStage, StageContext } from '../lib/orchestrator';
import { getEnabledProviders, type ProviderKey } from '../lib/providers';
import { buildUserMessage, extractJson, writeAnalysisResults, type AnalysisResult } from '../lib/repo-analysis-helpers';
import { scanRepository, type RepoContext } from '../lib/repo-scanner';

/**
 * Generates docs/ai/ helper files for fast agent reference.
 * These are lightweight summaries that prevent agents from scanning the full architecture tree.
 */
function generateAiHelpers(ctx: StageContext, repoCtx: RepoContext, analysis: AnalysisResult): void {
  const aiDir = ctx.config.aiDir;
  ctx.executor.ensureDirectory(aiDir);

  // 00_brief.md — one-paragraph project summary
  const briefContent = [
    '# Project Brief',
    '',
    `**Name:** ${repoCtx.name}`,
    `**Language:** ${repoCtx.language}`,
    repoCtx.framework ? `**Framework:** ${repoCtx.framework}` : null,
    `**Source files:** ${repoCtx.totalSourceFiles}`,
    '',
    '## Summary',
    '',
    `This is a ${repoCtx.language}${repoCtx.framework ? ` / ${repoCtx.framework}` : ''} project` +
      ` with ${repoCtx.totalSourceFiles} source files.`,
    '',
    '<!-- AI-GENERATED -->',
    '',
  ].filter((l) => l !== null).join('\n');

  ctx.executor.writeFile(path.join(aiDir, '00_brief.md'), briefContent, {
    description: 'write AI helper: project brief',
  });

  // 01_domain_map.md — domain index
  const domainLines: string[] = ['# Domain Map', ''];

  if (analysis.domains && analysis.domains.length > 0) {
    for (const d of analysis.domains) {
      domainLines.push(`## ${d.name}`);
      domainLines.push('');
      if (d.responsibilities) {
        domainLines.push(`**Responsibilities:** ${d.responsibilities}`);
      }
      if (d.boundaries) {
        domainLines.push(`**Boundaries:** ${d.boundaries}`);
      }
      domainLines.push('');
    }
  } else {
    domainLines.push('_No domains detected yet. Run repository analysis with an AI provider._');
    domainLines.push('');
  }

  domainLines.push('<!-- AI-GENERATED -->');
  domainLines.push('');
  ctx.executor.writeFile(path.join(aiDir, '01_domain_map.md'), domainLines.join('\n'), {
    description: 'write AI helper: domain map',
  });

  // 02_module_map.md — key files and structure
  const moduleLines: string[] = [
    '# Module Map',
    '',
    '## Key Files',
    '',
    ...repoCtx.keyFiles.map((f) => `- \`${f}\``),
    '',
    '## Directory Structure',
    '',
    '```',
    repoCtx.structure,
    '```',
    '',
    '## Dependencies',
    '',
    ...(repoCtx.dependencies.length > 0
      ? repoCtx.dependencies.map((d) => `- ${d}`)
      : ['_No dependencies detected._']),
    '',
    '<!-- AI-GENERATED -->',
    '',
  ];

  ctx.executor.writeFile(path.join(aiDir, '02_module_map.md'), moduleLines.join('\n'), {
    description: 'write AI helper: module map',
  });

  // _snapshot.md — quick-reference index linking to the other files
  const snapshotLines = [
    '# Architecture Snapshot',
    '',
    `Generated: ${new Date().toISOString().split('T')[0]}`,
    '',
    '## Quick Links',
    '',
    '- [Project Brief](./00_brief.md)',
    '- [Domain Map](./01_domain_map.md)',
    '- [Module Map](./02_module_map.md)',
    '',
    '## Architecture Sources',
    '',
    '- `docs/architecture/uxmaltech/` — Institutional canon (collab-architecture copy)',
    '- `docs/architecture/repo/` — Project-specific canons',
    '',
    '<!-- AI-GENERATED -->',
    '',
  ];

  ctx.executor.writeFile(path.join(aiDir, '_snapshot.md'), snapshotLines.join('\n'), {
    description: 'write AI helper: snapshot index',
  });

  ctx.logger.info(`AI helpers: 4 file(s) written to docs/ai/.`);
}

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
