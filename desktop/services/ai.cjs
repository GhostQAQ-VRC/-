'use strict';

const path = require('node:path');
const fsp = require('node:fs/promises');
const sharp = require('sharp');
const repository = require('../library/repository.cjs');
const { PREVIEW_FILE_PATTERN } = require('../library/constants.cjs');

const PROTOCOLS = ['openai', 'anthropic', 'gemini', 'ollama'];
const WORLD_ID_RE =
  /wrld_[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/;

const VISION_POSITIVE = [
  /gpt-4o/i,
  /gpt-4\.1/i,
  /gpt-4-turbo/i,
  /gpt-4-vision/i,
  /gpt-5/i,
  /^o[134]/i,
  /claude/i,
  /gemini-(1\.5|2|3|exp)/i,
  /llava/i,
  /bakllava/i,
  /qwen.*vl/i,
  /qwen-vl/i,
  /internvl/i,
  /minicpm.*v/i,
  /glm-4v/i,
  /pixtral/i,
  /vision/i,
  /multimodal/i,
  /omni/i,
  /llama.*vision/i,
  /moondream/i,
  /idefics/i,
  /cogvlm/i,
  /phi-.*vision/i,
  /gemma3/i,
  /magistral.*vision/i,
  /mistral.*vision/i,
  /step.*vision/i,
];

const VISION_NEGATIVE = [
  /embedding/i,
  /embed[-_]/i,
  /tts/i,
  /whisper/i,
  /dall-e/i,
  /dalle/i,
  /moderation/i,
  /audio/i,
  /rerank/i,
  /transcribe/i,
  /image-gen/i,
  /imagen/i,
  /veo/i,
  /sora/i,
  /aqa/i,
];

function assertProtocol(protocol) {
  if (!PROTOCOLS.includes(protocol)) {
    throw new Error('不支持的 AI 协议。');
  }
}

function normalizeBaseUrl(protocol, value) {
  assertProtocol(protocol);
  const raw = String(value || '').trim();
  if (!raw) throw new Error('请填写 API Base URL。');
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('API Base URL 格式不正确。');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('API Base URL 必须是 http(s) 地址。');
  }
  url.search = '';
  url.hash = '';
  let pathname = url.pathname.replace(/\/+$/, '');
  if (!pathname) {
    if (protocol === 'openai' || protocol === 'anthropic') pathname = '/v1';
    else if (protocol === 'gemini') pathname = '/v1beta';
    else pathname = '';
  }
  return `${url.origin}${pathname}`;
}

function isVisionModel(protocol, modelId, meta = {}) {
  const id = String(modelId || '').toLowerCase();
  if (!id) return false;
  if (protocol === 'ollama' && Array.isArray(meta.capabilities)) {
    return meta.capabilities.includes('vision');
  }
  if (VISION_NEGATIVE.some((pattern) => pattern.test(id))) return false;
  if (protocol === 'anthropic') {
    return /claude-(3|4|opus|sonnet|haiku)/i.test(id);
  }
  if (protocol === 'gemini') {
    return /gemini-(1\.5|2|3|exp)/i.test(id);
  }
  return VISION_POSITIVE.some((pattern) => pattern.test(id));
}

function normalizeModelEntry(protocol, id, name, meta = {}) {
  return {
    id,
    name: name || id,
    vision: isVisionModel(protocol, id, meta),
    note: meta.note,
  };
}

function temperatureFor() {
  return 0.7;
}

async function requestJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = options.timeoutMs ?? 60000;
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      method: options.method || 'GET',
      headers: options.headers,
      body: options.body,
      signal: controller.signal,
    });
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!response.ok) {
      const message =
        (json && (json.error?.message || json.error || json.message)) ||
        text.slice(0, 300) ||
        `HTTP ${response.status}`;
      const error = new Error(
        `API 返回 ${response.status}：${typeof message === 'string' ? message : JSON.stringify(message)}`,
      );
      error.status = response.status;
      throw error;
    }
    return { json, text, status: response.status };
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`请求超时（${Math.round(timeout / 1000)} 秒）。`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function authHeaders(protocol, apiKey) {
  const headers = { Accept: 'application/json' };
  if (protocol === 'anthropic') {
    if (apiKey) headers['x-api-key'] = apiKey;
    headers['anthropic-version'] = '2023-06-01';
    return headers;
  }
  if (protocol === 'gemini') return headers;
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  return headers;
}

