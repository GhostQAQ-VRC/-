import type { SyncDoneResult, SyncProgress } from '../platform/desktopApi';
import type { AlbumData } from '../types';
import { mediaUrl } from '../platform/media';
import { blobToBase64, mobileHttp } from './mobileHttp';
import type { CloudConfig, SyncRuntime } from './cloudSync';

export interface BaiduSecrets {
  secretKey?: string;
  accessToken?: string;
  refreshToken?: string;
}

export interface BaiduSyncOptions extends SyncRuntime {
  baidu: BaiduSecrets;
  setSecret: (key: string, value: string) => void;
}

const CHUNK_BYTES = 4 * 1024 * 1024;

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

function md5Hex(base64: string): string {
  const native = window.HoshikuzuAndroid;
  if (!native?.md5Hex) throw new Error('手机端 MD5 服务不可用。');
  return native.md5Hex(base64);
}

async function refreshToken(
  config: CloudConfig,
  secrets: BaiduSecrets,
  setSecret: (key: string, value: string) => void,
): Promise<string> {
  if (!secrets.refreshToken || !config.baiduAppKey || !secrets.secretKey) {
    throw new Error('百度网盘 Access Token 已过期，请填写 AppKey/SecretKey + Refresh Token。');
  }
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: secrets.refreshToken,
    client_id: config.baiduAppKey,
    client_secret: secrets.secretKey,
  });
  const result = await mobileHttp({
    url: `https://openapi.baidu.com/oauth/2.0/token?${params.toString()}`,
    method: 'GET',
    headers: { Accept: 'application/json' },
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
      `百度网盘 Token 续期失败：${json?.error_description || result.error || result.status}`,
    );
  }
  setSecret('syncBaiduAccessToken', json.access_token);
  if (json.refresh_token) setSecret('syncBaiduRefreshToken', json.refresh_token);
  return json.access_token;
}

async function ensureToken(
  config: CloudConfig,
  secrets: BaiduSecrets,
  setSecret: (key: string, value: string) => void,
): Promise<string> {
  if (secrets.accessToken) return secrets.accessToken;
  return await refreshToken(config, secrets, setSecret);
}

async function formRequest(
  method: string,
  params: Record<string, string | number | undefined>,
  config: CloudConfig,
  secrets: BaiduSecrets,
  setSecret: (key: string, value: string) => void,
  retried = false,
): Promise<{ status: number; errno: number; json: any; authError: boolean }> {
  let token = await ensureToken(config, secrets, setSecret);
  const query = new URLSearchParams({ method, access_token: token });
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== null) body.set(key, String(value));
  }
  const result = await mobileHttp({
    url: `https://pan.baidu.com/rest/2.0/xpan/file?${query.toString()}`,
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: body.toString(),
    timeoutMs: 120000,
  });
  let json: any = null;
  try {
    json = result.body ? JSON.parse(result.body) : null;
  } catch {
    json = null;
  }
  const errno = Number(json?.errno ?? 0);
  const authError = [110, 111, -6].includes(errno) || result.status === 401;
  if (authError && !retried) {
    const next = await refreshToken(config, secrets, setSecret);
    secrets.accessToken = next;
    return await formRequest(method, params, config, secrets, setSecret, true);
  }
  return { status: result.status, errno, json, authError };
}

function remotePath(config: CloudConfig, segments: string[]): string {
  return `/apps/${config.baiduAppName}/${segments.join('/')}`;
}

async function ensureFolders(
  segments: string[],
  config: CloudConfig,
  secrets: BaiduSecrets,
  setSecret: (key: string, value: string) => void,
): Promise<string> {
  if (!config.baiduAppName) {
    throw new Error('请填写百度网盘开放平台的应用目录名（/apps/<应用目录名>）。');
  }
  let current: string[] = [];
  for (const segment of segments) {
    current = [...current, segment];
    const result = await formRequest(
      'create',
      { path: remotePath(config, current), isdir: 1, size: 0 },
      config,
      secrets,
      setSecret,
    );
    if (result.errno !== 0 && result.errno !== -8) {
      throw new Error(`无法创建百度网盘文件夹 ${remotePath(config, current)}（errno ${result.errno}）。`);
    }
  }
  return remotePath(config, segments);
}

