import type {
  AiGenerateResult,
  AiModelInfo,
  AiPhotoInput,
  AiProtocol,
} from '../platform/desktopApi';
import { mediaUrl } from '../platform/media';
import { mobileRequestJson } from './mobileHttp';

export const PROTOCOLS: AiProtocol[] = ['openai', 'anthropic', 'gemini', 'ollama'];
export const WORLD_ID_RE =
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

export interface AiServiceSettings {
  protocol: AiProtocol;
  baseUrl: string;
  primaryModel: string;
  backupModel: string;
  allowUnverifiedVision: boolean;
}

export interface AiServiceContext {
  capturedAt?: string;
  worldName?: string;
  note?: string;
  fileName?: string;
}

function assertProtocol(protocol: string): asserts protocol is AiProtocol {
  if (!PROTOCOLS.includes(protocol as AiProtocol)) throw new Error('不支持的 AI 协议。');
}

export function normalizeBaseUrl(protocol: AiProtocol, value: string): string {
  assertProtocol(protocol);
  const raw = String(value || '').trim();
  if (!raw) throw new Error('请填写 API Base URL。');
  let url: URL;
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

export function isVisionModel(
  protocol: AiProtocol,
  modelId: string,
  capabilities?: string[],
): boolean {
  const id = String(modelId || '').toLowerCase();
  if (!id) return false;
  if (protocol === 'ollama' && Array.isArray(capabilities)) {
    return capabilities.includes('vision');
  }
  if (VISION_NEGATIVE.some((pattern) => pattern.test(id))) return false;
  if (protocol === 'anthropic') return /claude-(3|4|opus|sonnet|haiku)/i.test(id);
  if (protocol === 'gemini') return /gemini-(1\.5|2|3|exp)/i.test(id);
  return VISION_POSITIVE.some((pattern) => pattern.test(id));
}

function authHeaders(protocol: AiProtocol, apiKey: string): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (protocol === 'anthropic') {
    if (apiKey) headers['x-api-key'] = apiKey;
    headers['anthropic-version'] = '2023-06-01';
    return headers;
  }
  if (protocol === 'gemini') return headers;
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  return headers;
}

async function requestJson<T = unknown>(
  url: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    timeoutMs?: number;
  } = {},
): Promise<T> {
  const { json } = await mobileRequestJson<T>({
    url,
    method: options.method || 'GET',
    headers: options.headers,
    body: options.body,
    timeoutMs: options.timeoutMs ?? 60000,
  });
  return json as T;
}

function modelEntry(
  protocol: AiProtocol,
  id: string,
  name?: string,
  capabilities?: string[],
): AiModelInfo {
  return {
    id,
    name: name || id,
    vision: isVisionModel(protocol, id, capabilities),
  };
}

async function listOpenAiModels(baseUrl: string, apiKey: string, timeoutMs: number) {
  const json = await requestJson<{
    data?: Array<{ id?: string; name?: string }>;
    models?: Array<{ id?: string; name?: string }>;
  }>(`${baseUrl}/models`, { headers: authHeaders('openai', apiKey), timeoutMs });
  const list = Array.isArray(json?.data) ? json.data : Array.isArray(json?.models) ? json.models : [];
  return list
    .map((item) => {
      const id = String(item?.id || item?.name || '').trim();
      return id ? modelEntry('openai', id, item?.name || id) : null;
    })
    .filter((item): item is AiModelInfo => item !== null);
}

async function listAnthropicModels(baseUrl: string, apiKey: string, timeoutMs: number) {
  const models: AiModelInfo[] = [];
  let afterId: string | null = null;
  for (let page = 0; page < 10; page += 1) {
    const params = new URLSearchParams({ limit: '1000' });
    if (afterId) params.set('after_id', afterId);
    const json = await requestJson<{
      data?: Array<{ id?: string; display_name?: string }>;
      has_more?: boolean;
      last_id?: string;
    }>(`${baseUrl}/models?${params.toString()}`, {
      headers: authHeaders('anthropic', apiKey),
      timeoutMs,
    });
    const data = Array.isArray(json?.data) ? json.data : [];
    for (const item of data) {
      const id = String(item?.id || '').trim();
      if (id) models.push(modelEntry('anthropic', id, item?.display_name || id));
    }
    if (!json?.has_more || data.length === 0) break;
    afterId = json.last_id || data[data.length - 1]?.id || null;
    if (!afterId) break;
  }
  return models;
}

