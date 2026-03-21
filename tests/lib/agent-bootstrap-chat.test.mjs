import assert from 'node:assert/strict';
import test from 'node:test';

const {
  createBirthDraftAssistant,
  createBirthInterviewAssistant,
} = await import('../../dist/lib/agent-bootstrap/chat.js');
const {
  buildBirthInterviewSystemPrompt,
} = await import('../../dist/lib/agent-bootstrap/birth-interview-skill.js');

function createLoggerCapture() {
  const messages = {
    info: [],
    thoughts: [],
    interviews: [],
    debug: [],
    warn: [],
    error: [],
    result: [],
  };

  return {
    logger: {
      verbosity: 'normal',
      info(message) {
        messages.info.push(message);
      },
      debug(message) {
        messages.debug.push(message);
      },
      warn(message) {
        messages.warn.push(message);
      },
      error(message) {
        messages.error.push(message);
      },
      result(message) {
        messages.result.push(message);
      },
      assistantThought(provider, title, body) {
        messages.thoughts.push({ provider, title, body });
      },
      assistantMessage(provider, message) {
        messages.interviews.push({ provider, message });
      },
      command() {},
      stageHeader() {},
      step() {},
      workflowHeader() {},
      repoHeader() {},
      phaseHeader() {},
      wizardStep() {},
      wizardIntro() {},
      wizardOutro() {},
      summaryFooter() {},
    },
    messages,
  };
}

function createOptions(overrides = {}) {
  return {
    cwd: process.cwd(),
    outputDir: process.cwd(),
    agentName: 'IoT Agent',
    agentSlug: 'iot-agent',
    agentId: 'agent.iot-agent',
    scope: 'anystream.iot',
    runtimeSource: 'https://github.com/uxmaltech/collab-agent-runtime',
    provider: 'codex',
    providerAuthMethod: 'cli',
    providerCli: {
      provider: 'codex',
      command: 'codex',
      available: true,
      version: 'codex-cli 0.116.0',
      configuredModel: 'gpt-5.4',
    },
    operatorId: 'operator.iot-agent',
    operatorIds: ['operator.iot-agent'],
    cognitiveMcpUrl: 'http://127.0.0.1:8787/mcp',
    redisUrl: 'redis://127.0.0.1:6379',
    approvedNamespaces: ['context.*', 'agent.*'],
    operatorNamespaces: ['admin.recovery.*'],
    egressUrls: ['*'],
    selfRepository: 'anystream/iot-development-agent',
    assignedRepositories: ['anystream/balena-ws-player'],
    birthProfile: {
      purpose: 'Build IoT software.',
      personaRole: 'IoT engineer',
      personaTone: 'Direct',
      personaSummary: 'Focused on IoT delivery.',
      soulMission: 'Ship robust IoT changes.',
      soulEthos: 'Prefer clarity.',
      soulGuardrails: ['Do not leak secrets.'],
      systemPrompt: 'Operate as an IoT engineer.',
      styleRules: ['Be direct.'],
      workStylePlanningMode: 'Plan before edit.',
      workStyleApprovalPosture: 'Escalate risky changes.',
      workStyleCollaborationStyle: 'Report progress.',
    },
    overwriteExistingManagedFiles: false,
    restartWizardFromScratch: false,
    json: false,
    telemetryEnabled: true,
    operatorProfileEnabled: true,
    ...overrides,
  };
}

