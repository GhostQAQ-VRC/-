import type { PreparedImage } from './imageUpload';
import { formatFileSize } from './imageUpload';

/**
 * Video backgrounds are re-encoded entirely in the renderer (Chromium can
 * decode the source and MediaRecorder can encode VP9/VP8). Nothing is uploaded.
 *
 * Compression strategy:
 *  - Drop the audio track: a looping backdrop never plays sound, so this is the
 *    single biggest saving with zero visual loss.
 *  - Small, web-friendly files are used untouched.
 *  - Everything else is capped at 1920px on the long edge and encoded at the
 *    highest bitrate that still keeps the file near the target size.
 *  - If the first pass ends up larger than expected, one gentler retry runs at
 *    65% bitrate; visual quality stays high while the file finally fits.
 */

const MAX_INPUT_BYTES = 1024 * 1024 * 1024; // 1 GB
const KEEP_ORIGINAL_BYTES = 24 * 1024 * 1024;
const TARGET_BYTES = 20 * 1024 * 1024;
const HARD_TARGET_BYTES = 36 * 1024 * 1024;
const POSTER_MAX_EDGE = 1280;

const VIDEO_EXTENSIONS = /\.(mp4|m4v|webm|mov|ogv|ogg|mkv|avi)$/i;

export interface VideoPrepareProgress {
  stage: 'probe' | 'transcode' | 'poster' | 'done';
  percent: number;
  message: string;
}

export interface PreparedBackgroundVideo {
  blob: Blob;
  mime: string;
  width: number;
  height: number;
  duration: number;
  bytes: number;
  transcoded: boolean;
  /** Small inline JPEG of the first frame, used before the video decodes. */
  poster: string;
}

interface VideoProbe {
  width: number;
  height: number;
  duration: number;
}

function loadVideoElement(file: File): Promise<{
  video: HTMLVideoElement;
  url: string;
  dispose: () => void;
}> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    const cleanup = () => {
      video.removeAttribute('src');
      try {
        video.load();
      } catch {
        // Ignore teardown failures.
      }
    };
    video.onloadedmetadata = () => {
      if (!video.videoWidth || !video.videoHeight) {
        cleanup();
        URL.revokeObjectURL(url);
        reject(new Error('这个视频没有可用的画面轨道，请换一个文件。'));
        return;
      }
      resolve({
        video,
        url,
        dispose: () => {
          cleanup();
          URL.revokeObjectURL(url);
        },
      });
    };
    video.onerror = () => {
      cleanup();
      URL.revokeObjectURL(url);
      reject(
        new Error(
          '浏览器无法解码这个视频。请使用 MP4（H.264）、WebM 或 MOV 格式；AVI / MKV 等格式请先转换。',
        ),
      );
    };
    video.src = url;
  });
}

function probeFrom(video: HTMLVideoElement): VideoProbe {
  return {
    width: video.videoWidth,
    height: video.videoHeight,
    duration: Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0,
  };
}

function even(value: number): number {
  return Math.max(2, Math.round(value / 2) * 2);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function waitForSeek(video: HTMLVideoElement, time: number): Promise<void> {
  if (video.readyState >= 2 && Math.abs(video.currentTime - time) < 0.05) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      video.removeEventListener('seeked', finish);
      window.clearTimeout(timer);
      resolve();
    };
    const timer = window.setTimeout(finish, 3000);
    video.addEventListener('seeked', finish, { once: true });
    try {
      video.currentTime = time;
    } catch {
      finish();
    }
  });
}

