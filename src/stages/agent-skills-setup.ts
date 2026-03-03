import fs from 'node:fs';
import path from 'node:path';

import { resolveCanonFile } from '../lib/canon-resolver';
import type { OrchestrationStage, StageContext } from '../lib/orchestrator';
import { getEnabledProviders, type ProviderKey } from '../lib/providers';

/**
 * Agent prompt files from collab-architecture/prompts/agents/.
 * Each entry maps a skill name to its canon path.
 */
const AGENT_PROMPTS: { name: string; description: string; canonPath: string }[] = [
  {
    name: 'phase-1-survey',
    description: 'GOV-R-001 Phase 1 — Explore codebase, map files, check duplication, propose design.',
    canonPath: 'prompts/agents/phase-1-survey.md',
  },
  {
    name: 'phase-2-change-plan',
    description: 'GOV-R-001 Phase 2 — Produce a detailed implementation plan for the change.',
    canonPath: 'prompts/agents/phase-2-change-plan.md',
  },
  {
    name: 'phase-3-implementation',
    description: 'GOV-R-001 Phase 3 — Execute the implementation following the approved change plan.',
    canonPath: 'prompts/agents/phase-3-implementation.md',
  },
  {
    name: 'phase-4-repo-hygiene',
    description: 'GOV-R-001 Phase 4 — Verify repo hygiene: tests, lint, docs, dead code.',
    canonPath: 'prompts/agents/phase-4-repo-hygiene.md',
  },
  {
    name: 'phase-5-canon-sync',
    description: 'GOV-R-001 Phase 5 — Sync changes back to canonical architecture.',
    canonPath: 'prompts/agents/phase-5-canon-sync.md',
  },
  {
    name: 'architecture-reviewer',
    description: 'Thematic agent — Reviews code against canonical rules and patterns.',
    canonPath: 'prompts/agents/architecture-reviewer.md',
  },
  {
    name: 'drift-detector',
    description: 'Thematic agent — Detects drift between code and canonical architecture.',
    canonPath: 'prompts/agents/drift-detector.md',
  },
  {
    name: 'pattern-extractor',
    description: 'Thematic agent — Extracts reusable patterns from implementation.',
    canonPath: 'prompts/agents/pattern-extractor.md',
  },
];

/**
 * Generates Agent Skills Spec SKILL.md files for Claude, Codex, and Gemini.
 * Format: .agents/skills/<name>/SKILL.md with YAML frontmatter.
 */
function generateAgentSkillsSpec(ctx: StageContext): number {
  const skillsBaseDir = path.join(ctx.config.workspaceDir, '.agents', 'skills');
  let written = 0;

  for (const agent of AGENT_PROMPTS) {
    const content = resolveCanonFile(agent.canonPath);
    if (!content) {
      ctx.logger.debug(`Skipping skill ${agent.name}: prompt not found at ${agent.canonPath}`);
      continue;
    }

    const skillDir = path.join(skillsBaseDir, agent.name);
    const skillFile = path.join(skillDir, 'SKILL.md');

    // Don't overwrite existing skill files
    if (fs.existsSync(skillFile)) {
      ctx.logger.debug(`Skill already exists, skipping: ${agent.name}`);
      continue;
    }

    const skillContent = [
      '---',
      `name: ${agent.name}`,
      `description: "${agent.description}"`,
      '---',
      '',
      content,
    ].join('\n');

    ctx.executor.ensureDirectory(skillDir);
    ctx.executor.writeFile(skillFile, skillContent, {
      description: `write agent skill ${agent.name}`,
    });
    written++;
  }

  return written;
}

/**
 * Generates GitHub Copilot instruction files.
 * - .github/copilot-instructions.md — global instructions
 * - .github/instructions/<name>.instructions.md — per-agent instructions
 */
