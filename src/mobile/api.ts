import { absoluteUrl, androidBridge } from './native';

export interface MobileWorld {
  id: string;
  name: string;
  author: string;
  thumbnail: string;
}

export interface MobilePhoto {
  id: string;
  src: string;
  originalUrl: string | null;
  alt: string;
  note: string;
  capturedAt: string;
  width: number | null;
  height: number | null;
  rotation: number;
  world: MobileWorld | null;
  fileBytes: number;
  library: boolean;
  /** Original file name, used for downloads and the share sheet. */
  fileName: string;
}

export interface MobileAlbum {
  format: 'hoshikuzu-mobile-album';
  version: number;
  appVersion: string;
  libraryName: string;
  generatedAt: string;
  mode: 'stream' | 'save';
  settings: {
    siteName: string;
    siteNameEn: string;
    tagline: string;
    theme: string;
    layout: string;
    featuredPhotoId: string | null;
  };
  stats: {
    photos: number;
    worlds: number;
    years: number;
    bytes: number;
    firstYear: number | null;
    lastYear: number | null;
  };
  photos: MobilePhoto[];
}

export interface MobileHello {
  ok: boolean;
  server: {
    app: string;
    version: string;
    libraryName: string;
    hasLibrary: boolean;
    receiveMode: 'stream' | 'save';
    serverTime: string;
    deviceId: string;
  };
}

export interface IncomingCast {
  id: string;
  at: string;
  photo: MobilePhoto;
  mode: 'stream' | 'save';
}

export class MobileApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, message: string, code = '') {
    super(message);
    this.name = 'MobileApiError';
    this.status = status;
    this.code = code;
  }
}

async function parseError(response: Response): Promise<MobileApiError> {
  let payload: { error?: string; code?: string } = {};
  try {
    payload = (await response.json()) as { error?: string; code?: string };
  } catch {
    // The server may have returned HTML (e.g. a proxy error page).
  }
  return new MobileApiError(
    response.status,
    payload.error || `请求失败（HTTP ${response.status}）`,
    payload.code || '',
  );
}

export async function mobileFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    cache: 'no-store',
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.headers || {}),
    },
  });
  if (!response.ok) throw await parseError(response);
  const type = response.headers.get('content-type') || '';
  if (!type.includes('application/json')) {
    throw new MobileApiError(
      200,
      '当前地址不是桌面客户端的手机同步服务，请从「手机同步」里的二维码打开。',
      'not-mobile',
    );
  }
  return (await response.json()) as T;
}

export function fetchHello(): Promise<MobileHello> {
  return mobileFetch<MobileHello>('/api/mobile/hello');
}

export function fetchAlbum(): Promise<MobileAlbum> {
  return mobileFetch<MobileAlbum>('/api/mobile/album');
}

export function setReceiveMode(mode: 'stream' | 'save'): Promise<{ ok: boolean; mode: 'stream' | 'save' }> {
  return mobileFetch('/api/mobile/mode', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode }),
  });
}

export function leaveSession(): Promise<{ ok: boolean }> {
  return mobileFetch<{ ok: boolean }>('/api/mobile/leave', { method: 'POST' }).catch(() => ({
    ok: false,
  }));
}