function capturePoster(video: HTMLVideoElement, probe: VideoProbe): PreparedImage {
  const maxEdge = Math.max(probe.width, probe.height);
  const scale = Math.min(1, POSTER_MAX_EDGE / maxEdge);
  const width = Math.max(1, Math.round(probe.width * scale));
  const height = Math.max(1, Math.round(probe.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建视频封面画布。');
  ctx.fillStyle = '#05040b';
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(video, 0, 0, width, height);
  let quality = 0.8;
  let src = canvas.toDataURL('image/jpeg', quality);
  while (src.length > 320_000 && quality > 0.5) {
    quality -= 0.08;
    src = canvas.toDataURL('image/jpeg', quality);
  }
  return { src, width, height };
}

export function validateVideoFile(file: File): string | null {
  const extensionOk = VIDEO_EXTENSIONS.test(file.name);
  if (file.type && !file.type.startsWith('video/')) {
    return '请选择视频文件（MP4、WebM、MOV 等常见格式）。';
  }
  if (!file.type && !extensionOk) {
    return '请选择视频文件（MP4、WebM、MOV 等常见格式）。';
  }
  if (file.size > MAX_INPUT_BYTES) {
    return `视频超过 ${formatFileSize(MAX_INPUT_BYTES)}，请先裁剪或压缩后再试。`;
  }
  return null;
}

function pickRecorderMime(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
    'video/mp4;codecs=avc1',
    'video/mp4',
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? '';
}

function chooseBitrate(duration: number, attempt: number): number {
  const seconds = Math.max(2, duration);
  const ideal = (TARGET_BYTES * 8) / seconds;
  const ceiling = seconds <= 20 ? 12_000_000 : seconds <= 60 ? 8_000_000 : 5_500_000;
  const floor = seconds > 150 ? 1_200_000 : 2_400_000;
  const base = clamp(Math.round(ideal), floor, ceiling);
  return attempt === 0 ? base : Math.max(1_000_000, Math.round(base * 0.65));
}

async function encodeOnce(
  file: File,
  attempt: number,
  signal: AbortSignal | undefined,
  onProgress: (progress: VideoPrepareProgress) => void,
): Promise<{ blob: Blob; mime: string; width: number; height: number; duration: number }> {
  const { video, dispose } = await loadVideoElement(file);
  const probe = probeFrom(video);
  const mime = pickRecorderMime();
  if (!mime) {
    dispose();
    throw new Error('当前环境不支持视频转码，请使用较新版本的客户端。');
  }

  const maxEdge = probe.duration > 90 ? 1600 : 1920;
  const longest = Math.max(probe.width, probe.height);
  const scale = Math.min(1, maxEdge / longest);
  const width = even(probe.width * scale);
  const height = even(probe.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) {
    dispose();
    throw new Error('无法创建视频压缩画布。');
  }
  ctx.fillStyle = '#05040b';
  ctx.fillRect(0, 0, width, height);

  const stream = canvas.captureStream(30);
  const bitrate = chooseBitrate(probe.duration, attempt);
  const recorder = new MediaRecorder(stream, {
    mimeType: mime,
    videoBitsPerSecond: bitrate,
  });
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) chunks.push(event.data);
  };
  const stopped = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve();
  });

  let aborted = false;
  const onAbort = () => {
    aborted = true;
    try {
      recorder.stop();
    } catch {
      // Recorder may already be inactive.
    }
  };
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    recorder.start(500);
    video.currentTime = 0;
    try {
      await video.play();
    } catch {
      throw new Error('浏览器阻止了视频播放，请重新点击上传，或换一个视频格式。');
    }
    const startedAt = performance.now();

    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(
        () => reject(new Error('视频处理超时，请换一个更短的视频。')),
        Math.max(15_000, (probe.duration + 20) * 1000),
      );
      const finish = () => {
        window.clearTimeout(timer);
        resolve();
      };
      video.onended = finish;
      video.onerror = () => {
        window.clearTimeout(timer);
        reject(new Error('视频播放中断，无法完成压缩。'));
      };

      let frameHandle = 0;
      const draw = () => {
        if (aborted) return;
        if (video.ended || video.paused) {
          finish();
          return;
        }
        try {
          ctx.drawImage(video, 0, 0, width, height);
        } catch {
          // A dropped frame is fine; keep the loop alive.
        }
        const elapsed = (performance.now() - startedAt) / 1000;
        const ratio = probe.duration > 0 ? elapsed / probe.duration : 0;
        onProgress({
          stage: 'transcode',
          percent: Math.round(clamp(ratio, 0, 1) * 96),
          message:
            attempt > 0
              ? `正在二次压缩 ${Math.round(clamp(ratio, 0, 1) * 100)}%`
              : `正在压缩视频 ${Math.round(clamp(ratio, 0, 1) * 100)}%`,
        });
        const withFrames = video as HTMLVideoElement & {
          requestVideoFrameCallback?: (callback: () => void) => number;
        };
        if (typeof withFrames.requestVideoFrameCallback === 'function') {
          frameHandle = withFrames.requestVideoFrameCallback(draw);
        } else {
          frameHandle = window.requestAnimationFrame(draw);
        }
      };
      draw();
      void frameHandle;
    });

    // Let the encoder flush the last frames before closing the stream.
    await new Promise((resolve) => setTimeout(resolve, 220));
    if (recorder.state !== 'inactive') recorder.stop();
    await stopped;

    if (aborted) throw new DOMException('视频压缩已取消。', 'AbortError');
    const blob = new Blob(chunks, { type: mime.split(';')[0] });
    if (blob.size === 0) throw new Error('视频压缩结果为空，请换一个文件再试。');
    return { blob, mime, width, height, duration: probe.duration };
  } finally {
    signal?.removeEventListener('abort', onAbort);
    try {
      if (recorder.state !== 'inactive') recorder.stop();
    } catch {
      // Ignore an already stopped recorder.
    }
    stream.getTracks().forEach((track) => track.stop());
    dispose();
  }
}