async function listOpenAiModels(baseUrl, apiKey, timeoutMs) {
  const { json } = await requestJson(`${baseUrl}/models`, {
    headers: authHeaders('openai', apiKey),
    timeoutMs,
  });
  const list = Array.isArray(json?.data)
    ? json.data
    : Array.isArray(json?.models)
      ? json.models
      : [];
  return list
    .map((item) => {
      const id = String(item?.id || item?.name || '').trim();
      return id ? normalizeModelEntry('openai', id, item?.name || id) : null;
    })
    .filter(Boolean);
}

async function listAnthropicModels(baseUrl, apiKey, timeoutMs) {
  const models = [];
  let afterId = null;
  for (let page = 0; page < 10; page += 1) {
    const params = new URLSearchParams({ limit: '1000' });
    if (afterId) params.set('after_id', afterId);
    const { json } = await requestJson(`${baseUrl}/models?${params.toString()}`, {
      headers: authHeaders('anthropic', apiKey),
      timeoutMs,
    });
    const data = Array.isArray(json?.data) ? json.data : [];
    for (const item of data) {
      const id = String(item?.id || '').trim();
      if (id) models.push(normalizeModelEntry('anthropic', id, item?.display_name || id));
    }
    if (!json?.has_more || data.length === 0) break;
    afterId = json.last_id || data[data.length - 1]?.id || null;
    if (!afterId) break;
  }
  return models;
}

async function listGeminiModels(baseUrl, apiKey, timeoutMs) {
  const models = [];
  let pageToken = null;
  for (let page = 0; page < 10; page += 1) {
    const params = new URLSearchParams({ key: apiKey || '', pageSize: '1000' });
    if (pageToken) params.set('pageToken', pageToken);
    const { json } = await requestJson(`${baseUrl}/models?${params.toString()}`, {
      headers: authHeaders('gemini', apiKey),
      timeoutMs,
    });
    const data = Array.isArray(json?.models) ? json.models : [];
    for (const item of data) {
      const methods = item?.supportedGenerationMethods || [];
      if (methods.length && !methods.includes('generateContent')) continue;
      const rawName = String(item?.name || '');
      const id = rawName.replace(/^models\//, '');
      if (id) {
        models.push(normalizeModelEntry('gemini', id, item?.displayName || id));
      }
    }
    pageToken = json?.nextPageToken || null;
    if (!pageToken) break;
  }
  return models;
}

async function probeOllamaVision(baseUrl, modelId, timeoutMs) {
  try {
    const { json } = await requestJson(`${baseUrl}/api/show`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: modelId }),
      timeoutMs: Math.min(timeoutMs, 10000),
    });
    if (Array.isArray(json?.capabilities)) {
      return { capabilities: json.capabilities };
    }
  } catch {
    // Older Ollama versions lack capabilities; fall back to name heuristics.
  }
  return {};
}

async function listOllamaModels(baseUrl, apiKey, timeoutMs, options = {}) {
  const { json } = await requestJson(`${baseUrl}/api/tags`, {
    headers: authHeaders('ollama', apiKey),
    timeoutMs,
  });
  const list = Array.isArray(json?.models) ? json.models : [];
  const entries = list
    .map((item) => String(item?.name || item?.model || '').trim())
    .filter(Boolean);

  const results = [];
  const concurrency = 4;
  let cursor = 0;
  async function worker() {
    while (cursor < entries.length) {
      const index = cursor;
      cursor += 1;
      const id = entries[index];
      const meta =
        options.probeVision !== false
          ? await probeOllamaVision(baseUrl, id, timeoutMs)
          : {};
      results[index] = normalizeModelEntry('ollama', id, id, meta);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, entries.length || 1) }, () => worker()),
  );
  return results.filter(Boolean);
}

async function listModels(options) {
  const protocol = options.protocol;
  const baseUrl = normalizeBaseUrl(protocol, options.baseUrl);
  const apiKey = options.apiKey || '';
  const timeoutMs = options.timeoutMs ?? 30000;

  if (
    !apiKey &&
    (protocol === 'openai' || protocol === 'anthropic' || protocol === 'gemini') &&
    !options.allowEmptyKey
  ) {
    throw new Error('请先填写 API Key。');
  }

  let models;
  if (protocol === 'openai') models = await listOpenAiModels(baseUrl, apiKey, timeoutMs);
  else if (protocol === 'anthropic') models = await listAnthropicModels(baseUrl, apiKey, timeoutMs);
  else if (protocol === 'gemini') models = await listGeminiModels(baseUrl, apiKey, timeoutMs);
  else models = await listOllamaModels(baseUrl, apiKey, timeoutMs, options);

  models.sort((a, b) => Number(b.vision) - Number(a.vision) || a.id.localeCompare(b.id));
  return {
    ok: true,
    protocol,
    baseUrl,
    models,
    visionCount: models.filter((model) => model.vision).length,
  };
}

