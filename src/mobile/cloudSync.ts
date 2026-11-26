import type {
  SyncDoneResult,
  SyncProgress,
  SyncStateView,
  SyncTarget,
} from '../platform/desktopApi';
import type { AlbumData } from '../types';
import { mediaUrl } from '../platform/media';
import { blobToBase64, mobileHttp } from './mobileHttp';

export interface CloudSecrets {
  webdavPassword?: string;
  websiteToken?: string;
}

export interface CloudConfig {
  provider: string;
  folderRoot: string;
  baseFolder: string;
  skipExisting: boolean;
  uploadMetadata: boolean;
  webdavUrl: string;
  webdavUsername: string;
  googleClientId: string;
  baiduAppKey: string;
  baiduAppName: string;
}

export interface WebsiteConfig {
  endpoint: string;
  includePreviewImages: boolean;
  maxPayloadMb: number;
}

export interface SyncRuntime {
  target: SyncTarget;
  config: CloudConfig;
  website: WebsiteConfig;
  secrets: CloudSecrets;
  album: AlbumData;
  photoIds?: string[];
  onProgress: (progress: SyncProgress) => void;
  shouldCancel: () => boolean;
}

const MANIFEST_KEY = 'hoshikuzu-mobile-sync-manifest-v1';

function manifestFor(provider: string): string[] {
  try {
    const raw = localStorage.getItem(`${MANIFEST_KEY}:${provider}`);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? list.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function writeManifest(provider: string, entries: string[]) {
  try {
    localStorage.setItem(`${MANIFEST_KEY}:${provider}`, JSON.stringify(entries));
  } catch {
    // Manifest is an optimization; sync still works without it.
  }
}

export function resetCloudManifest(provider?: string) {
  try {
    if (provider) {
      localStorage.removeItem(`${MANIFEST_KEY}:${provider}`);
      return;
    }
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index);
      if (key && key.startsWith(MANIFEST_KEY)) localStorage.removeItem(key);
    }
  } catch {
    // Ignore.
  }
}

export function manifestInfo(): { count: number; updatedAt: string | null } {
  let count = 0;
  let updatedAt: string | null = null;
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key || !key.startsWith(MANIFEST_KEY)) continue;
      const list = JSON.parse(localStorage.getItem(key) || '[]') as unknown;
      if (Array.isArray(list)) count += list.length;
    }
  } catch {
    // Ignore.
  }
  return { count, updatedAt };
}

function nowIso() {
  return new Date().toISOString();
}

function stateFromResult(result: SyncDoneResult): SyncStateView {
  return {
    lastSyncAt: nowIso(),
    status: result.ok ? 'success' : result.canceled ? 'canceled' : 'error',
    message: result.error || (result.ok ? '同步完成' : '同步失败'),
    uploaded: result.uploaded ?? 0,
    skipped: result.skipped ?? 0,
    failed: result.failed ?? 0,
    bytes: result.bytes ?? 0,
  };
}

export function makeIdleState(message = '尚未同步'): SyncStateView {
  return {
    lastSyncAt: null,
    status: 'idle',
    message,
    uploaded: 0,
    skipped: 0,
    failed: 0,
    bytes: 0,
  };
}

function normalizeBase(value: string): string {
  const raw = String(value || '').trim();
  if (!raw) throw new Error('请填写 WebDAV 地址。');
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('WebDAV 地址格式不正确。');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('WebDAV 只支持 http(s) 地址。');
  }
  url.search = '';
  url.hash = '';
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

function normalizeWebsite(value: string): string {
  const raw = String(value || '').trim();
  if (!raw) throw new Error('请填写网站接口地址。');
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('网站接口地址格式不正确。');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('网站接口只支持 http(s) 地址。');
  }
  return url.toString();
}