async function listGeminiModels(baseUrl: string, apiKey: string, timeoutMs: number) {
  const models: AiModelInfo[] = [];
  let pageToken: string | null = null;
  for (let page = 0; page < 10; page += 1) {
    const params = new URLSearchParams({ key: apiKey || '', pageSize: '1000' });
    if (pageToken) params.set('pageToken', pageToken);
    const json = await requestJson<{
      models?: Array<{
        name?: string;
        displayName?: string;
        supportedGenerationMethods?: string[];
      }>;
      nextPageToken?: string;
    }>(`${baseUrl}/models?${params.toString()}`, { timeoutMs });
    const data = Array.isArray(json?.models) ? json.models : [];
    for (const item of data) {
      const methods = item?.supportedGenerationMethods || [];
      if (methods.length && !methods.includes('generateContent')) continue;
      const id = String(item?.name || '').replace(/^models\//, '');
      if (id) models.push(modelEntry('gemini', id, item?.displayName || id));
    }
    pageToken = json?.nextPageToken || null;
    if (!pageToken) break;
  }
  return models;
}

async function listOllamaModels(baseUrl: string, timeoutMs: number) {
  const json = await requestJson<{ models?: Array<{ name?: string; model?: string }> }>(
    `${baseUrl}/api/tags`,
    { timeoutMs },
  );
  const list = Array.isArray(json?.models) ? json.models : [];
  const entries = list
    .map((item) => String(item?.name || item?.model || '').trim())
    .filter(Boolean);
  const results: AiModelInfo[] = [];
  let cursor = 0;
  const worker = async () => {
    while (cursor < entries.length) {
      const index = cursor;
      cursor += 1;
      const id = entries[index];
      let capabilities: string[] | undefined;
      try {
        const show = await requestJson<{ capabilities?: string[] }>(
          `${baseUrl}/api/show`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: id }),
            timeoutMs: Math.min(timeoutMs, 10000),
          },
        );
        capabilities = Array.isArray(show?.capabilities) ? show.capabilities : undefined;
      } catch {
        capabilities = undefined;
      }
      results[index] = modelEntry('ollama', id, id, capabilities);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(4, entries.length || 1) }, () => worker()),
  );
  return results.filter(Boolean);
}

export async function listModels(options: {
  protocol: AiProtocol;
  baseUrl: string;
  apiKey: string;
  allowEmptyKey?: boolean;
  timeoutMs?: number;
}): Promise<{ ok: boolean; models: AiModelInfo[]; visionCount: number }> {
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
  let models: AiModelInfo[];
  if (protocol === 'openai') models = await listOpenAiModels(baseUrl, apiKey, timeoutMs);
  else if (protocol === 'anthropic') models = await listAnthropicModels(baseUrl, apiKey, timeoutMs);
  else if (protocol === 'gemini') models = await listGeminiModels(baseUrl, apiKey, timeoutMs);
  else models = await listOllamaModels(baseUrl, timeoutMs);
  models.sort((a, b) => Number(b.vision) - Number(a.vision) || a.id.localeCompare(b.id));
  return {
    ok: true,
    models,
    visionCount: models.filter((model) => model.vision).length,
  };
}

function buildPrompt(context: AiServiceContext = {}): string {
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

function parseSummary(raw: string): {
  summary: string;
  tags: string[];
  worldId: string | null;
  worldName: string | null;
} | null {
  const text = String(raw || '').trim();
  if (!text) return null;
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  let payload: Record<string, unknown> | null = null;
  if (start >= 0 && end > start) {
    try {
      payload = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
    } catch {
      payload = null;
    }
  }
  if (payload && typeof payload.summary === 'string') {
    const tags = Array.isArray(payload.tags)
      ? (payload.tags as unknown[])
          .filter((tag): tag is string => typeof tag === 'string' && Boolean(tag.trim()))
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

async function prepareImage(
  item: AiPhotoInput,
  maxEdge: number,
  quality: number,
): Promise<{ base64: string; mime: string }> {
  const candidates = [
    item.previewPath ? mediaUrl('preview', item.previewPath) : '',
    item.libraryPath ? mediaUrl('original', item.libraryPath) : '',
  ].filter(Boolean);
  let lastError: unknown = null;
  for (const url of candidates) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' }).catch(
        () => createImageBitmap(blob),
      );
      const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('无法创建图像画布。');
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      const dataUrl = canvas.toDataURL('image/jpeg', quality / 100);
      return { base64: dataUrl.split(',')[1] || '', mime: 'image/jpeg' };
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(
    `无法读取照片：${lastError instanceof Error ? lastError.message : '文件不可用'}`,
  );
}

function extractOpenAiText(json: any): string {
  const content = json?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((part: any) => (typeof part === 'string' ? part : part?.text || '')).join('\n');
  }
  return '';
}
function extractAnthropicText(json: any): string {
  const content = json?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((part: any) => (part?.type === 'text' ? part.text : '')).join('\n');
  }
  return '';
}
function extractGeminiText(json: any): string {
  const parts = json?.candidates?.[0]?.content?.parts;
  if (Array.isArray(parts)) return parts.map((part: any) => part?.text || '').join('\n');
  return '';
}
function extractOllamaText(json: any): string {
  return json?.message?.content || json?.response || '';
}