function buildPrompt(context = {}) {
  const parts = [
    '你是一位温柔的 VRChat 旅行相册编辑。请观察这张照片，用中文写 1-3 句回忆式总结（不超过 120 字），并给出 3-5 个短标签。',
    '如果画面边缘/角落/底部印有以 wrld_ 开头的世界 ID（VRChat 拍立得常见），也请读取并在 JSON 中加入 worldId/worldName；没有就省略。',
    '只输出 JSON，不要解释，不要代码块：{"summary":"...","tags":["..."],"worldId":"wrld_...","worldName":"..."}',
  ];
  if (context.capturedAt) parts.push(`拍摄时间：${context.capturedAt}`);
  if (context.worldName) parts.push(`所在世界：${context.worldName}`);
  if (context.note) parts.push(`已有备注：${context.note}`);
  return parts.join('\n');
}

function parseSummary(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```$/i, '')
    .trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  let payload = null;
  if (start >= 0 && end > start) {
    try {
      payload = JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      payload = null;
    }
  }
  if (payload && typeof payload.summary === 'string') {
    const tags = Array.isArray(payload.tags)
      ? payload.tags
          .filter((tag) => typeof tag === 'string' && tag.trim())
          .map((tag) => tag.trim().slice(0, 24))
          .slice(0, 12)
      : [];
    const summary = payload.summary.trim().slice(0, 2000);
    const worldMatch =
      (typeof payload.worldId === 'string' ? payload.worldId.match(WORLD_ID_RE) : null) ||
      cleaned.match(WORLD_ID_RE);
    if (summary) {
      return {
        summary,
        tags,
        worldId: worldMatch ? worldMatch[0] : null,
        worldName:
          typeof payload.worldName === 'string' && payload.worldName.trim()
            ? payload.worldName.trim().slice(0, 120)
            : null,
      };
    }
  }
  const worldMatch = cleaned.match(WORLD_ID_RE);
  return {
    summary: cleaned.slice(0, 2000),
    tags: [],
    worldId: worldMatch ? worldMatch[0] : null,
    worldName: null,
  };
}

async function prepareImage(absPath, options = {}) {
  const maxEdge = options.maxEdge ?? 1024;
  const quality = options.quality ?? 82;
  const buffer = await sharp(absPath, { limitInputPixels: false, failOn: 'none' })
    .rotate()
    .resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality })
    .toBuffer();
  return { buffer, base64: buffer.toString('base64'), mime: 'image/jpeg' };
}

function extractOpenAiText(json) {
  const content = json?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === 'string' ? part : part?.text || ''))
      .join('\n');
  }
  return '';
}

function extractAnthropicText(json) {
  const content = json?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (part?.type === 'text' ? part.text : ''))
      .join('\n');
  }
  return '';
}

function extractGeminiText(json) {
  const parts = json?.candidates?.[0]?.content?.parts;
  if (Array.isArray(parts)) {
    return parts.map((part) => part?.text || '').join('\n');
  }
  return '';
}

function extractOllamaText(json) {
  return json?.message?.content || json?.response || '';
}

async function callModel(options) {
  const protocol = options.protocol;
  const baseUrl = normalizeBaseUrl(protocol, options.baseUrl);
  const apiKey = options.apiKey || '';
  const model = options.model;
  const prompt = options.prompt;
  const image = options.image;
  const timeoutMs = options.timeoutMs ?? 90000;

  if (protocol === 'openai') {
    const supportsTemperature = !/^o[134]/i.test(String(model));
    const body = {
      model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            {
              type: 'image_url',
              image_url: { url: `data:${image.mime};base64,${image.base64}` },
            },
          ],
        },
      ],
      ...(supportsTemperature ? { temperature: temperatureFor() } : {}),
    };
    const { json } = await requestJson(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        ...authHeaders('openai', apiKey),
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      timeoutMs,
    });
    return extractOpenAiText(json);
  }

  if (protocol === 'anthropic') {
    const { json } = await requestJson(`${baseUrl}/messages`, {
      method: 'POST',
      headers: {
        ...authHeaders('anthropic', apiKey),
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: 700,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: image.mime,
                  data: image.base64,
                },
              },
              { type: 'text', text: prompt },
            ],
          },
        ],
      }),
      timeoutMs,
    });
    return extractAnthropicText(json);
  }

  if (protocol === 'gemini') {
    const modelId = String(model).replace(/^models\//, '');
    const url = `${baseUrl}/models/${encodeURIComponent(modelId)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const { json } = await requestJson(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders('gemini', apiKey) },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { inline_data: { mime_type: image.mime, data: image.base64 } },
              { text: prompt },
            ],
          },
        ],
        generationConfig: { temperature: temperatureFor(), maxOutputTokens: 800 },
      }),
      timeoutMs,
    });
    return extractGeminiText(json);
  }

  // Ollama
  const { json } = await requestJson(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders('ollama', apiKey) },
    body: JSON.stringify({
      model,
      stream: false,
      messages: [{ role: 'user', content: prompt, images: [image.base64] }],
      options: { temperature: temperatureFor() },
    }),
    timeoutMs,
  });
  return extractOllamaText(json);
}