test('createBirthDraftAssistant deduplicates repeated Gemini thought titles and returns the final JSON payload', async (t) => {
  const savedApiKey = process.env.GEMINI_API_KEY;
  const savedModel = process.env.GEMINI_MODEL;
  process.env.GEMINI_API_KEY = 'gemini-key';
  process.env.GEMINI_MODEL = 'gemini-2.5-pro';

  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    const payload = JSON.parse(init.body);
    assert.equal(payload.generationConfig.thinkingConfig.includeThoughts, true);
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            'data: {"candidates":[{"content":{"parts":[{"thought":true,"text":"**Planning the profile**\\nMap the repositories to a concrete operating role."}]}}]}\n\n',
          ),
        );
        controller.enqueue(
          new TextEncoder().encode(
            'data: {"candidates":[{"content":{"parts":[{"thought":true,"text":"**Planning the profile**\\nReconfirm the same thought title should not print twice."}]}}]}\n\n',
          ),
        );
        controller.enqueue(
          new TextEncoder().encode(
            'data: {"candidates":[{"content":{"parts":[{"text":"{\\"purpose\\":\\"Deliver IoT work.\\",\\"personaRole\\":\\"Senior IoT Engineer\\"}"}]}}]}\n\n',
          ),
        );
        controller.close();
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
      },
    });
  });

  try {
    const { logger, messages } = createLoggerCapture();
    const assistant = createBirthDraftAssistant(logger, { interactiveSession: true });
    const result = await assistant.draftProfile(createOptions());

    assert.equal(result?.purpose, 'Deliver IoT work.');
    assert.equal(result?.personaRole, 'Senior IoT Engineer');
    assert.equal(messages.thoughts.length, 1);
    assert.equal(messages.thoughts[0]?.provider, 'Gemini');
    assert.equal(messages.thoughts[0]?.title, 'Planning the profile');
    assert.match(messages.thoughts[0]?.body ?? '', /Map the repositories/);
  } finally {
    if (savedApiKey === undefined) {
      delete process.env.GEMINI_API_KEY;
    } else {
      process.env.GEMINI_API_KEY = savedApiKey;
    }
    if (savedModel === undefined) {
      delete process.env.GEMINI_MODEL;
    } else {
      process.env.GEMINI_MODEL = savedModel;
    }
  }
});

test('createBirthDraftAssistant retries when Gemini returns invalid CLI-owned fields or malformed values', async (t) => {
  const savedApiKey = process.env.GEMINI_API_KEY;
  const savedModel = process.env.GEMINI_MODEL;
  process.env.GEMINI_API_KEY = 'gemini-key';
  process.env.GEMINI_MODEL = 'gemini-2.5-pro';
  let callCount = 0;

  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    callCount += 1;
    const payload = JSON.parse(init.body);
    const prompt = payload.contents[0].parts[0].text;

    if (callCount === 2) {
      assert.match(prompt, /previous json response was rejected/i);
      assert.match(prompt, /TELEGRAM_BOT_TOKEN must not be emitted by the model/i);
      assert.match(prompt, /purpose must be a non-empty string/i);
    }

    const text =
      callCount === 1
        ? '{"purpose":123,"TELEGRAM_BOT_TOKEN":"secret"}'
        : '{"purpose":"Deliver IoT work.","personaRole":"Senior IoT Engineer"}';

    return new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [{ text }],
            },
          },
        ],
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      },
    );
  });

  try {
    const { logger, messages } = createLoggerCapture();
    const assistant = createBirthDraftAssistant(logger);
    const result = await assistant.draftProfile(createOptions());

    assert.equal(callCount, 2);
    assert.equal(result?.purpose, 'Deliver IoT work.');
    assert.equal(result?.personaRole, 'Senior IoT Engineer');
    assert.ok(messages.warn.some((message) => /invalid birth draft payload/i.test(message)));
  } finally {
    if (savedApiKey === undefined) {
      delete process.env.GEMINI_API_KEY;
    } else {
      process.env.GEMINI_API_KEY = savedApiKey;
    }
    if (savedModel === undefined) {
      delete process.env.GEMINI_MODEL;
    } else {
      process.env.GEMINI_MODEL = savedModel;
    }
  }
});

test('createBirthDraftAssistant renders OpenAI reasoning summaries in interactive mode', async (t) => {
  const savedOpenAiKey = process.env.OPENAI_API_KEY;
  const savedOpenAiModel = process.env.OPENAI_MODEL;
  const savedGeminiKey = process.env.GEMINI_API_KEY;
  process.env.OPENAI_API_KEY = 'openai-key';
  process.env.OPENAI_MODEL = 'gpt-5-mini';
  delete process.env.GEMINI_API_KEY;

  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    const payload = JSON.parse(init.body);
    assert.equal(payload.stream, true);
    assert.equal(payload.reasoning.summary, 'auto');

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            'data: {"type":"response.reasoning_summary_text.done","item_id":"summary-1","text":"**Planning the response**\\nCheck the profile boundaries."}\n\n',
          ),
        );
        controller.enqueue(
          new TextEncoder().encode(
            'data: {"type":"response.output_text.delta","delta":"{\\"purpose\\":\\"OpenAI draft\\",\\"personaRole\\":\\"Systems Engineer\\"}"}\n\n',
          ),
        );
        controller.close();
      },
    });

    return new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    });
  });

  try {
    const { logger, messages } = createLoggerCapture();
    const assistant = createBirthDraftAssistant(logger, { interactiveSession: true });
    const result = await assistant.draftProfile(
      createOptions({
        provider: 'openai',
        providerAuthMethod: 'api-key',
        model: 'gpt-5-mini',
      }),
    );

    assert.equal(result?.purpose, 'OpenAI draft');
    assert.equal(result?.personaRole, 'Systems Engineer');
    assert.equal(messages.thoughts[0]?.provider, 'OpenAI');
    assert.equal(messages.thoughts[0]?.title, 'Planning the response');
  } finally {
    if (savedOpenAiKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = savedOpenAiKey;
    }
    if (savedOpenAiModel === undefined) {
      delete process.env.OPENAI_MODEL;
    } else {
      process.env.OPENAI_MODEL = savedOpenAiModel;
    }
    if (savedGeminiKey === undefined) {
      delete process.env.GEMINI_API_KEY;
    } else {
      process.env.GEMINI_API_KEY = savedGeminiKey;
    }
  }
});

