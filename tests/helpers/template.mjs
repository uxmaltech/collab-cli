const TEMPLATE_VAR = /\$\{([A-Z0-9_]+)\}/g;

export function extractTemplateVariables(template) {
  const vars = new Set();
  let match = TEMPLATE_VAR.exec(template);
  while (match) {
    vars.add(match[1]);
    match = TEMPLATE_VAR.exec(template);
  }
  TEMPLATE_VAR.lastIndex = 0;
  return [...vars].sort();
}

export function renderTemplateWithEnv(template, env) {
  return template.replace(/\$\{([A-Z0-9_]+)\}/g, (_full, key) => {
    if (!(key in env)) {
      return '';
    }
    return String(env[key]);
  });
}