async function resolveImagePath(root, item) {
  if (item.previewPath) {
    const name = path.basename(item.previewPath);
    if (!PREVIEW_FILE_PATTERN.test(name)) {
      throw new Error('预览路径不合法。');
    }
    const wrapper = await repository.readLibrary(root);
    return path.join(repository.previewDir(root, wrapper), name);
  }
  if (item.libraryPath) {
    const absolute = repository.resolveInside(root, item.libraryPath);
    if (!absolute) throw new Error('照片路径不合法。');
    return absolute;
  }
  throw new Error('照片没有可用的文件路径。');
}

async function summarizePhoto(options) {
  const { root, item, settings, apiKey } = options;
  const protocol = settings.protocol;
  const baseUrl = settings.baseUrl;
  const timeoutMs = options.timeoutMs ?? 90000;
  const candidates = [settings.primaryModel, settings.backupModel]
    .map((model) => String(model || '').trim())
    .filter((model, index, list) => model && list.indexOf(model) === index);

  if (candidates.length === 0) {
    return { ok: false, error: '请先在高级设置中选择主模型或备用模型。' };
  }

  let absolute;
  try {
    absolute = await resolveImagePath(root, item);
    await fsp.access(absolute);
  } catch {
    // A cleared preview cache should not block AI; fall back to the original.
    try {
      if (!item.libraryPath) throw new Error('没有原图路径。');
      absolute = repository.resolveInside(root, item.libraryPath);
      if (!absolute) throw new Error('原图路径不合法。');
      await fsp.access(absolute);
    } catch (error) {
      return { ok: false, error: error.message || '照片文件不可用。' };
    }
  }

  let image;
  try {
    image = await prepareImage(absolute);
  } catch (error) {
    return { ok: false, error: `无法读取照片：${error.message}` };
  }

  const prompt = buildPrompt(options.context || {});
  const failures = [];

  for (let index = 0; index < candidates.length; index += 1) {
    const model = candidates[index];
    const vision = isVisionModel(protocol, model);
    if (!vision && !settings.allowUnverifiedVision) {
      failures.push(`${model}：未被识别为视觉模型`);
      continue;
    }
    try {
      const text = await callModel({
        protocol,
        baseUrl,
        apiKey,
        model,
        prompt,
        image,
        timeoutMs,
      });
      const parsed = parseSummary(text);
      if (!parsed || !parsed.summary) {
        failures.push(`${model}：返回内容为空或无法解析`);
        continue;
      }
      return {
        ok: true,
        summary: parsed.summary,
        tags: parsed.tags,
        worldId: parsed.worldId || undefined,
        worldName: parsed.worldName || undefined,
        model,
        usedBackup: index > 0,
        vision,
      };
    } catch (error) {
      failures.push(`${model}：${error.message}`);
    }
  }

  return {
    ok: false,
    error: failures.join('；') || 'AI 生成失败。',
  };
}