function encodePath(value: string): string {
  return String(value || '')
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function basicAuth(username: string, password: string): string {
  const bytes = new TextEncoder().encode(`${username}:${password}`);
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return `Basic ${btoa(binary)}`;
}

function safeName(value: string, fallback = 'photo.jpg'): string {
  const name = String(value || '').split('/').pop() || '';
  const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim();
  return cleaned || fallback;
}

function photoFileName(photo: AlbumData['photos'][number]): string {
  return safeName(photo.libraryPath || `${photo.id}.jpg`);
}

function dateKey(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'unknown-date';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
}

async function readOriginal(photo: AlbumData['photos'][number]): Promise<Blob> {
  if (!photo.libraryPath) throw new Error('照片没有原图路径。');
  const response = await fetch(mediaUrl('original', photo.libraryPath));
  if (!response.ok) throw new Error(`无法读取原图（HTTP ${response.status}）。`);
  return await response.blob();
}

export async function testWebDav(config: CloudConfig, password: string): Promise<string> {
  const base = normalizeBase(config.webdavUrl);
  const result = await mobileHttp({
    url: base,
    method: 'OPTIONS',
    headers: {
      Authorization: basicAuth(config.webdavUsername, password),
      Accept: '*/*',
    },
    timeoutMs: 20000,
  });
  if (result.status === 401 || result.status === 403) {
    throw new Error('WebDAV 用户名或密码不正确。');
  }
  if (!result.ok && result.status !== 207 && result.status !== 405) {
    throw new Error(result.error || `WebDAV 返回 HTTP ${result.status}。`);
  }
  return `WebDAV 可访问（HTTP ${result.status}）。`;
}

export async function testWebsite(
  config: WebsiteConfig,
  token: string,
): Promise<string> {
  const endpoint = normalizeWebsite(config.endpoint);
  const body = JSON.stringify({
    format: 'hoshikuzu-album-sync',
    version: 1,
    kind: 'probe',
    sentAt: nowIso(),
  });
  const result = await mobileHttp({
    url: endpoint,
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Accept: 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body,
    timeoutMs: 30000,
  });
  if (!result.ok) throw new Error(result.error || `网站返回 HTTP ${result.status}。`);
  return `网站可访问（HTTP ${result.status}）。`;
}

async function ensureFolder(
  base: string,
  folder: string,
  headers: Record<string, string>,
): Promise<void> {
  const target = `${base}/${encodePath(folder)}`;
  const result = await mobileHttp({
    url: target,
    method: 'MKCOL',
    headers,
    timeoutMs: 20000,
  });
  if ([200, 201, 204, 405, 409, 301].includes(result.status)) return;
  if (result.status === 401 || result.status === 403) {
    throw new Error('WebDAV 鉴权失败。');
  }
  throw new Error(result.error || `无法创建云盘文件夹（HTTP ${result.status}）。`);
}

export async function runWebDavSync(options: SyncRuntime): Promise<SyncDoneResult> {
  const { config, secrets, album, onProgress, shouldCancel } = options;
  const base = normalizeBase(config.webdavUrl);
  const headers = {
    Authorization: basicAuth(config.webdavUsername, secrets.webdavPassword || ''),
    Accept: '*/*',
  };
  const baseFolder = String(config.baseFolder || 'Hoshikuzu Album').replace(/^\/+|\/+$/g, '');
  const manifest = new Set(manifestFor(`webdav:${base}`));
  const photos = album.photos.filter((photo) => photo.libraryPath && !photo.missing && !photo.isSample);
  const selected = options.photoIds?.length
    ? photos.filter((photo) => options.photoIds?.includes(photo.id))
    : photos;
  const dates = new Map<string, AlbumData['photos']>();
  for (const photo of selected) {
    const key = dateKey(photo.capturedAt);
    const list = dates.get(key);
    if (list) list.push(photo);
    else dates.set(key, [photo]);
  }

  onProgress({
    target: 'cloud',
    phase: 'discover',
    current: 0,
    total: selected.length,
    dates: dates.size,
    message: `准备同步 ${selected.length} 张照片`,
  });

  await ensureFolder(base, baseFolder, headers);
  let uploaded = 0;
  let skipped = 0;
  let failed = 0;
  let bytes = 0;
  const errors: string[] = [];
  let current = 0;

  for (const [date, list] of dates) {
    if (shouldCancel()) {
      return {
        target: 'cloud',
        ok: false,
        canceled: true,
        uploaded,
        skipped,
        failed,
        bytes,
        dates: dates.size,
        error: '同步已取消。',
      };
    }
    await ensureFolder(base, `${baseFolder}/${date}`, headers);
    for (const photo of list) {
      if (shouldCancel()) {
        return {
          target: 'cloud',
          ok: false,
          canceled: true,
          uploaded,
          skipped,
          failed,
          bytes,
          dates: dates.size,
          error: '同步已取消。',
        };
      }
      current += 1;
      const name = photoFileName(photo);
      const remote = `${base}/${encodePath(`${baseFolder}/${date}/${name}`)}`;
      onProgress({
        target: 'cloud',
        phase: 'upload',
        current,
        total: selected.length,
        date,
        file: name,
        uploaded,
        skipped,
        failed,
        bytes,
        message: `上传 ${name}`,
      });
      if (config.skipExisting && manifest.has(remote)) {
        skipped += 1;
        continue;
      }
      try {
        const blob = await readOriginal(photo);
        const bodyBase64 = await blobToBase64(blob);
        const result = await mobileHttp({
          url: remote,
          method: 'PUT',
          headers: {
            ...headers,
            'content-type': blob.type || 'application/octet-stream',
          },
          bodyBase64,
          timeoutMs: 180000,
        });
        if (!result.ok) {
          throw new Error(result.error || `HTTP ${result.status}`);
        }
        uploaded += 1;
        bytes += blob.size;
        manifest.add(remote);
        writeManifest(`webdav:${base}`, Array.from(manifest));
      } catch (error) {
        failed += 1;
        errors.push(`${name}：${error instanceof Error ? error.message : '上传失败'}`);
      }
    }
  }

  onProgress({
    target: 'cloud',
    phase: 'done',
    current: selected.length,
    total: selected.length,
    uploaded,
    skipped,
    failed,
    bytes,
    message: failed ? `${failed} 张上传失败` : '云盘同步完成',
  });
  return {
    target: 'cloud',
    ok: failed === 0,
    uploaded,
    skipped,
    failed,
    bytes,
    dates: dates.size,
    errors,
    error: failed ? `${failed} 张上传失败。` : undefined,
  };
}

async function previewDataUrl(photo: AlbumData['photos'][number]): Promise<string | null> {
  if (!photo.previewPath) return null;
  try {
    const response = await fetch(mediaUrl('preview', photo.previewPath));
    if (!response.ok) return null;
    const blob = await response.blob();
    return `data:${blob.type || 'image/webp'};base64,${await blobToBase64(blob)}`;
  } catch {
    return null;
  }
}

export async function runWebsiteSync(options: SyncRuntime): Promise<SyncDoneResult> {
  const { website, secrets, album, onProgress, shouldCancel } = options;
  const endpoint = normalizeWebsite(website.endpoint);
  const photos = album.photos.filter((photo) => !photo.isSample);
  const selected = options.photoIds?.length
    ? photos.filter((photo) => options.photoIds?.includes(photo.id))
    : photos;
  const includePreviews = website.includePreviewImages !== false;
  const maxBytes = Math.min(1024, Math.max(1, Number(website.maxPayloadMb) || 80)) * 1024 * 1024;
  const webPhotos: AlbumData['photos'] = [];
  let previews = 0;
  let inlineBytes = 0;

  onProgress({
    target: 'website',
    phase: 'collect',
    current: 0,
    total: selected.length,
    message: `准备 ${selected.length} 张照片的数据`,
  });

  for (let index = 0; index < selected.length; index += 1) {
    if (shouldCancel()) {
      return { target: 'website', ok: false, canceled: true, error: '同步已取消。' };
    }
    const photo = selected[index];
    const next: AlbumData['photos'][number] = { ...photo };
    if (next.mediaKind === 'library' || next.libraryPath) {
      next.mediaKind = 'embedded';
      next.isRemote = false;
      next.isUploaded = true;
      next.libraryPath = undefined;
      next.previewPath = undefined;
      next.src = '';
      if (includePreviews) {
        const dataUrl = await previewDataUrl(photo);
        if (dataUrl) {
          next.src = dataUrl;
          previews += 1;
          inlineBytes += dataUrl.length;
        }
      }
    }
    webPhotos.push(next);
    if (index % 5 === 0 || index === selected.length - 1) {
      onProgress({
        target: 'website',
        phase: 'collect',
        current: index + 1,
        total: selected.length,
        previews,
        bytes: inlineBytes,
        message: `收集缩略图 ${index + 1}/${selected.length}`,
      });
    }
  }

  const payload = {
    format: 'hoshikuzu-album-sync',
    version: 1,
    kind: 'album',
    exportedAt: nowIso(),
    library: { id: 'mobile-local', name: '手机本地相册' },
    stats: { photos: webPhotos.length, previews, inlineBytes },
    album: { ...album, photos: webPhotos, updatedAt: nowIso() },
  };
  const body = JSON.stringify(payload);
  const bytes = new Blob([body]).size;
  if (bytes > maxBytes) {
    return {
      target: 'website',
      ok: false,
      error: `即将上传的数据约 ${(bytes / 1024 / 1024).toFixed(1)}MB，超过 ${
        website.maxPayloadMb || 80
      }MB 上限。请提高上限或关闭内嵌缩略图。`,
    };
  }
  onProgress({
    target: 'website',
    phase: 'upload',
    current: webPhotos.length,
    total: selected.length,
    bytes,
    previews,
    message: `上传网站数据（约 ${(bytes / 1024 / 1024).toFixed(1)}MB）`,
  });
  const result = await mobileHttp({
    url: endpoint,
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Accept: 'application/json',
      ...(secrets.websiteToken ? { Authorization: `Bearer ${secrets.websiteToken}` } : {}),
    },
    body,
    timeoutMs: 240000,
  });
  if (!result.ok) {
    return {
      target: 'website',
      ok: false,
      error: result.error || `网站返回 HTTP ${result.status}。`,
      bytes,
      photos: webPhotos.length,
      previews,
    };
  }
  onProgress({
    target: 'website',
    phase: 'done',
    current: webPhotos.length,
    total: selected.length,
    bytes,
    previews,
    message: '网站同步完成',
  });
  return {
    target: 'website',
    ok: true,
    uploaded: webPhotos.length,
    bytes,
    photos: webPhotos.length,
    previews,
  };
}

export function syncStateFor(result: SyncDoneResult) {
  return stateFromResult(result);
}
