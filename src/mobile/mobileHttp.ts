export interface MobileHttpRequest {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  bodyBase64?: string;
  timeoutMs?: number;
  binaryResponse?: boolean;
}

export interface MobileHttpResult {
  ok: boolean;
  status: number;
  headers: Record<string, string>;
  body?: string;
  bodyBase64?: string;
  error?: string;
}

declare global {
  interface Window {
    __hoshikuzuMobileHttpResult?: (callbackId: string, json: string) => void;
  }
}

interface PendingHttp {
  resolve: (result: MobileHttpResult) => void;
  reject: (error: Error) => void;
}

const pending = new Map<string, PendingHttp>();

export function installHttpBridge(): void {
  if (typeof window === 'undefined') return;
  window.__hoshikuzuMobileHttpResult = (callbackId, json) => {
    const waiter = pending.get(callbackId);
    if (!waiter) return;
    pending.delete(callbackId);
    try {
      waiter.resolve(JSON.parse(json) as MobileHttpResult);
    } catch {
      waiter.reject(new Error('手机网络桥返回了无效数据。'));
    }
  };
}

export function mobileHttp(request: MobileHttpRequest): Promise<MobileHttpResult> {
  const native = window.HoshikuzuAndroid;
  if (!native) {
    return Promise.reject(new Error('手机网络桥不可用。'));
  }
  const send = native.httpRequest;
  if (!send) {
    return Promise.reject(new Error('手机网络桥不可用。'));
  }
  const callbackId = `http_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return new Promise((resolve, reject) => {
    pending.set(callbackId, { resolve, reject });
    try {
      send.call(native, callbackId, JSON.stringify(request));
    } catch (error) {
      pending.delete(callbackId);
      reject(error instanceof Error ? error : new Error('手机网络桥调用失败。'));
    }
  });
}

export async function mobileRequestJson<T = unknown>(
  request: MobileHttpRequest,
): Promise<{ status: number; json: T | null; text: string }> {
  const result = await mobileHttp(request);
  const text = result.body || '';
  let json: T | null = null;
  try {
    json = text ? (JSON.parse(text) as T) : null;
  } catch {
    json = null;
  }
  if (!result.ok) {
    const message =
      (json as { error?: { message?: string } | string; message?: string } | null)?.error ||
      (json as { message?: string } | null)?.message ||
      text.slice(0, 300) ||
      result.error ||
      `HTTP ${result.status}`;
    const error = new Error(
      `API 返回 ${result.status}：${
        typeof message === 'string' ? message : JSON.stringify(message)
      }`,
    );
    (error as Error & { status?: number }).status = result.status;
    throw error;
  }
  return { status: result.status, json, text };
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < buffer.length; index += chunk) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(buffer.subarray(index, index + chunk)),
    );
  }
  return btoa(binary);
}

export async function base64ToBytes(base64: string): Promise<Uint8Array> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
