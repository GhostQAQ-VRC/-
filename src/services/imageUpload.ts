const MAX_FILE_BYTES = 20 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);

export interface PreparedImage {
  src: string;
  width: number;
  height: number;
}

export function validateImageFile(file: File): string | null {
  // Electron drag/drop can report an empty MIME type; fall back to the extension.
  const extensionOk = /\.(jpe?g|png|webp|avif)$/i.test(file.name);
  if (file.type) {
    if (!file.type.startsWith('image/')) return '请选择图片文件（JPG、PNG、WebP 或 AVIF）。';
    if (!ALLOWED_TYPES.has(file.type)) {
      return '暂不支持这个图片格式，请使用 JPG、PNG、WebP 或 AVIF。';
    }
  } else if (!extensionOk) {
    return '暂不支持这个图片格式，请使用 JPG、PNG、WebP 或 AVIF。';
  }
  if (file.size > MAX_FILE_BYTES) return '图片超过 20MB，请先压缩后再试。';
  return null;
}

/** Accept only direct http(s) image URLs; protocol-relative URLs become https. */
export function normalizeImageUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 4096) return null;
  const candidate = trimmed.startsWith('//') ? `https:${trimmed}` : trimmed;
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.href;
  } catch {
    return null;
  }
}

export interface RemoteImageInfo {
  src: string;
  width: number;
  height: number;
}

/** Probe a remote image through the browser so we can store its real dimensions. */
export function loadRemoteImage(src: string, timeoutMs = 15_000): Promise<RemoteImageInfo> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    let settled = false;
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      image.src = '';
      reject(new Error('读取图片超时，请检查链接是否可公开访问。'));
    }, timeoutMs);

    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      action();
    };

    image.onload = () => {
      finish(() => {
        if (!image.naturalWidth || !image.naturalHeight) {
          reject(new Error('这个链接没有返回有效图片，请换一个图片直链。'));
          return;
        }
        resolve({
          src,
          width: image.naturalWidth,
          height: image.naturalHeight,
        });
      });
    };
    image.onerror = () => {
      finish(() => {
        reject(
          new Error(
            '无法读取这张图片。请确认它是可直接访问的图片直链，并允许外链访问。',
          ),
        );
      });
    };
    image.src = src;
  });
}

function loadImageElement(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('图片读取失败，请尝试另一张图片。'));
    };
    image.src = url;
  });
}

/**
 * Downscale and compress an upload so the album can be persisted in
 * localStorage without uploading the original file anywhere.
 */
export async function prepareImage(file: File): Promise<PreparedImage> {
  const validation = validateImageFile(file);
  if (validation) throw new Error(validation);

  const image = await loadImageElement(file);
  const maxEdge = 1440;
  const scale = Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('浏览器无法处理这张图片，请尝试另一张。');
  ctx.fillStyle = '#0b0918';
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, width, height);

  let quality = 0.86;
  let src = canvas.toDataURL('image/jpeg', quality);
  while (src.length > 1_100_000 && quality > 0.58) {
    quality -= 0.08;
    src = canvas.toDataURL('image/jpeg', quality);
  }
  if (src.length > 2_000_000) {
    throw new Error('压缩后的图片仍然过大，请换一张尺寸更小的图片。');
  }
  return { src, width, height };
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Compress a user background to a manageable data URL so it can live in the
 * album settings (and therefore in backups) without exploding localStorage.
 */
export async function prepareBackgroundImage(file: File): Promise<PreparedImage> {
  if (!file.type.startsWith('image/')) {
    throw new Error('请选择 JPG、PNG、WebP 或 AVIF 图片。');
  }
  if (file.size > 30 * 1024 * 1024) {
    throw new Error('背景图片超过 30MB，请先压缩后再试。');
  }
  const image = await loadImageElement(file);
  const maxEdge = 1920;
  const scale = Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('浏览器无法处理这张图片。');
  ctx.fillStyle = '#0b0918';
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, width, height);

  let quality = 0.88;
  let src = canvas.toDataURL('image/jpeg', quality);
  while (src.length > 3_200_000 && quality > 0.6) {
    quality -= 0.07;
    src = canvas.toDataURL('image/jpeg', quality);
  }
  if (src.length > 4_400_000) {
    throw new Error('压缩后的背景仍然过大，请换一张尺寸更小的图片。');
  }
  return { src, width, height };
}