export function photoDownloadUrl(photo: MobilePhoto): string | null {
  if (!photo.originalUrl) return null;
  if (/^https?:\/\//i.test(photo.originalUrl)) return photo.originalUrl;
  return `${photo.originalUrl}${photo.originalUrl.includes('?') ? '&' : '?'}download=1`;
}

export function photoFileName(photo: MobilePhoto): string {
  if (photo.fileName && /\.(jpe?g|png|webp|gif|avif|heic|heif|bmp)$/i.test(photo.fileName)) {
    return photo.fileName;
  }
  const source = photo.originalUrl || photo.src || '';
  const base = source.split('?')[0].split('/').filter(Boolean).pop() || '';
  const decoded = (() => {
    try {
      return decodeURIComponent(base);
    } catch {
      return base;
    }
  })();
  if (/\.(jpe?g|png|webp|gif|avif|heic|heif|bmp)$/i.test(decoded)) return decoded;
  const ext = photo.src.includes('.png') ? 'png' : 'jpg';
  return `hoshikuzu-${photo.id.replace(/[^\w-]/g, '').slice(-16) || Date.now()}.${ext}`;
}

function triggerAnchorDownload(url: string, filename: string, objectUrl?: string) {
  const anchor = document.createElement('a');
  anchor.href = objectUrl || url;
  anchor.download = filename;
  anchor.target = '_blank';
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  // If a browser ignores `download`, target=_blank keeps the app page (and its
  // SSE session) alive instead of navigating away from it.
  window.setTimeout(() => anchor.remove(), 1000);
}

/**
 * Start a browser download without fetching the bytes first. Save mode uses
 * this immediately when a cast arrives; if the browser blocks it, the visible
 * "保存到手机" button performs the full fetch/share/drop path.
 */
export function startDirectDownload(photo: MobilePhoto): boolean {
  const url = photoDownloadUrl(photo);
  if (!url) return false;
  const bridge = androidBridge();
  if (bridge) {
    // The APK shell streams the original with the WebView's pairing cookie and
    // writes it to Downloads; no blob or base64 copy is needed.
    if (bridge.saveUrl(photoFileName(photo), absoluteUrl(url))) return true;
  }
  triggerAnchorDownload(url, photoFileName(photo));
  return true;
}

/**
 * Save an original to the phone. Web Share with files is the only path that
 * can put the image into the iOS Photos app; other browsers fall back to a
 * normal download. Returns how it was saved so the UI can explain what happened.
 */
export async function savePhotoToPhone(
  photo: MobilePhoto,
  options: {
    onProgress?: (loaded: number, total: number) => void;
    signal?: AbortSignal;
  } = {},
): Promise<'shared' | 'downloaded' | 'started'> {
  const url = photoDownloadUrl(photo);
  if (!url) throw new Error('这张照片没有可保存的原图。');
  const filename = photoFileName(photo);

  const bridge = androidBridge();
  if (bridge) {
    if (bridge.saveUrl(filename, absoluteUrl(url))) {
      options.onProgress?.(photo.fileBytes || 1, photo.fileBytes || 1);
      // Native download runs on a background thread; its own Toast reports
      // completion, so the page only acknowledges that saving has started.
      return 'started';
    }
    throw new Error('手机保存失败，请重试。');
  }

  let blob: Blob | null = null;
  try {
    const response = await fetch(url, { credentials: 'same-origin', signal: options.signal });
    if (!response.ok) throw new Error(`原图读取失败（HTTP ${response.status}）`);
    const total = Number(response.headers.get('content-length') || photo.fileBytes || 0);
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    if (response.body && options.onProgress && total > 0) {
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let loaded = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          loaded += value.byteLength;
          options.onProgress(loaded, total);
        }
      }
      blob = new Blob(chunks, { type: contentType });
    } else {
      blob = await response.blob();
      options.onProgress?.(blob.size, blob.size || photo.fileBytes || 0);
    }
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') throw error;
    // Cross-origin remote photo or a proxy that strips CORS: let the browser
    // download it directly.
    triggerAnchorDownload(url, filename);
    return 'downloaded';
  }

  const file = new File([blob], filename, { type: blob.type || 'image/jpeg' });
  const nav = navigator as Navigator & {
    canShare?: (data: { files?: File[] }) => boolean;
    share?: (data: { files?: File[]; title?: string; text?: string }) => Promise<void>;
  };
  if (nav.canShare?.({ files: [file] }) && nav.share) {
    try {
      await nav.share({
        files: [file],
        title: photo.note || '时光轴照片',
        text: '来自电脑端时光轴相册的投送',
      });
      return 'shared';
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') throw error;
      // Sharing failed (e.g. unsupported file type); fall through to download.
    }
  }

  const objectUrl = URL.createObjectURL(blob);
  triggerAnchorDownload(url, filename, objectUrl);
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  return 'downloaded';
}

export function formatPhotoDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function formatPhotoTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

export function formatMonthTitle(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '未知日期';
  return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function orientedRatio(photo: MobilePhoto): number {
  const width = photo.width || 4;
  const height = photo.height || 3;
  const rotated = photo.rotation === 90 || photo.rotation === 270;
  const w = rotated ? height : width;
  const h = rotated ? width : height;
  return Math.max(0.5, Math.min(2, w / h));
}
