import type { WorldInfo, WorldLibraryEntry, WorldLookupResult } from '../types';
import { DEMO_LOOKUP_ID } from '../data/worlds';

export const WORLD_ID_PATTERN =
  /wrld_[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/;

export const DEMO_LOOKUP_HINT = DEMO_LOOKUP_ID;

export function extractWorldId(input: string): string | null {
  const match = input.trim().match(WORLD_ID_PATTERN);
  return match ? match[0].toLowerCase() : null;
}

export function vrchatWorldUrl(id: string): string {
  return `https://vrchat.com/home/world/${id}`;
}

export function normalizeApiBase(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

function abortError(): DOMException {
  return new DOMException('The world lookup was aborted.', 'AbortError');
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const timer = window.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(abortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

interface ProxyWorldPayload {
  id?: string;
  name?: string;
  worldName?: string;
  thumbnailUrl?: string | null;
  imageUrl?: string | null;
  authorName?: string;
  author?: { name?: string } | string;
  description?: string | null;
  capacity?: number;
}

async function lookupLive(
  id: string,
  apiBase: string,
  signal?: AbortSignal,
): Promise<WorldLookupResult> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 9000);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    const response = await fetch(`${apiBase}/worlds/${encodeURIComponent(id)}`, {
      headers: { Accept: 'application/json' },
      credentials: 'omit',
      signal: controller.signal,
    });

    if (response.status === 404) {
      return {
        status: 'error',
        code: 'not-found',
        message:
          '查询代理没有找到这个世界的资料。请检查 World ID 是否正确，或稍后重试。',
        worldId: id,
      };
    }
    if (!response.ok) {
      return {
        status: 'error',
        code: 'network',
        message: `世界查询服务返回了 ${response.status}。请确认后端代理已启动并允许跨域访问。`,
        worldId: id,
      };
    }

    const payload = (await response.json()) as ProxyWorldPayload;
    const name = payload.name ?? payload.worldName;
    if (!name) {
      return {
        status: 'error',
        code: 'bad-response',
        message: '查询服务返回的数据缺少世界名称，请检查代理接口的返回格式。',
        worldId: id,
      };
    }
    const author =
      payload.authorName ??
      (typeof payload.author === 'string' ? payload.author : payload.author?.name) ??
      '未知作者';

    const world: WorldInfo = {
      id: payload.id ?? id,
      name,
      author,
      thumbnail: payload.thumbnailUrl ?? payload.imageUrl ?? undefined,
      description: payload.description ?? undefined,
      capacity: payload.capacity,
      source: 'api',
      fetchedAt: new Date().toISOString(),
    };
    return { status: 'ok', world, source: 'live' };
  } catch (error) {
    if (signal?.aborted) throw abortError();
    const isTimeout = (error as Error).name === 'AbortError';
    return {
      status: 'error',
      code: isTimeout ? 'timeout' : 'network',
      message: isTimeout
        ? '世界资料查询超时了（9 秒）。可以再试一次，或先手动填写世界名称。'
        : '无法连接世界查询后端。真实 VRChat 世界资料必须通过已认证的后端代理获取。',
      worldId: id,
    };
  } finally {
    window.clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

export function worldInfoFromLibrary(entry: WorldLibraryEntry): WorldInfo {
  return {
    id: entry.id,
    name: entry.name,
    author: entry.author,
    thumbnail: entry.thumbnail,
    description: entry.description,
    capacity: entry.capacity,
    source: entry.source,
    fetchedAt: entry.fetchedAt,
  };
}

/**
 * Resolve a world id/link from the curated local library, or from a live
 * backend proxy when one is configured. Results always carry their source;
 * cached/built-in data is never presented as a live VRChat response.
 */
export async function lookupWorld(
  input: string,
  options: { signal?: AbortSignal; library: WorldLibraryEntry[]; apiBase?: string },
): Promise<WorldLookupResult> {
  const id = extractWorldId(input);
  if (!id) {
    return {
      status: 'error',
      code: 'invalid',
      worldId: '',
      message:
        '没有在输入中找到有效的 World ID。可以粘贴形如 wrld_xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx 的 ID，或 VRChat 世界链接。',
    };
  }

  const apiBase = normalizeApiBase(options.apiBase ?? '');
  if (apiBase) {
    try {
      // Reject obviously malformed proxy URLs before attempting fetch.
      new URL(apiBase);
    } catch {
      return {
        status: 'error',
        code: 'network',
        worldId: id,
        message: '世界查询代理地址格式不正确，请到管理台「站点设置」中检查。',
      };
    }
    return lookupLive(id, apiBase, options.signal);
  }

  await delay(220 + Math.random() * 240, options.signal);

  const entry = options.library.find(
    (item) => item.id && item.id.toLowerCase() === id.toLowerCase(),
  );
  if (!entry) {
    return {
      status: 'error',
      code: 'not-found',
      worldId: id,
      message:
        '本地世界资料库中没有这个 ID。可以在管理台「世界资料库」新增记录，或手动填写世界名称。',
    };
  }

  return { status: 'ok', world: worldInfoFromLibrary(entry), source: 'library' };
}

export function findLibraryEntryByWorld(
  library: WorldLibraryEntry[],
  world: WorldInfo | null | undefined,
): WorldLibraryEntry | undefined {
  if (!world) return undefined;
  if (world.id) {
    const byId = library.find(
      (entry) => entry.id && entry.id.toLowerCase() === world.id.toLowerCase(),
    );
    if (byId) return byId;
  }
  return library.find((entry) => !entry.id && entry.name === world.name);
}
