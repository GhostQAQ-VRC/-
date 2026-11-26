import type { SyncDoneResult, SyncProgress } from '../platform/desktopApi';
import type { AlbumData } from '../types';
import { mediaUrl } from '../platform/media';
import { blobToBase64, mobileHttp, type MobileHttpResult } from './mobileHttp';
import type { CloudConfig, SyncRuntime } from './cloudSync';

export interface GoogleSecrets {
  clientSecret?: string;
  accessToken?: string;
  refreshToken?: string;
}

export interface GoogleSyncOptions extends SyncRuntime {
  google: GoogleSecrets;
  setSecret: (key: string, value: string) => void;
}

function headerValue(headers: Record<string, string>, name: string): string {
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers || {})) {
    if (key.toLowerCase() === lower) return value;
  }
  return '';
}

function dateKey(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'unknown-date';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
}

function fileName(photo: AlbumData['photos'][number]): string {
  const name = String(photo.libraryPath || `${photo.id}.jpg`).split('/').pop() || 'photo.jpg';
  return name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim() || 'photo.jpg';
}

async function readOriginal(photo: AlbumData['photos'][number]): Promise<Blob> {
  if (!photo.libraryPath) throw new Error('照片没有原图路径。');
  const response = await fetch(mediaUrl('original', photo.libraryPath));
  if (!response.ok) throw new Error(`无法读取原图（HTTP ${response.status}）。`);
  return await response.blob();
}

async function refreshGoogleToken(
  config: CloudConfig,
  secrets: GoogleSecrets,
  setSecret: (key: string, value: string) => void,
): Promise<string> {
  if (!secrets.refreshToken || !config.googleClientId || !secrets.clientSecret) {
    throw new Error('Google Access Token 已过期，请填写 Client ID/Secret + Refresh Token。');
  }
  const body = new URLSearchParams({
    client_id: config.googleClientId,
    client_secret: secrets.clientSecret,
    refresh_token: secrets.refreshToken,
    grant_type: 'refresh_token',
  }).toString();
  const result = await mobileHttp({
    url: 'https://oauth2.googleapis.com/token',
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body,
    timeoutMs: 30000,
  });
  let json: any = null;
  try {
    json = result.body ? JSON.parse(result.body) : null;
  } catch {
    json = null;
  }
  if (!result.ok || !json?.access_token) {
    throw new Error(
      `Google Token 续期失败：${json?.error_description || result.error || result.status}`,
    );
  }
  setSecret('syncGoogleAccessToken', json.access_token);
  if (json.refresh_token) setSecret('syncGoogleRefreshToken', json.refresh_token);
  return json.access_token;
}

async function ensureToken(
  config: CloudConfig,
  secrets: GoogleSecrets,
  setSecret: (key: string, value: string) => void,
): Promise<string> {
  if (secrets.accessToken) return secrets.accessToken;
  return await refreshGoogleToken(config, secrets, setSecret);
}

async function googleRequest(
  url: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    bodyBase64?: string;
    timeoutMs?: number;
  },
  token: string,
): Promise<MobileHttpResult> {
  return await mobileHttp({
    url,
    method: options.method || 'GET',
    headers: {
      Accept: 'application/json',
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`,
    },
    body: options.body,
    bodyBase64: options.bodyBase64,
    timeoutMs: options.timeoutMs ?? 120000,
  });
}

async function googleApi(
  url: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    bodyBase64?: string;
    timeoutMs?: number;
  },
  config: CloudConfig,
  secrets: GoogleSecrets,
  setSecret: (key: string, value: string) => void,
): Promise<MobileHttpResult> {
  let token = await ensureToken(config, secrets, setSecret);
  let result = await googleRequest(url, options, token);
  if (result.status === 401) {
    token = await refreshGoogleToken(config, secrets, setSecret);
    secrets.accessToken = token;
    result = await googleRequest(url, options, token);
  }
  if (!result.ok) {
    let message = result.error || '';
    try {
      const json = result.body ? JSON.parse(result.body) : null;
      message = json?.error?.message || message;
    } catch {
      // Keep the transport error.
    }
    throw new Error(`Google Drive 请求失败（HTTP ${result.status}）：${message || '未知错误'}`);
  }
  return result;
}

async function ensureFolder(
  segments: string[],
  config: CloudConfig,
  secrets: GoogleSecrets,
  setSecret: (key: string, value: string) => void,
  cache: Map<string, string>,
): Promise<string> {
  let parent = 'root';
  for (const segment of segments) {
    const key = `${parent}/${segment}`;
    if (cache.has(key)) {
      parent = cache.get(key)!;
      continue;
    }
    const escaped = String(segment).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const q = `name = '${escaped}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false and '${parent}' in parents`;
    const params = new URLSearchParams({
      q,
      fields: 'files(id,name)',
      pageSize: '10',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
    });
    const found = await googleApi(
      `https://www.googleapis.com/drive/v3/files?${params.toString()}`,
      {},
      config,
      secrets,
      setSecret,
    );
    const parsed = found.body ? JSON.parse(found.body) : null;
    let folderId = parsed?.files?.[0]?.id;
    if (!folderId) {
      const created = await googleApi(
        'https://www.googleapis.com/drive/v3/files?fields=id&supportsAllDrives=true',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name: segment,
            mimeType: 'application/vnd.google-apps.folder',
            parents: [parent],
          }),
        },
        config,
        secrets,
        setSecret,
      );
      const createdJson = created.body ? JSON.parse(created.body) : null;
      folderId = createdJson?.id;
      if (!folderId) throw new Error('无法创建 Google Drive 文件夹。');
    }
    cache.set(key, folderId);
    parent = folderId;
  }
  return parent;
}