async function callModel(options: {
  protocol: AiProtocol;
  baseUrl: string;
  apiKey: string;
  model: string;
  prompt: string;
  image: { base64: string; mime: string };
  timeoutMs?: number;
}): Promise<string> {
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
            { type: 'image_url', image_url: { url: `data:${image.mime};base64,${image.base64}` } },
          ],
        },
      ],
      ...(supportsTemperature ? { temperature: 0.7 } : {}),
    };
    const json = await requestJson<any>(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { ...authHeaders('openai', apiKey), 'content-type': 'application/json' },
      body: JSON.stringify(body),
      timeoutMs,
    });
    return extractOpenAiText(json);
  }
  if (protocol === 'anthropic') {
    const json = await requestJson<any>(`${baseUrl}/messages`, {
      method: 'POST',
      headers: { ...authHeaders('anthropic', apiKey), 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        max_tokens: 700,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: image.mime, data: image.base64 } },
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
    const json = await requestJson<any>(url, {
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
        generationConfig: { temperature: 0.7, maxOutputTokens: 800 },
      }),
      timeoutMs,
    });
    return extractGeminiText(json);
  }
  const json = await requestJson<any>(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: false,
      messages: [{ role: 'user', content: prompt, images: [image.base64] }],
      options: { temperature: 0.7 },
    }),
    timeoutMs,
  });
  return extractOllamaText(json);
}

function candidates(settings: AiServiceSettings): string[] {
  return [settings.primaryModel, settings.backupModel]
    .map((model) => String(model || '').trim())
    .filter((model, index, list) => Boolean(model) && list.indexOf(model) === index);
}

export async function summarizePhoto(options: {
  item: AiPhotoInput;
  settings: AiServiceSettings;
  apiKey: string;
  context?: AiServiceContext;
}): Promise<AiGenerateResult> {
  const models = candidates(options.settings);
  if (models.length === 0) {
    return { ok: false, id: options.item.id, error: '请先在高级设置中选择主模型或备用模型。' };
  }
  const image = await prepareImage(options.item, 1024, 82);
  const prompt = buildPrompt(options.context || {});
  const failures: string[] = [];
  for (let index = 0; index < models.length; index += 1) {
    const model = models[index];
    const vision = isVisionModel(options.settings.protocol, model);
    if (!vision && !options.settings.allowUnverifiedVision) {
      failures.push(`${model}：未被识别为视觉模型`);
      continue;
    }
    try {
      const text = await callModel({
        protocol: options.settings.protocol,
        baseUrl: options.settings.baseUrl,
        apiKey: options.apiKey,
        model,
        prompt,
        image,
      });
      const parsed = parseSummary(text);
      if (!parsed || !parsed.summary) {
        failures.push(`${model}：返回内容为空或无法解析`);
        continue;
      }
      return {
        ok: true,
        id: options.item.id,
        state: 'done',
        summary: parsed.summary,
        tags: parsed.tags,
        worldId: parsed.worldId || undefined,
        worldName: parsed.worldName || undefined,
        model,
        usedBackup: index > 0,
        generatedAt: new Date().toISOString(),
      };
    } catch (error) {
      failures.push(`${model}：${error instanceof Error ? error.message : '调用失败'}`);
    }
  }
  return {
    ok: false,
    id: options.item.id,
    state: 'error',
    error: failures.join('；') || 'AI 生成失败。',
  };
}

function buildWorldIdPrompt(context: AiServiceContext = {}): string {
  const parts = [
    '你是 VRChat 照片资料整理助手。请仔细观察图片画面，尤其是拍立得/照片边缘、角落、底部印刷或叠加的小字，寻找以 wrld_ 开头、后接 UUID 的世界 ID，以及它附近的世界名称。',
    '只输出 JSON，不要解释，不要代码块：{"worldId":"wrld_...","worldName":"...","confidence":0.0}',
    '如果画面里确实没有可辨认的 World ID，输出 {"worldId":null,"confidence":0}。不要猜测。',
  ];
  if (context.fileName) parts.push(`文件名：${context.fileName}`);
  if (context.worldName) parts.push(`已知世界名（仅供参考）：${context.worldName}`);
  return parts.join('\n');
}

