import type { Photo } from '../types';
import { isAndroidShell } from './native';

/**
 * Actions that only exist in the Android shell: save a local original to the
 * system gallery, share it through the system sheet, and upload it back to the
 * paired desktop. The shared React UI calls these behind `isMobileRuntime()`.
 */

export interface ManagedActionResult {
  ok: boolean;
  error?: string;
  location?: string;
  count?: number;
  duplicate?: boolean;
  hash?: string;
  http?: number;
  text?: string;
  path?: string;
  restored?: boolean;
  canceled?: boolean;
}

export interface UploadSummary {
  ok: boolean;
  uploaded: number;
  duplicates: number;
  failed: number;
  errors: string[];
}

interface PendingAction {
  resolve: (value: ManagedActionResult) => void;
  reject: (error: Error) => void;
  timer: number;
}

const pending = new Map<string, PendingAction>();
let callbackInstalled = false;

function ensureCallback(): void {
  if (callbackInstalled || typeof window === 'undefined') return;
  callbackInstalled = true;
  window.__hoshikuzuMobileActionResult = (callbackId, json) => {
    const waiter = pending.get(callbackId);
    if (!waiter) return;
    pending.delete(callbackId);
    window.clearTimeout(waiter.timer);
    try {
      waiter.resolve(JSON.parse(json) as ManagedActionResult);
    } catch {
      waiter.reject(new Error('手机原生操作返回了无效数据。'));
    }
  };
}

function callNative(
  method: 'saveManaged' | 'shareManaged' | 'uploadManaged',
  args: string[],
  timeoutMs: number,
): Promise<ManagedActionResult> {
  return callNativeAction(method, args, timeoutMs);
}

/**
 * Invoke any Android bridge method that follows the `(callbackId, ...strings)`
 * convention. Backup export/import joins the same callback map as media
 * actions, so there is only one result dispatcher.
 */
export function callNativeAction(
  method: string,
  args: string[],
  timeoutMs: number,
): Promise<ManagedActionResult> {
  const bridge = window.HoshikuzuAndroid as unknown as
    | Record<string, unknown>
    | undefined;
  const fn = bridge && bridge[method];
  if (!bridge || typeof fn !== 'function') {
    return Promise.resolve({ ok: false, error: '手机原生操作不可用。' });
  }
  ensureCallback();
  const callbackId = `m_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      pending.delete(callbackId);
      reject(new Error('操作超时，请检查连接后重试。'));
    }, timeoutMs);
    pending.set(callbackId, { resolve, reject, timer });
    try {
      (fn as (...values: unknown[]) => void).apply(bridge, [callbackId, ...args]);
    } catch (error) {
      pending.delete(callbackId);
      window.clearTimeout(timer);
      reject(error instanceof Error ? error : new Error('手机原生操作调用失败。'));
    }
  });
}

function baseName(value: string): string {
  return String(value || '').split(/[\\/]/).filter(Boolean).pop() || '';
}

function displayName(photo: Photo): string {
  const fromAlt = photo.alt && /\.(jpe?g|png|webp|gif|avif|heic|heif|bmp)$/i.test(photo.alt)
    ? photo.alt
    : '';
  return fromAlt || baseName(photo.libraryPath || '') || `memory-${Date.now()}.jpg`;
}

function managedPhotos(photos: Photo[]): Photo[] {
  return photos.filter(
    (photo) => Boolean(photo.libraryPath) && Boolean(photo.contentHash) && !photo.missing,
  );
}

export function pairedDesktopBase(): string {
  if (!isAndroidShell()) return '';
  try {
    return window.HoshikuzuAndroid?.desktopBaseUrl?.() || '';
  } catch {
    return '';
  }
}

export async function saveManagedPhoto(photo: Photo): Promise<ManagedActionResult> {
  if (!photo.libraryPath) return { ok: false, error: '这张照片不是本地导入的原图。' };
  return callNative('saveManaged', [photo.libraryPath, displayName(photo)], 120_000);
}

export async function shareManagedPhotos(photos: Photo[]): Promise<ManagedActionResult> {
  const list = managedPhotos(photos);
  if (list.length === 0) return { ok: false, error: '没有可分享的本地原图。' };
  return callNative(
    'shareManaged',
    [JSON.stringify(list.map((photo) => photo.libraryPath))],
    60_000,
  );
}

export async function uploadManagedPhotos(
  photos: Photo[],
  onProgress?: (done: number, total: number) => void,
): Promise<UploadSummary> {
  const list = managedPhotos(photos);
  const summary: UploadSummary = {
    ok: false,
    uploaded: 0,
    duplicates: 0,
    failed: 0,
    errors: [],
  };
  if (list.length === 0) {
    summary.errors.push('没有可回传的本地原图。');
    return summary;
  }
  if (!pairedDesktopBase()) {
    summary.errors.push('请先在手机端连接电脑，再回传照片。');
    return summary;
  }

  for (let index = 0; index < list.length; index += 1) {
    const photo = list[index];
    onProgress?.(index, list.length);
    try {
      const result = await callNative(
        'uploadManaged',
        [photo.libraryPath!, displayName(photo)],
        360_000,
      );
      if (result.ok) {
        if (result.duplicate) summary.duplicates += 1;
        else summary.uploaded += 1;
      } else {
        summary.failed += 1;
        summary.errors.push(result.error || '上传失败。');
        // A revoked pairing will fail every remaining photo; stop early.
        if (result.error && /配对|连接|二维码|HTTP 401/.test(result.error)) break;
      }
    } catch (error) {
      summary.failed += 1;
      summary.errors.push(error instanceof Error ? error.message : '上传失败。');
      break;
    }
  }
  onProgress?.(list.length, list.length);
  summary.ok = summary.failed === 0 && summary.uploaded + summary.duplicates > 0;
  return summary;
}

/**
 * Remove app-private originals/previews that are no longer referenced by any
 * album entry. Called after the album state has been updated; hashes still
 * referenced by another entry are left on disk.
 */
export function deleteManagedPhotoFiles(removed: Photo[], remaining: Photo[]): void {
  if (!isAndroidShell()) return;
  const bridge = window.HoshikuzuAndroid;
  if (!bridge?.deleteManaged) return;
  const keep = new Set(
    remaining
      .map((photo) => photo.contentHash)
      .filter((hash): hash is string => typeof hash === 'string' && hash.length > 0),
  );
  const hashes = new Set(
    removed
      .map((photo) => photo.contentHash)
      .filter(
        (hash): hash is string =>
          typeof hash === 'string' && hash.length > 0 && !keep.has(hash),
      ),
  );
  for (const hash of hashes) {
    try {
      bridge.deleteManaged(hash);
    } catch {
      // File cleanup is best-effort; the album entry is already gone.
    }
  }
}