async function uploadServer(
  path: string,
  uploadId: string,
  accessToken: string,
): Promise<string> {
  const params = new URLSearchParams({
    method: 'locateupload',
    appid: '250528',
    access_token: accessToken,
    path,
    uploadid: uploadId,
    upload_version: '2.0',
  });
  const result = await mobileHttp({
    url: `https://d.pcs.baidu.com/rest/2.0/pcs/file?${params.toString()}`,
    method: 'GET',
    headers: { Accept: 'application/json' },
    timeoutMs: 30000,
  });
  let json: any = null;
  try {
    json = result.body ? JSON.parse(result.body) : null;
  } catch {
    json = null;
  }
  const server =
    json?.servers?.[0]?.server ||
    json?.bak_servers?.[0]?.server ||
    (json?.host ? `https://${json.host}` : '');
  if (!server) throw new Error(`百度网盘未返回上传服务器：${json?.error_msg || result.error || ''}`);
  return String(server).replace(/\/+$/, '');
}

async function multipartChunk(chunk: Uint8Array): Promise<{ bodyBase64: string; boundary: string }> {
  const boundary = `----hoshikuzu${Date.now().toString(16)}`;
  const header = new TextEncoder().encode(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="blob"\r\nContent-Type: application/octet-stream\r\n\r\n`,
  );
  const footer = new TextEncoder().encode(`\r\n--${boundary}--\r\n`);
  const merged = new Uint8Array(header.length + chunk.length + footer.length);
  merged.set(header, 0);
  merged.set(chunk, header.length);
  merged.set(footer, header.length + chunk.length);
  return {
    bodyBase64: await blobToBase64(new Blob([merged])),
    boundary,
  };
}

async function uploadPhoto(
  photo: AlbumData['photos'][number],
  folderPath: string,
  config: CloudConfig,
  secrets: BaiduSecrets,
  setSecret: (key: string, value: string) => void,
): Promise<number> {
  const blob = await readOriginal(photo);
  const buffer = new Uint8Array(await blob.arrayBuffer());
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < buffer.length; offset += CHUNK_BYTES) {
    chunks.push(buffer.subarray(offset, Math.min(buffer.length, offset + CHUNK_BYTES)));
  }
  if (chunks.length === 0) chunks.push(new Uint8Array(0));
  const chunkBase64 = await Promise.all(
    chunks.map((chunk) => blobToBase64(new Blob([chunk]))),
  );
  const blockList = chunkBase64.map((item) => md5Hex(item));
  const wholeMd5 = md5Hex(await blobToBase64(blob));
  const sliceMd5 = md5Hex(
    await blobToBase64(new Blob([buffer.subarray(0, 256 * 1024)])),
  );
  const name = fileName(photo);
  const targetPath = `${folderPath}/${name}`;
  const pre = await formRequest(
    'precreate',
    {
      path: targetPath,
      size: buffer.length,
      isdir: 0,
      block_list: JSON.stringify(blockList),
      autoinit: 1,
      rtype: 3,
      'content-md5': wholeMd5,
      'slice-md5': sliceMd5,
    },
    config,
    secrets,
    setSecret,
  );
  if (pre.errno !== 0 || !pre.json?.uploadid) {
    throw new Error(`百度网盘预上传失败（errno ${pre.errno}）：${pre.json?.errmsg || ''}`);
  }
  const uploadId = pre.json.uploadid as string;
  const needed = Array.isArray(pre.json.block_list) && pre.json.block_list.length
    ? (pre.json.block_list as number[]).map(Number)
    : chunks.map((_, index) => index);
  const token = await ensureToken(config, secrets, setSecret);
  const server = await uploadServer(targetPath, uploadId, token);

  for (const index of needed) {
    const chunk = chunks[index];
    if (!chunk) continue;
    const { bodyBase64, boundary } = await multipartChunk(chunk);
    const query = new URLSearchParams({
      method: 'upload',
      access_token: token,
      type: 'tmpfile',
      path: targetPath,
      uploadid: uploadId,
      partseq: String(index),
    });
    const result = await mobileHttp({
      url: `${server}/rest/2.0/pcs/superfile2?${query.toString()}`,
      method: 'POST',
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      bodyBase64,
      timeoutMs: 180000,
    });
    let json: any = null;
    try {
      json = result.body ? JSON.parse(result.body) : null;
    } catch {
      json = null;
    }
    if (!result.ok || Number(json?.errno ?? 0) !== 0) {
      throw new Error(`百度网盘分片上传失败（errno ${json?.errno ?? result.status}）。`);
    }
  }

  const created = await formRequest(
    'create',
    {
      path: targetPath,
      size: buffer.length,
      isdir: 0,
      block_list: JSON.stringify(blockList),
      uploadid: uploadId,
      rtype: 3,
    },
    config,
    secrets,
    setSecret,
  );
  if (created.errno !== 0) {
    throw new Error(`百度网盘创建文件失败（errno ${created.errno}）：${created.json?.errmsg || ''}`);
  }
  return buffer.length;
}

export async function testBaidu(
  config: CloudConfig,
  secrets: BaiduSecrets,
  setSecret: (key: string, value: string) => void,
): Promise<string> {
  if (!config.baiduAppName) {
    throw new Error('请填写百度网盘开放平台的应用目录名。');
  }
  if (!secrets.accessToken && !(secrets.refreshToken && config.baiduAppKey && secrets.secretKey)) {
    throw new Error('请填写百度 Access Token，或 AppKey/SecretKey + Refresh Token。');
  }
  const token = await ensureToken(config, secrets, setSecret);
  const result = await mobileHttp({
    url: `https://pan.baidu.com/rest/2.0/xpan/nas?method=uinfo&access_token=${encodeURIComponent(token)}`,
    method: 'GET',
    headers: { Accept: 'application/json' },
    timeoutMs: 30000,
  });
  let json: any = null;
  try {
    json = result.body ? JSON.parse(result.body) : null;
  } catch {
    json = null;
  }
  if (!result.ok || Number(json?.errno ?? 0) !== 0) {
    throw new Error(`百度网盘连接失败：${json?.errmsg || result.error || result.status}`);
  }
  const name = json?.netdisk_name || json?.baidu_name || '';
  return name ? `已连接百度网盘：${name}` : '百度网盘连接正常';
}