function generateCopilotInstructions(ctx: StageContext): number {
  const githubDir = path.join(ctx.config.workspaceDir, '.github');
  const instructionsDir = path.join(githubDir, 'instructions');
  let written = 0;

  // Global instructions file
  const globalFile = path.join(githubDir, 'copilot-instructions.md');
  if (!fs.existsSync(globalFile)) {
    const globalContent = [
      '# Copilot Instructions',
      '',
      'This project follows the Collab architectural governance process (GOV-R-001).',
      'Use the per-agent instruction files in `.github/instructions/` for phase-specific guidance.',
      '',
      '## Governance Phases',
      '',
      '1. Survey — Map files, check duplication, propose design',
      '2. Change Plan — Detailed implementation plan',
      '3. Implementation — Execute the plan',
      '4. Repo Hygiene — Tests, lint, docs, dead code',
      '5. Canon Sync — Update canonical architecture',
      '',
      '## Architecture Sources',
      '',
      '- `docs/architecture/uxmaltech/` — Institutional canon',
      '- `docs/architecture/repo/` — Project-specific canons',
      '- `docs/ai/` — Quick reference helpers',
      '',
    ].join('\n');

    ctx.executor.ensureDirectory(githubDir);
    ctx.executor.writeFile(globalFile, globalContent, {
      description: 'write Copilot global instructions',
    });
    written++;
  }

  // Per-agent instruction files
  for (const agent of AGENT_PROMPTS) {
    const content = resolveCanonFile(agent.canonPath);
    if (!content) {
      continue;
    }

    const instrFile = path.join(instructionsDir, `${agent.name}.instructions.md`);
    if (fs.existsSync(instrFile)) {
      ctx.logger.debug(`Copilot instruction already exists, skipping: ${agent.name}`);
      continue;
    }

    const instrContent = [
      '---',
      'applyTo: "**"',
      '---',
      '',
      content,
    ].join('\n');

    ctx.executor.ensureDirectory(instructionsDir);
    ctx.executor.writeFile(instrFile, instrContent, {
      description: `write Copilot instruction ${agent.name}`,
    });
    written++;
  }

  return written;
}

/**
 * Generates a CLAUDE.md file at repo root with architecture context.
 */
function generateClaudeMd(ctx: StageContext): boolean {
  const claudeFile = path.join(ctx.config.workspaceDir, 'CLAUDE.md');

  if (fs.existsSync(claudeFile)) {
    ctx.logger.debug('CLAUDE.md already exists, skipping.');
    return false;
  }

  const content = [
    '# Claude Code — Architecture Context',
    '',
    'This project follows the Collab architectural governance process (GOV-R-001).',
    '',
    '## Architecture Sources',
    '',
    '- `docs/architecture/uxmaltech/` — Institutional canon (collab-architecture)',
    '- `docs/architecture/repo/` — Project-specific canons and decisions',
    '- `docs/ai/` — Quick reference helpers (brief, domain map, module map)',
    '',
    '## Agent Skills',
    '',
    'Agent skills are defined in `.agents/skills/` following the Agent Skills Spec.',
    'Each skill maps to a GOV-R-001 governance phase or thematic agent.',
    '',
    '## Governance Workflow',
    '',
    'All changes must follow the five-phase governance process:',
    '',
    '1. **Survey** — Map files, check duplication, propose design',
    '2. **Change Plan** — Detailed implementation plan with acceptance criteria',
    '3. **Implementation** — Execute following the approved plan',
    '4. **Repo Hygiene** — Verify tests, lint, docs, dead code removal',
    '5. **Canon Sync** — Update canonical architecture documentation',
    '',
    '## Rules',
    '',
    '- Read `docs/architecture/uxmaltech/governance/` for full governance rules',
    '- Check `docs/architecture/repo/` for project-specific decisions and conventions',
    '- Use `docs/ai/00_brief.md` for a quick project overview',
    '',
  ].join('\n');

  ctx.executor.writeFile(claudeFile, content, {
    description: 'write CLAUDE.md architecture context',
  });

  return true;
}

export const agentSkillsSetupStage: OrchestrationStage = {
  id: 'agent-skills-setup',
  title: 'Generate agent skill files',
  recovery: [
    'Ensure canons are available (run collab update-canons).',
    'Run collab init --resume to retry agent skills setup.',
  ],
  run: (ctx) => {
    const enabledProviders = getEnabledProviders(ctx.config);
    if (enabledProviders.length === 0) {
      ctx.logger.info('No providers configured; skipping agent skills setup.');
      return;
    }

    const hasSkillsProvider = enabledProviders.some((p) => p !== 'copilot');
    const hasCopilot = enabledProviders.includes('copilot');
    const hasClaude = enabledProviders.includes('claude');

    let totalWritten = 0;

    // Agent Skills Spec for Claude, Codex, and Gemini
    if (hasSkillsProvider) {
      const count = generateAgentSkillsSpec(ctx);
      totalWritten += count;
      if (count > 0) {
        ctx.logger.info(`Agent Skills Spec: ${count} SKILL.md file(s) written to .agents/skills/.`);
      }
    }

    // Copilot instructions
    if (hasCopilot) {
      const count = generateCopilotInstructions(ctx);
      totalWritten += count;
      if (count > 0) {
        ctx.logger.info(`Copilot instructions: ${count} file(s) written to .github/.`);
      }
    }

    // CLAUDE.md for Claude provider
    if (hasClaude) {
      const wrote = generateClaudeMd(ctx);
      if (wrote) {
        totalWritten++;
        ctx.logger.info('CLAUDE.md written at repo root.');
      }
    }

    if (totalWritten === 0) {
      ctx.logger.info('All agent skill files already exist; nothing to write.');
    }
  },
};
