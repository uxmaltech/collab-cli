import path from 'node:path';

export function createTestConfig(workspace, overrides = {}) {
  const collabDir = path.join(workspace, '.collab');
  const archDir = path.join(workspace, 'docs', 'architecture');
  const base = {
    workspaceDir: workspace,
    collabDir,
    configFile: path.join(collabDir, 'config.json'),
    stateFile: path.join(collabDir, 'state.json'),
    envFile: path.join(workspace, '.env'),
    mode: 'file-only',
    compose: {
      consolidatedFile: 'docker-compose.yml',
      infraFile: 'docker-compose.infra.yml',
      mcpFile: 'docker-compose.mcp.yml',
    },
    architectureDir: archDir,
    uxmaltechDir: path.join(archDir, 'uxmaltech'),
    repoDir: path.join(archDir, 'repo'),
    aiDir: path.join(workspace, 'docs', 'ai'),
  };

  return {
    ...base,
    ...overrides,
    compose: {
      ...base.compose,
      ...(overrides.compose ?? {}),
    },
  };
}

export function createBufferedLogger(store = []) {
  return {
    verbosity: 'normal',
    info(message) {
      store.push(message);
    },
    debug(message) {
      store.push(message);
    },
    warn(message) {
      store.push(message);
    },
    error(message) {
      store.push(message);
    },
    result(message) {
      store.push(message);
    },
    command(parts) {
      store.push(parts.join(' '));
    },
    stageHeader(index, total, title) {
      store.push(`[${index}/${total}] ${title}`);
    },
    step(ok, message) {
      store.push(`${ok ? '✓' : '✗'} ${message}`);
    },
    workflowHeader(workflow, mode) {
      store.push(`${workflow} — ${mode}`);
    },
    repoHeader(repoName, index, total) {
      store.push(`[repo ${index}/${total}] ${repoName}`);
    },
    phaseHeader(title, subtitle) {
      store.push(subtitle ? `${title} — ${subtitle}` : title);
    },
    wizardStep(current, title, subtitle) {
      const sub = subtitle ? ` · ${subtitle}` : '';
      store.push(`[Step ${current}] ${title}${sub}`);
    },
    wizardIntro(title) {
      store.push(`┌ ${title}`);
    },
    wizardOutro(message) {
      store.push(`└ ${message}`);
    },
    summaryFooter(entries) {
      for (const entry of entries) {
        store.push(`${entry.label}: ${entry.value}`);
      }
    },
  };
}