export async function runBaiduSync(options: BaiduSyncOptions): Promise<SyncDoneResult> {
  const { config, album, onProgress, shouldCancel, baidu, setSecret } = options;
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
  const emit = (progress: SyncProgress) => onProgress(progress);
  emit({
    target: 'cloud',
    phase: 'discover',
    current: 0,
    total: selected.length,
    dates: dates.size,
    message: `准备同步 ${selected.length} 张照片`,
  });
  await ensureFolders([], config, baidu, setSecret);
  await ensureFolders(baseFolder, config, baidu, setSecret);
  let uploaded = 0;
  let failed = 0;
  let bytes = 0;
  let current = 0;
  const errors: string[] = [];

  for (const [date, list] of dates) {
    if (shouldCancel()) {
      return { target: 'cloud', ok: false, canceled: true, uploaded, failed, bytes, dates: dates.size, error: '同步已取消。' };
    }
    const folderPath = await ensureFolders([...baseFolder, date], config, baidu, setSecret);
    for (const photo of list) {
      if (shouldCancel()) {
        return { target: 'cloud', ok: false, canceled: true, uploaded, failed, bytes, dates: dates.size, error: '同步已取消。' };
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
        failed,
        bytes,
        message: `上传 ${name}`,
      });
      try {
        bytes += await uploadPhoto(photo, folderPath, config, baidu, setSecret);
        uploaded += 1;
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
    failed,
    bytes,
    message: failed ? `${failed} 张上传失败` : '百度网盘同步完成',
  });
  return {
    target: 'cloud',
    ok: failed === 0,
    uploaded,
    failed,
    bytes,
    dates: dates.size,
    errors,
    error: failed ? `${failed} 张上传失败。` : undefined,
  };
}