test('createBirthDraftAssistant renders Anthropic thinking blocks in interactive mode', async (t) => {
  const savedAnthropicKey = process.env.ANTHROPIC_API_KEY;
  const savedAnthropicModel = process.env.ANTHROPIC_MODEL;
  const savedGeminiKey = process.env.GEMINI_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'anthropic-key';
  process.env.ANTHROPIC_MODEL = 'claude-sonnet-4-20250514';
  delete process.env.GEMINI_API_KEY;

  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    const payload = JSON.parse(init.body);
    assert.equal(payload.stream, true);
    assert.equal(payload.thinking.type, 'enabled');

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"thinking"}}\n\n',
          ),
        );
        controller.enqueue(
          new TextEncoder().encode(
            'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"**Architecture review**\\nCheck project boundaries."}}\n\n',
          ),
        );
        controller.enqueue(
          new TextEncoder().encode(
            'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
          ),
        );
        controller.enqueue(
          new TextEncoder().encode(
            'event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"text"}}\n\n',
          ),
        );
        controller.enqueue(
          new TextEncoder().encode(
            'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"{\\"purpose\\":\\"Anthropic draft\\",\\"personaRole\\":\\"QA Architect\\"}"}}\n\n',
          ),
        );
        controller.enqueue(
          new TextEncoder().encode(
            'event: content_block_stop\ndata: {"type":"content_block_stop","index":1}\n\n',
          ),
        );
        controller.close();
      },
    });

    return new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    });
  });

  try {
    const { logger, messages } = createLoggerCapture();
    const assistant = createBirthDraftAssistant(logger, { interactiveSession: true });
    const result = await assistant.draftProfile(
      createOptions({
        provider: 'claude',
        providerAuthMethod: 'api-key',
        model: 'claude-sonnet-4-20250514',
      }),
    );

    assert.equal(result?.purpose, 'Anthropic draft');
    assert.equal(result?.personaRole, 'QA Architect');
    assert.equal(messages.thoughts[0]?.provider, 'Anthropic');
    assert.equal(messages.thoughts[0]?.title, 'Architecture review');
  } finally {
    if (savedAnthropicKey === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = savedAnthropicKey;
    }
    if (savedAnthropicModel === undefined) {
      delete process.env.ANTHROPIC_MODEL;
    } else {
      process.env.ANTHROPIC_MODEL = savedAnthropicModel;
    }
    if (savedGeminiKey === undefined) {
      delete process.env.GEMINI_API_KEY;
    } else {
      process.env.GEMINI_API_KEY = savedGeminiKey;
    }
  }
});

test('birth interview skill treats Telegram as required infrastructure', () => {
  const prompt = buildBirthInterviewSystemPrompt();
  assert.match(prompt, /Treat Telegram as required operational infrastructure/);
  assert.match(prompt, /Do not ask for operator ids, bot tokens, chat ids, thread ids/);
  assert.match(prompt, /Do not ask for GitHub App ids, installation ids, owners, or private key paths/);
  assert.match(prompt, /Do not ask for raw secrets/);
});