function buildWorldIdPrompt(context = {}) {
  const parts = [
    '你是 VRChat 照片资料整理助手。请仔细观察图片画面，尤其是拍立得/照片边缘、角落、底部印刷或叠加的小字，寻找以 wrld_ 开头、后接 UUID 的世界 ID，以及它附近的世界名称。',
    '只输出 JSON，不要解释，不要代码块：{"worldId":"wrld_...","worldName":"...","confidence":0.0}',
    '如果画面里确实没有可辨认的 World ID，输出 {"worldId":null,"confidence":0}。不要猜测。',
  ];
  if (context.fileName) parts.push(`文件名：${context.fileName}`);
  if (context.worldName) parts.push(`已知世界名（仅供参考）：${context.worldName}`);
  return parts.join('\n');
}

function parseWorldIdResponse(raw) {
  const text = String(raw || '').trim();
  if (!text) return { worldId: null, worldName: null, confidence: 0 };
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```$/i, '')
    .trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  let payload = null;
  if (start >= 0 && end > start) {
    try {
      payload = JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      payload = null;
    }
  }
  const direct =
    (payload && typeof payload.worldId === 'string' ? payload.worldId.match(WORLD_ID_RE) : null) ||
    cleaned.match(WORLD_ID_RE);
  const worldId = direct ? direct[0] : null;
  const worldName =
    payload && typeof payload.worldName === 'string' && payload.worldName.trim()
      ? payload.worldName.trim().slice(0, 120)
      : null;
  const confidence =
    payload && typeof payload.confidence === 'number'
      ? Math.max(0, Math.min(1, payload.confidence))
      : worldId
        ? 0.7
        : 0;
  return { worldId, worldName, confidence };
}

async function recognizeWorldId(options) {
  const { root, item, settings, apiKey } = options;
  const protocol = settings.protocol;
  const timeoutMs = options.timeoutMs ?? 90000;
  const candidates = [settings.primaryModel, settings.backupModel]
    .map((model) => String(model || '').trim())
    .filter((model, index, list) => model && list.indexOf(model) === index);
  if (candidates.length === 0) {
    return { ok: false, error: '请先在高级设置中选择主模型或备用模型。' };
  }

  let absolute;
  try {
    absolute = await resolveImagePath(root, item);
    await fsp.access(absolute);
  } catch {
    try {
      if (!item.libraryPath) throw new Error('没有原图路径。');
      absolute = repository.resolveInside(root, item.libraryPath);
      if (!absolute) throw new Error('原图路径不合法。');
      await fsp.access(absolute);
    } catch (error) {
      return { ok: false, error: error.message || '照片文件不可用。' };
    }
  }

  let image;
  try {
    image = await prepareImage(absolute, { maxEdge: 2048, quality: 90 });
  } catch (error) {
    return { ok: false, error: `无法读取照片：${error.message}` };
  }

  const prompt = buildWorldIdPrompt({
    fileName: item.libraryPath?.split('/').pop(),
    worldName: item.worldName,
  });
  const failures = [];

  for (let index = 0; index < candidates.length; index += 1) {
    const model = candidates[index];
    const vision = isVisionModel(protocol, model);
    if (!vision && !settings.allowUnverifiedVision) {
      failures.push(`${model}：未被识别为视觉模型`);
      continue;
    }
    try {
      const text = await callModel({
        protocol,
        baseUrl: settings.baseUrl,
        apiKey,
        model,
        prompt,
        image,
        timeoutMs,
      });
      const parsed = parseWorldIdResponse(text);
      if (parsed.worldId) {
        return {
          ok: true,
          worldId: parsed.worldId,
          worldName: parsed.worldName,
          confidence: parsed.confidence,
          model,
          usedBackup: index > 0,
        };
      }
      failures.push(`${model}：画面中未识别到 World ID`);
    } catch (error) {
      failures.push(`${model}：${error.message}`);
    }
  }

  return {
    ok: false,
    error: failures.join('；') || 'AI 未能从画面中识别 World ID。',
  };
}

async function testConnection(options) {
  const result = await listModels({ ...options, probeVision: false });
  return {
    ok: true,
    message: `连接成功，共 ${result.models.length} 个模型（视觉 ${result.visionCount} 个）。`,
    models: result.models.length,
    visionCount: result.visionCount,
  };
}

module.exports = {
  PROTOCOLS,
  buildPrompt,
  buildWorldIdPrompt,
  callModel,
  isVisionModel,
  listModels,
  normalizeBaseUrl,
  parseSummary,
  parseWorldIdResponse,
  prepareImage,
  recognizeWorldId,
  summarizePhoto,
  testConnection,
};