/**
 * Prepare a user video for the looping backdrop. Returns the original file when
 * it is already small and web-friendly, otherwise a compressed WebM without an
 * audio track.
 */
export async function prepareBackgroundVideo(
  file: File,
  options: {
    signal?: AbortSignal;
    onProgress?: (progress: VideoPrepareProgress) => void;
  } = {},
): Promise<PreparedBackgroundVideo> {
  const validation = validateVideoFile(file);
  if (validation) throw new Error(validation);
  const report = (progress: VideoPrepareProgress) => options.onProgress?.(progress);

  report({ stage: 'probe', percent: 2, message: '正在读取视频信息…' });
  const firstPass = await loadVideoElement(file);
  let probe: VideoProbe;
  let poster: PreparedImage;
  try {
    probe = probeFrom(firstPass.video);
    report({ stage: 'poster', percent: 5, message: '正在截取封面帧…' });
    await waitForSeek(
      firstPass.video,
      Math.min(0.2, Math.max(0, probe.duration * 0.15)),
    );
    poster = capturePoster(firstPass.video, probe);
  } finally {
    firstPass.dispose();
  }

  const webFriendly =
    /^video\/(mp4|webm)$/i.test(file.type) ||
    /\.(mp4|m4v|webm)$/i.test(file.name);
  const needsTranscode =
    file.size > KEEP_ORIGINAL_BYTES ||
    !webFriendly ||
    Math.max(probe.width, probe.height) > 1920 ||
    !probe.duration;

  if (!needsTranscode) {
    report({ stage: 'done', percent: 100, message: '视频已是网页友好格式，无需压缩' });
    return {
      blob: file,
      mime: file.type || 'video/mp4',
      width: probe.width,
      height: probe.height,
      duration: probe.duration,
      bytes: file.size,
      transcoded: false,
      poster: poster.src,
    };
  }

  let attempt = 0;
  let encoded = await encodeOnce(file, attempt, options.signal, report);
  while (encoded.blob.size > HARD_TARGET_BYTES && attempt < 1) {
    attempt += 1;
    report({
      stage: 'transcode',
      percent: 0,
      message: '第一次压缩后体积仍偏大，正在进行高质量二次压缩…',
    });
    encoded = await encodeOnce(file, attempt, options.signal, report);
  }

  report({ stage: 'done', percent: 100, message: '视频压缩完成' });
  return {
    blob: encoded.blob,
    mime: 'video/webm',
    width: encoded.width,
    height: encoded.height,
    duration: encoded.duration,
    bytes: encoded.blob.size,
    transcoded: true,
    poster: poster.src,
  };
}