export async function testGoogle(
  config: CloudConfig,
  secrets: GoogleSecrets,
  setSecret: (key: string, value: string) => void,
): Promise<string> {
  if (
    !secrets.accessToken &&
    !(secrets.refreshToken && config.googleClientId && secrets.clientSecret)
  ) {
    throw new Error('请填写 Google Access Token，或 Client ID/Secret + Refresh Token。');
  }
  const result = await googleApi(
    'https://www.googleapis.com/drive/v3/about?fields=user,storageQuota',
    {},
    config,
    secrets,
    setSecret,
  );
  const json = result.body ? JSON.parse(result.body) : null;
  const email = json?.user?.emailAddress || json?.user?.displayName;
  return email ? `已连接 Google Drive：${email}` : 'Google Drive 连接正常';
}

export async function runGoogleSync(options: GoogleSyncOptions): Promise<SyncDoneResult> {
  const { config, album, onProgress, shouldCancel, google, setSecret } = options;
  const photos = album.photos.filter(
    (photo) => photo.libraryPath && !photo.missing && !photo.isSample,
  );
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
  const baseFolder = String(config.baseFolder || 'Hoshikuzu Album')
    .split('/')
    .filter(Boolean);
  const cache = new Map<string, string>();
  const emit = (progress: SyncProgress) => onProgress(progress);
  emit({
    target: 'cloud',
    phase: 'discover',
    current: 0,
    total: selected.length,
    dates: dates.size,
    message: `准备同步 ${selected.length} 张照片`,
  });
  await ensureFolder(baseFolder, config, google, setSecret, cache);
  let uploaded = 0;
  let skipped = 0;
  let failed = 0;
  let bytes = 0;
  let current = 0;
  const errors: string[] = [];

  for (const [date, list] of dates) {
    if (shouldCancel()) {
      return { target: 'cloud', ok: false, canceled: true, uploaded, skipped, failed, bytes, dates: dates.size, error: '同步已取消。' };
    }
    const folderId = await ensureFolder(
      [...baseFolder, date],
      config,
      google,
      setSecret,
      cache,
    );
    for (const photo of list) {
      if (shouldCancel()) {
        return { target: 'cloud', ok: false, canceled: true, uploaded, skipped, failed, bytes, dates: dates.size, error: '同步已取消。' };
      }
      current += 1;
      const name = fileName(photo);
      emit({
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
      try {
        const blob = await readOriginal(photo);
        const size = blob.size;
        const init = await googleApi(
          'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,size&supportsAllDrives=true',
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-upload-content-type': blob.type || 'application/octet-stream',
              'x-upload-content-length': String(size),
            },
            body: JSON.stringify({ name, parents: [folderId] }),
          },
          config,
          google,
          setSecret,
        );
        const location = headerValue(init.headers, 'location');
        if (!location) throw new Error('Google Drive 未返回上传地址。');
        const bodyBase64 = await blobToBase64(blob);
        const put = await mobileHttp({
          url: location,
          method: 'PUT',
          headers: {
            'content-type': blob.type || 'application/octet-stream',
            'content-length': String(size),
          },
          bodyBase64,
          timeoutMs: 240000,
        });
        if (!put.ok) throw new Error(put.error || `HTTP ${put.status}`);
        uploaded += 1;
        bytes += size;
      } catch (error) {
        failed += 1;
        errors.push(`${name}：${error instanceof Error ? error.message : '上传失败'}`);
      }
    }
  }
  emit({
    target: 'cloud',
    phase: 'done',
    current: selected.length,
    total: selected.length,
    uploaded,
    skipped,
    failed,
    bytes,
    message: failed ? `${failed} 张上传失败` : 'Google Drive 同步完成',
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
