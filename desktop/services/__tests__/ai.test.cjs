'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');

const ai = require('../ai.cjs');

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(payload));
}

async function startMockServer() {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const body = await readBody(req);
    requests.push({ method: req.method, path: url.pathname, body });

    if (req.method === 'GET' && url.pathname === '/v1/models') {
      if (req.headers['anthropic-version']) {
        return sendJson(res, 200, {
          data: [{ id: 'claude-3-5-sonnet-latest', display_name: 'Claude 3.5 Sonnet' }],
          has_more: false,
        });
      }
      return sendJson(res, 200, {
        data: [
          { id: 'gpt-4o' },
          { id: 'text-embedding-3-small' },
          { id: 'llava:latest' },
        ],
      });
    }
    if (req.method === 'GET' && url.pathname === '/v1beta/models') {
      return sendJson(res, 200, {
        models: [
          { name: 'models/gemini-2.0-flash', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
        ],
      });
    }
    if (req.method === 'GET' && url.pathname === '/api/tags') {
      return sendJson(res, 200, {
        models: [{ name: 'llava:latest' }, { name: 'llama3:latest' }],
      });
    }
    if (req.method === 'POST' && url.pathname === '/api/show') {
      const payload = JSON.parse(body || '{}');
      return sendJson(res, 200, {
        capabilities: payload.name?.startsWith('llava') ? ['completion', 'vision'] : ['completion'],
      });
    }
    if (req.method === 'GET' && url.pathname === '/models') {
      return sendJson(res, 200, {
        data: [{ id: 'claude-3-5-sonnet-latest', display_name: 'Claude 3.5 Sonnet' }],
        has_more: false,
      });
    }
    if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
      const payload = JSON.parse(body || '{}');
      if (payload.model === 'gpt-4o-broken') {
        return sendJson(res, 500, { error: { message: 'mock failure' } });
      }
      if (payload.model === 'gpt-4o-ocr') {
        return sendJson(res, 200, {
          choices: [
            {
              message: {
                content:
                  '{"worldId":"wrld_12345678-1234-1234-1234-123456789abc","worldName":"Sakura Shrine","confidence":0.93}',
              },
            },
          ],
        });
      }
      if (payload.model === 'gpt-4o-orientation') {
        return sendJson(res, 200, {
          choices: [
            {
              message: {
                content:
                  '{"type":"selfie","head":"right","rotation":270,"confidence":0.91}',
              },
            },
          ],
        });
      }
      const image = payload.messages?.[0]?.content?.find?.((part) => part.type === 'image_url');
      if (!image?.image_url?.url?.startsWith('data:image/jpeg;base64,')) {
        return sendJson(res, 400, { error: { message: 'missing image' } });
      }
      return sendJson(res, 200, {
        choices: [{ message: { content: '{"summary":"暮色里的相遇。","tags":["暮色","合影"]}' } }],
      });
    }
    if (req.method === 'POST' && url.pathname === '/v1/messages') {
      const payload = JSON.parse(body || '{}');
      if (!payload.messages?.[0]?.content?.some?.((block) => block.type === 'image')) {
        return sendJson(res, 400, { error: { message: 'missing image' } });
      }
      return sendJson(res, 200, {
        content: [{ type: 'text', text: '{"summary":"樱花下的记忆。","tags":["樱花"]}' }],
      });
    }
    if (req.method === 'POST' && url.pathname.endsWith(':generateContent')) {
      const payload = JSON.parse(body || '{}');
      if (!payload.contents?.[0]?.parts?.some?.((part) => part.inline_data)) {
        return sendJson(res, 400, { error: { message: 'missing image' } });
      }
      return sendJson(res, 200, {
        candidates: [{ content: { parts: [{ text: '{"summary":"星光下的旅途。","tags":["星光"]}' }] } }],
      });
    }
    if (req.method === 'POST' && url.pathname === '/api/chat') {
      const payload = JSON.parse(body || '{}');
      if (!Array.isArray(payload.messages?.[0]?.images) || payload.messages[0].images.length === 0) {
        return sendJson(res, 400, { error: 'missing image' });
      }
      return sendJson(res, 200, {
        message: { content: '{"summary":"夜色里的散步。","tags":["夜色"]}' },
      });
    }
    return sendJson(res, 404, { error: { message: `no mock route ${req.method} ${url.pathname}` } });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

test('base URL normalization and vision heuristics', () => {
  assert.equal(ai.normalizeBaseUrl('openai', 'http://127.0.0.1:1234'), 'http://127.0.0.1:1234/v1');
  assert.equal(ai.normalizeBaseUrl('anthropic', 'https://api.anthropic.com/v1'), 'https://api.anthropic.com/v1');
  assert.equal(ai.normalizeBaseUrl('gemini', 'https://generativelanguage.googleapis.com'), 'https://generativelanguage.googleapis.com/v1beta');
  assert.equal(ai.normalizeBaseUrl('ollama', 'http://127.0.0.1:11434'), 'http://127.0.0.1:11434');

  assert.equal(ai.isVisionModel('openai', 'gpt-4o'), true);
  assert.equal(ai.isVisionModel('openai', 'gpt-4o-mini'), true);
  assert.equal(ai.isVisionModel('openai', 'text-embedding-3-large'), false);
  assert.equal(ai.isVisionModel('anthropic', 'claude-3-5-sonnet-latest'), true);
  assert.equal(ai.isVisionModel('gemini', 'gemini-2.0-flash'), true);
  assert.equal(ai.isVisionModel('gemini', 'text-embedding-004'), false);
  assert.equal(ai.isVisionModel('ollama', 'llava:latest', { capabilities: ['vision'] }), true);
  assert.equal(ai.isVisionModel('ollama', 'llama3:latest', { capabilities: ['completion'] }), false);
});

test('list models normalizes all four protocols', async () => {
  const mock = await startMockServer();
  try {
    const openai = await ai.listModels({
      protocol: 'openai',
      baseUrl: mock.baseUrl,
      apiKey: 'test',
    });
    assert.equal(openai.models.some((model) => model.id === 'gpt-4o' && model.vision), true);
    assert.equal(openai.models.some((model) => model.id === 'text-embedding-3-small' && !model.vision), true);

    const anthropic = await ai.listModels({
      protocol: 'anthropic',
      baseUrl: mock.baseUrl,
      apiKey: 'test',
    });
    assert.equal(anthropic.models[0].id, 'claude-3-5-sonnet-latest');
    assert.equal(anthropic.models[0].vision, true);

    const gemini = await ai.listModels({
      protocol: 'gemini',
      baseUrl: mock.baseUrl,
      apiKey: 'test',
    });
    assert.equal(gemini.models.some((model) => model.id === 'gemini-2.0-flash' && model.vision), true);
    assert.equal(gemini.models.some((model) => model.id === 'text-embedding-004'), false);

    const ollama = await ai.listModels({
      protocol: 'ollama',
      baseUrl: mock.baseUrl,
    });
    assert.equal(ollama.models.find((model) => model.id === 'llava:latest')?.vision, true);
    assert.equal(ollama.models.find((model) => model.id === 'llama3:latest')?.vision, false);
  } finally {
    await mock.close();
  }
});

test('summarizePhoto uses primary, falls back to backup and parses JSON', async () => {
  const mock = await startMockServer();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vrchat-ai-'));
  try {
    const file = path.join(root, 'photo.png');
    await sharp({
      create: { width: 48, height: 32, channels: 3, background: '#556677' },
    })
      .png()
      .toFile(file);

    const success = await ai.summarizePhoto({
      root,
      item: { libraryPath: 'photo.png' },
      settings: {
        protocol: 'openai',
        baseUrl: mock.baseUrl,
        primaryModel: 'gpt-4o',
        backupModel: '',
        allowUnverifiedVision: false,
      },
      apiKey: 'test',
      context: { capturedAt: '2024-05-01T20:30:00.000Z', worldName: 'Sakura Shrine' },
      timeoutMs: 15000,
    });
    assert.equal(success.ok, true);
    assert.equal(success.summary, '暮色里的相遇。');
    assert.deepEqual(success.tags, ['暮色', '合影']);
    assert.equal(success.usedBackup, false);

    const fallback = await ai.summarizePhoto({
      root,
      item: { libraryPath: 'photo.png' },
      settings: {
        protocol: 'openai',
        baseUrl: mock.baseUrl,
        primaryModel: 'gpt-4o-broken',
        backupModel: 'gpt-4o',
        allowUnverifiedVision: false,
      },
      apiKey: 'test',
      timeoutMs: 15000,
    });
    assert.equal(fallback.ok, true);
    assert.equal(fallback.usedBackup, true);
    assert.equal(fallback.model, 'gpt-4o');

    const blocked = await ai.summarizePhoto({
      root,
      item: { libraryPath: 'photo.png' },
      settings: {
        protocol: 'openai',
        baseUrl: mock.baseUrl,
        primaryModel: 'text-embedding-3-small',
        backupModel: '',
        allowUnverifiedVision: false,
      },
      apiKey: 'test',
    });
    assert.equal(blocked.ok, false);
    assert.match(blocked.error, /视觉模型/);
  } finally {
    await mock.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('summarizePhoto works for Anthropic, Gemini and Ollama request shapes', async () => {
  const mock = await startMockServer();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vrchat-ai-'));
  try {
    const file = path.join(root, 'photo.jpg');
    await sharp({
      create: { width: 32, height: 32, channels: 3, background: '#8899aa' },
    })
      .jpeg()
      .toFile(file);

    const cases = [
      { protocol: 'anthropic', model: 'claude-3-5-sonnet-latest', summary: '樱花下的记忆。' },
      { protocol: 'gemini', model: 'gemini-2.0-flash', summary: '星光下的旅途。' },
      { protocol: 'ollama', model: 'llava:latest', summary: '夜色里的散步。' },
    ];

    for (const entry of cases) {
      const result = await ai.summarizePhoto({
        root,
        item: { libraryPath: 'photo.jpg' },
        settings: {
          protocol: entry.protocol,
          baseUrl: mock.baseUrl,
          primaryModel: entry.model,
          backupModel: '',
          allowUnverifiedVision: false,
        },
        apiKey: entry.protocol === 'ollama' ? '' : 'test',
        timeoutMs: 15000,
      });
      assert.equal(result.ok, true, `${entry.protocol} should succeed: ${result.error || ''}`);
      assert.equal(result.summary, entry.summary);
    }
  } finally {
    await mock.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('parseSummary tolerates code fences and plain text', () => {
  assert.deepEqual(ai.parseSummary('```json\n{"summary":"你好","tags":["夜"]}\n```'), {
    summary: '你好',
    tags: ['夜'],
    worldId: null,
    worldName: null,
  });
  const plain = ai.parseSummary('只有一段普通总结');
  assert.equal(plain.summary, '只有一段普通总结');
  assert.deepEqual(plain.tags, []);
});

test('parseWorldIdResponse and recognizeWorldId read printed IDs', async () => {
  const parsed = ai.parseWorldIdResponse(
    '{"worldId":"wrld_12345678-1234-1234-1234-123456789abc","worldName":"Sakura Shrine","confidence":0.9}',
  );
  assert.equal(parsed.worldId, 'wrld_12345678-1234-1234-1234-123456789abc');
  assert.equal(parsed.worldName, 'Sakura Shrine');
  assert.equal(parsed.confidence, 0.9);

  const mock = await startMockServer();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vrchat-worldid-'));
  try {
    const file = path.join(root, 'polaroid.png');
    await sharp({
      create: { width: 64, height: 48, channels: 3, background: '#334455' },
    })
      .png()
      .toFile(file);
    const result = await ai.recognizeWorldId({
      root,
      item: { libraryPath: 'polaroid.png' },
      settings: {
        protocol: 'openai',
        baseUrl: mock.baseUrl,
        primaryModel: 'gpt-4o-ocr',
        backupModel: '',
        allowUnverifiedVision: false,
      },
      apiKey: 'test',
      timeoutMs: 15000,
    });
    assert.equal(result.ok, true);
    assert.equal(result.worldId, 'wrld_12345678-1234-1234-1234-123456789abc');
    assert.equal(result.worldName, 'Sakura Shrine');
  } finally {
    await mock.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('orientation prompt encodes the head-up and 16:9 landscape rules', () => {
  const prompt = ai.buildOrientationPrompt();
  assert.match(prompt, /头顶/);
  assert.match(prompt, /16:9/);
  assert.match(prompt, /风景/);
  assert.match(prompt, /rotation/);
});

test('parseOrientationResponse maps head direction to clockwise rotation', () => {
  assert.deepEqual(
    ai.parseOrientationResponse(
      '{"type":"selfie","head":"right","rotation":270,"confidence":0.92}',
    ),
    { type: 'selfie', head: 'right', rotation: 270, confidence: 0.92 },
  );
  assert.deepEqual(
    ai.parseOrientationResponse(
      '```json\n{"type":"selfie","head":"left","rotation":90,"confidence":0.8}\n```',
    ),
    { type: 'selfie', head: 'left', rotation: 90, confidence: 0.8 },
  );
  assert.deepEqual(
    ai.parseOrientationResponse('{"type":"selfie","head":"down","rotation":180}'),
    { type: 'selfie', head: 'down', rotation: 180, confidence: 0.7 },
  );
  assert.deepEqual(
    ai.parseOrientationResponse('{"type":"selfie","head":"up","rotation":0}'),
    { type: 'selfie', head: 'up', rotation: 0, confidence: 0.7 },
  );
});

test('parseOrientationResponse never rotates a landscape/16:9 frame', () => {
  assert.deepEqual(
    ai.parseOrientationResponse(
      '{"type":"landscape","head":"none","rotation":90,"confidence":0.88}',
    ),
    { type: 'landscape', head: 'none', rotation: 0, confidence: 0.88 },
  );
  assert.equal(ai.parseOrientationResponse('not a json answer'), null);
});

test('detectOrientation applies the head-up rotation from the vision model', async () => {
  const mock = await startMockServer();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vrchat-orientation-'));
  try {
    const file = path.join(root, 'sideways.png');
    await sharp({
      create: { width: 64, height: 48, channels: 3, background: '#aa7744' },
    })
      .png()
      .toFile(file);
    const result = await ai.detectOrientation({
      root,
      item: { libraryPath: 'sideways.png' },
      settings: {
        protocol: 'openai',
        baseUrl: mock.baseUrl,
        primaryModel: 'gpt-4o-orientation',
        backupModel: '',
        allowUnverifiedVision: false,
      },
      apiKey: 'test',
      timeoutMs: 15000,
    });
    assert.equal(result.ok, true);
    assert.equal(result.type, 'selfie');
    assert.equal(result.head, 'right');
    assert.equal(result.rotation, 270);
    assert.equal(result.confidence, 0.91);
  } finally {
    await mock.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