test('createBirthInterviewAssistant returns the next conversational turn with captured fields', async (t) => {
  const savedApiKey = process.env.GEMINI_API_KEY;
  const savedModel = process.env.GEMINI_MODEL;
  process.env.GEMINI_API_KEY = 'gemini-key';
  process.env.GEMINI_MODEL = 'gemini-2.5-pro';

  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    const payload = JSON.parse(init.body);
    assert.equal(payload.generationConfig.thinkingConfig.includeThoughts, true);

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            'data: {"candidates":[{"content":{"parts":[{"thought":true,"text":"**Interview plan**\\nConfirm role and runtime provider."}]}}]}\n\n',
          ),
        );
        controller.enqueue(
          new TextEncoder().encode(
            'data: {"candidates":[{"content":{"parts":[{"text":"{\\"status\\":\\"needs_input\\",\\"assistantMessage\\":\\"What kind of IoT work will this agent own, and should it run on Codex CLI or Gemini API?\\",\\"missing\\":[\\"birthProfile.purpose\\",\\"provider\\"],\\"capture\\":{\\"agentName\\":\\"AnyStream IoT Development Agent\\",\\"scope\\":\\"anystream.iot\\",\\"birthProfile\\":{\\"personaRole\\":\\"IoT delivery agent\\"}}}"}]}}]}\n\n',
          ),
        );
        controller.close();
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
      },
    });
  });

  try {
    const { logger, messages } = createLoggerCapture();
    const assistant = createBirthInterviewAssistant(logger, { interactiveSession: true });
    const result = await assistant.planTurn(
      'codex',
      {
        agentName: 'AnyStream IoT Development Agent',
        scope: 'anystream.iot',
      },
      [],
    );

    assert.equal(result?.status, 'needs_input');
    assert.equal(result?.capture.agentName, 'AnyStream IoT Development Agent');
    assert.equal(result?.capture.birthProfile?.personaRole, 'IoT delivery agent');
    assert.match(result?.assistantMessage ?? '', /IoT work/);
    assert.equal(messages.thoughts[0]?.provider, 'Gemini');
  } finally {
    if (savedApiKey === undefined) {
      delete process.env.GEMINI_API_KEY;
    } else {
      process.env.GEMINI_API_KEY = savedApiKey;
    }
    if (savedModel === undefined) {
      delete process.env.GEMINI_MODEL;
    } else {
      process.env.GEMINI_MODEL = savedModel;
    }
  }
});

test('createBirthInterviewAssistant retries when Gemini asks for deterministic CLI-owned fields', async (t) => {
  const savedApiKey = process.env.GEMINI_API_KEY;
  const savedModel = process.env.GEMINI_MODEL;
  process.env.GEMINI_API_KEY = 'gemini-key';
  process.env.GEMINI_MODEL = 'gemini-2.5-pro';
  let callCount = 0;

  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    callCount += 1;
    const payload = JSON.parse(init.body);
    const prompt = payload.contents[0].parts[0].text;

    if (callCount === 2) {
      assert.match(prompt, /assistantMessage must not ask for operator ids, GitHub App identity fields, chat ids, thread ids, or bot tokens/i);
      assert.match(prompt, /capture\.operatorIds must not be emitted by the model/i);
      assert.match(prompt, /capture\.telegramThreadId must not be emitted by the model/i);
    }

    const text =
      callCount === 1
        ? JSON.stringify({
            status: 'complete',
            assistantMessage: 'What are the operator ids and thread id for Telegram?',
            missing: [],
            capture: {
              operatorIds: ['operator.telegram.130149339'],
              telegramThreadId: '2',
            },
          })
        : JSON.stringify({
            status: 'needs_input',
            assistantMessage: 'What kind of IoT work will this agent own?',
            missing: ['birthProfile.purpose'],
            capture: {
              agentName: 'AnyStream IoT Development Agent',
              scope: 'anystream.iot',
              birthProfile: {
                personaRole: 'IoT delivery agent',
              },
            },
          });

    return new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [{ text }],
            },
          },
        ],
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      },
    );
  });

  try {
    const { logger, messages } = createLoggerCapture();
    const assistant = createBirthInterviewAssistant(logger);
    const result = await assistant.planTurn(
      'codex',
      {
        agentName: 'AnyStream IoT Development Agent',
        scope: 'anystream.iot',
        telegramEnabled: true,
      },
      [],
    );

    assert.equal(callCount, 2);
    assert.equal(result?.status, 'needs_input');
    assert.equal(result?.capture.agentName, 'AnyStream IoT Development Agent');
    assert.equal(result?.capture.birthProfile?.personaRole, 'IoT delivery agent');
    assert.match(result?.assistantMessage ?? '', /IoT work/);
    assert.ok(messages.warn.some((message) => /invalid birth interview payload/i.test(message)));
  } finally {
    if (savedApiKey === undefined) {
      delete process.env.GEMINI_API_KEY;
    } else {
      process.env.GEMINI_API_KEY = savedApiKey;
    }
    if (savedModel === undefined) {
      delete process.env.GEMINI_MODEL;
    } else {
      process.env.GEMINI_MODEL = savedModel;
    }
  }
});