function parseWorldIdResponse(raw: string): {
  worldId: string | null;
  worldName: string | null;
  confidence: number;
} {
  const text = String(raw || '').trim();
  if (!text) return { worldId: null, worldName: null, confidence: 0 };
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  let payload: Record<string, unknown> | null = null;
  if (start >= 0 && end > start) {
    try {
      payload = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
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

export async function recognizeWorldId(options: {
  item: AiPhotoInput;
  settings: AiServiceSettings;
  apiKey: string;
  context?: AiServiceContext;
}): Promise<AiGenerateResult> {
  const models = candidates(options.settings);
  if (models.length === 0) {
    return { ok: false, id: options.item.id, error: '请先在高级设置中选择主模型或备用模型。' };
  }
  const image = await prepareImage(options.item, 2048, 90);
  const prompt = buildWorldIdPrompt({
    fileName: options.item.libraryPath?.split('/').pop(),
    worldName: options.item.worldName,
  });
  const failures: string[] = [];
  for (let index = 0; index < models.length; index += 1) {
    const model = models[index];
    const vision = isVisionModel(options.settings.protocol, model);
    if (!vision && !options.settings.allowUnverifiedVision) {
      failures.push(`${model}：未被识别为视觉模型`);
      continue;
    }
    try {
      const text = await callModel({
        protocol: options.settings.protocol,
        baseUrl: options.settings.baseUrl,
        apiKey: options.apiKey,
        model,
        prompt,
        image,
      });
      const parsed = parseWorldIdResponse(text);
      if (parsed.worldId) {
        return {
          ok: true,
          id: options.item.id,
          state: 'done',
          worldId: parsed.worldId,
          worldName: parsed.worldName || undefined,
          confidence: parsed.confidence,
          model,
          usedBackup: index > 0,
          generatedAt: new Date().toISOString(),
        };
      }
      failures.push(`${model}：画面中未识别到 World ID`);
    } catch (error) {
      failures.push(`${model}：${error instanceof Error ? error.message : '调用失败'}`);
    }
  }
  return {
    ok: false,
    id: options.item.id,
    state: 'error',
    error: failures.join('；') || 'AI 未能从画面中识别 World ID。',
  };
}

function buildOrientationPrompt(): string {
  return [
    '你是 VRChat 照片方向校对器。请判断画面内容的方向，不要根据图片文件的宽高判断。',
    '规则：',
    '1. 先判断画面里有没有“角色自拍/人物主体”。如果有角色，找到角色头部，只看头顶（发旋、耳朵上方）在画面中指向哪一边：上、右、下、左。不要判断角色面朝哪边，也不要因为角色侧脸就认为图片旋转了。',
    '2. 只有角色是画面主体时才按人物方向校正；如果人物很小、只是风景中的路人，按风景处理。',
    '3. 没有人物主体时按风景处理：风景照通常是 16:9，rotation=0，不要旋转。',
    '4. rotation 表示为了让头顶朝上需要顺时针旋转的角度：头顶朝上→0，朝右→270，朝下→180，朝左→90。',
    '只输出 JSON，不要解释，不要代码块：{"type":"selfie"|"landscape","head":"up"|"right"|"down"|"left"|"none","rotation":0|90|180|270,"confidence":0.0}',
  ].join('\n');
}

const HEAD_ROTATION: Record<string, 0 | 90 | 180 | 270> = {
  up: 0,
  right: 270,
  down: 180,
  left: 90,
};

function parseOrientationResponse(raw: string): {
  type: 'selfie' | 'landscape';
  head: 'up' | 'right' | 'down' | 'left' | 'none';
  rotation: 0 | 90 | 180 | 270;
  confidence: number;
} | null {
  const text = String(raw || '').trim();
  if (!text) return null;
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
  let payload: Record<string, unknown> | null = null;
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      payload = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
    } catch {
      payload = null;
    }
  }
  const typeMatch = cleaned.match(/"type"\s*:\s*"?(selfie|landscape)/i);
  const headMatch = cleaned.match(/"head"\s*:\s*"?(up|right|down|left|none)/i);
  const rotationMatch = cleaned.match(/"rotation"\s*:\s*(0|90|180|270)/);
  const confidenceMatch = cleaned.match(/"confidence"\s*:\s*([0-9.]+)/);
  const rawHead =
    payload && typeof payload.head === 'string'
      ? payload.head.toLowerCase()
      : headMatch
        ? headMatch[1].toLowerCase()
        : null;
  const head = ['up', 'right', 'down', 'left', 'none'].includes(rawHead || '')
    ? (rawHead as 'up' | 'right' | 'down' | 'left' | 'none')
    : null;
  const rawType =
    payload && typeof payload.type === 'string'
      ? payload.type.toLowerCase()
      : typeMatch
        ? typeMatch[1].toLowerCase()
        : null;
  const type: 'selfie' | 'landscape' | null =
    rawType === 'selfie' || rawType === 'landscape'
      ? rawType
      : head && head !== 'none'
        ? 'selfie'
        : null;
  if (!type && !head) return null;
  const numericRotation =
    payload && [0, 90, 180, 270].includes(payload.rotation as number)
      ? (payload.rotation as 0 | 90 | 180 | 270)
      : rotationMatch
        ? (Number(rotationMatch[1]) as 0 | 90 | 180 | 270)
        : null;
  let rotation: 0 | 90 | 180 | 270 = 0;
  if (type === 'selfie' && head && head !== 'none') rotation = HEAD_ROTATION[head] ?? 0;
  else if (type === 'selfie' && numericRotation !== null) rotation = numericRotation;
  else if (type === 'landscape') rotation = 0;
  else if (numericRotation !== null) rotation = numericRotation;
  let confidence = 0;
  if (payload && typeof payload.confidence === 'number') confidence = payload.confidence;
  else if (confidenceMatch) confidence = Number(confidenceMatch[1]);
  else if (head && head !== 'none') confidence = 0.7;
  else if (type === 'landscape') confidence = 0.6;
  confidence = Math.max(0, Math.min(1, Number.isFinite(confidence) ? confidence : 0));
  return {
    type: type || (head && head !== 'none' ? 'selfie' : 'landscape'),
    head: head || 'none',
    rotation,
    confidence,
  };
}

export async function detectOrientation(options: {
  item: AiPhotoInput;
  settings: AiServiceSettings;
  apiKey: string;
}): Promise<AiGenerateResult> {
  const models = candidates(options.settings);
  if (models.length === 0) {
    return { ok: false, id: options.item.id, error: '请先在高级设置中选择主模型或备用模型。' };
  }
  const image = await prepareImage(options.item, 1280, 84);
  const prompt = buildOrientationPrompt();
  const failures: string[] = [];
  for (let index = 0; index < models.length; index += 1) {
    const model = models[index];
    const vision = isVisionModel(options.settings.protocol, model);
    if (!vision && !options.settings.allowUnverifiedVision) {
      failures.push(`${model}：未被识别为视觉模型`);
      continue;
    }
    try {
      const text = await callModel({
        protocol: options.settings.protocol,
        baseUrl: options.settings.baseUrl,
        apiKey: options.apiKey,
        model,
        prompt,
        image,
      });
      const parsed = parseOrientationResponse(text);
      if (!parsed) {
        failures.push(`${model}：没有返回可用的方向 JSON`);
        continue;
      }
      if (parsed.type === 'selfie' && parsed.rotation !== 0 && parsed.confidence < 0.45) {
        failures.push(`${model}：方向判断置信度过低 (${parsed.confidence.toFixed(2)})`);
        continue;
      }
      return {
        ok: true,
        id: options.item.id,
        state: 'done',
        rotation: parsed.rotation,
        orientationType: parsed.type,
        head: parsed.head,
        confidence: parsed.confidence,
        model,
        usedBackup: index > 0,
        generatedAt: new Date().toISOString(),
      };
    } catch (error) {
      failures.push(`${model}：${error instanceof Error ? error.message : '调用失败'}`);
    }
  }
  return {
    ok: false,
    id: options.item.id,
    state: 'error',
    error: failures.join('；') || 'AI 未能判断照片方向。',
  };
}

export async function testConnection(options: {
  protocol: AiProtocol;
  baseUrl: string;
  apiKey: string;
}): Promise<{ ok: boolean; message: string; models?: number; visionCount?: number }> {
  const result = await listModels({ ...options, allowEmptyKey: options.protocol === 'ollama' });
  return {
    ok: true,
    message: `连接成功，共 ${result.models.length} 个模型（视觉 ${result.visionCount} 个）。`,
    models: result.models.length,
    visionCount: result.visionCount,
  };
}
