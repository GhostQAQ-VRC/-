import { useEffect, useRef, useState } from 'react';
import { Check, Film, ImagePlus, Loader2, Play, Trash2 } from 'lucide-react';
import type { AlbumSettings, BackgroundEffectId } from '../types';
import { BACKGROUND_EFFECTS } from '../data/appearance';
import { formatFileSize, prepareBackgroundImage } from '../services/imageUpload';
import {
  prepareBackgroundVideo,
  validateVideoFile,
  type VideoPrepareProgress,
} from '../services/videoBackground';
import {
  deleteBackgroundVideo,
  putBackgroundVideo,
} from '../services/backgroundVideoStore';
import { createId } from '../services/albumStorage';
import { getDesktopBridge } from '../platform';
import { useToast } from '../hooks/useToast';

type PickerSettings = Pick<
  AlbumSettings,
  | 'backgroundEffect'
  | 'experimentalEffects'
  | 'customBackgroundSrc'
  | 'customBackgroundName'
  | 'customVideoKey'
  | 'customVideoName'
  | 'customVideoPoster'
  | 'customVideoBytes'
>;

interface BackgroundEffectPickerProps {
  settings: PickerSettings;
  onChange: (patch: Partial<AlbumSettings>) => void;
  compact?: boolean;
  tone?: 'dark' | 'light';
}

export function BackgroundEffectPicker({
  settings,
  onChange,
  compact = false,
  tone = 'dark',
}: BackgroundEffectPickerProps) {
  const { pushToast } = useToast();
  const bridge = getDesktopBridge();
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [videoProgress, setVideoProgress] = useState<VideoPrepareProgress | null>(null);

  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  const choose = (id: BackgroundEffectId) => {
    if (id === 'custom' && !settings.customBackgroundSrc) {
      imageInputRef.current?.click();
      return;
    }
    if (id === 'video' && !settings.customVideoKey) {
      videoInputRef.current?.click();
      return;
    }
    onChange({ backgroundEffect: id });
  };

  const uploadImage = async (file: File) => {
    setBusy(true);
    try {
      const prepared = await prepareBackgroundImage(file);
      onChange({
        backgroundEffect: 'custom',
        customBackgroundSrc: prepared.src,
        customBackgroundName: file.name,
      });
      pushToast({
        tone: 'success',
        title: '自定义背景已应用',
        description: `${prepared.width}×${prepared.height} · 已压缩保存，会随备份导出。`,
      });
    } catch (error) {
      pushToast({
        tone: 'danger',
        title: '背景上传失败',
        description: (error as Error).message,
      });
    } finally {
      setBusy(false);
      if (imageInputRef.current) imageInputRef.current.value = '';
    }
  };

  const uploadVideo = async (file: File) => {
    const validation = validateVideoFile(file);
    if (validation) {
      pushToast({ tone: 'warning', title: '无法使用这个视频', description: validation });
      if (videoInputRef.current) videoInputRef.current.value = '';
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setVideoProgress({ stage: 'probe', percent: 1, message: '准备处理视频…' });
    try {
      const prepared = await prepareBackgroundVideo(file, {
        signal: controller.signal,
        onProgress: setVideoProgress,
      });
      let key = '';
      if (bridge) {
        const result = await bridge.background.saveVideo({
          name: file.name,
          mime: prepared.mime,
          data: await prepared.blob.arrayBuffer(),
        });
        if (!result.ok || !result.key) {
          throw new Error(result.error || '视频背景保存失败。');
        }
        key = result.key;
        if (settings.customVideoKey && settings.customVideoKey !== key) {
          void bridge.background.deleteVideo(settings.customVideoKey).catch(() => {});
        }
      } else {
        key = createId('bgv');
        await putBackgroundVideo(key, prepared.blob, prepared.mime, file.name);
        if (settings.customVideoKey) {
          void deleteBackgroundVideo(settings.customVideoKey).catch(() => {});
        }
      }

      onChange({
        backgroundEffect: 'video',
        customVideoKey: key,
        customVideoName: file.name,
        customVideoPoster: prepared.poster,
        customVideoMime: prepared.mime,
        customVideoBytes: prepared.bytes,
        customVideoWidth: prepared.width,
        customVideoHeight: prepared.height,
      });
      pushToast({
        tone: 'success',
        title: '视频背景已应用',
        description: prepared.transcoded
          ? `${prepared.width}×${prepared.height} · ${formatFileSize(prepared.bytes)} · 已去除音轨并高质量压缩`
          : `${prepared.width}×${prepared.height} · ${formatFileSize(prepared.bytes)} · 原视频已是网页格式，未重新压缩`,
      });
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        pushToast({ tone: 'warning', title: '已取消视频处理' });
      } else {
        pushToast({
          tone: 'danger',
          title: '视频背景处理失败',
          description: (error as Error).message,
        });
      }
    } finally {
      abortRef.current = null;
      setBusy(false);
      setVideoProgress(null);
      if (videoInputRef.current) videoInputRef.current.value = '';
    }
  };

  const clearImage = () => {
    onChange({
      backgroundEffect:
        settings.backgroundEffect === 'custom'
          ? settings.customVideoKey
            ? 'video'
            : 'stars'
          : settings.backgroundEffect,
      customBackgroundSrc: undefined,
      customBackgroundName: undefined,
    });
  };

  const clearVideo = () => {
    if (settings.customVideoKey) {
      if (bridge) {
        void bridge.background.deleteVideo(settings.customVideoKey).catch(() => {});
      } else {
        void deleteBackgroundVideo(settings.customVideoKey).catch(() => {});
      }
    }
    onChange({
      backgroundEffect:
        settings.backgroundEffect === 'video'
          ? settings.customBackgroundSrc
            ? 'custom'
            : 'stars'
          : settings.backgroundEffect,
      customVideoKey: undefined,
      customVideoName: undefined,
      customVideoPoster: undefined,
      customVideoMime: undefined,
      customVideoBytes: undefined,
      customVideoWidth: undefined,
      customVideoHeight: undefined,
    });
  };

  return (
    <div className={`background-picker${compact ? ' is-compact' : ''}`}>
      <div className="background-grid">
        {BACKGROUND_EFFECTS.filter(
          (effect) => effect.id !== 'blackhole' || settings.experimentalEffects,
        ).map((effect) => {
          const active = settings.backgroundEffect === effect.id;
          const isCustomImage = effect.id === 'custom';
          const isVideo = effect.id === 'video';
          const imageSrc = isCustomImage ? settings.customBackgroundSrc : undefined;
          const videoPoster = isVideo ? settings.customVideoPoster : undefined;
          const mediaSrc = imageSrc || videoPoster;
          return (
            <button
              key={effect.id}
              type="button"
              className={`background-card${active ? ' is-active' : ''}${
                isVideo ? ' background-card--video' : ''
              }`}
              onClick={() => choose(effect.id)}
              aria-pressed={active}
              title={effect.description}
              disabled={busy}
            >
              <span
                className={`background-card__preview background-card__preview--${effect.id}`}
                style={{
                  background: mediaSrc ? undefined : effect.preview,
                  backgroundImage: mediaSrc ? `url("${mediaSrc}")` : undefined,
                }}
                aria-hidden="true"
              >
                {isCustomImage && !imageSrc ? <ImagePlus size={18} /> : null}
                {isVideo && !videoPoster ? <Film size={18} /> : null}
                {isVideo && videoPoster ? (
                  <span className="background-card__play">
                    <Play size={13} fill="currentColor" />
                  </span>
                ) : null}
                {active ? (
                  <span className="background-card__check">
                    <Check size={11} />
                  </span>
                ) : null}
              </span>
              <span className="background-card__body">
                <strong>{effect.name}</strong>
                <small>{effect.en}</small>
              </span>
            </button>
          );
        })}
      </div>

      <input
        ref={imageInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/avif"
        className="visually-hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void uploadImage(file);
        }}
      />
      <input
        ref={videoInputRef}
        type="file"
        accept="video/mp4,video/webm,video/quicktime,video/x-m4v,video/ogg,video/*,.mp4,.m4v,.webm,.mov,.ogv"
        className="visually-hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void uploadVideo(file);
        }}
      />

      {videoProgress ? (
        <div className="background-video-progress" role="status" aria-live="polite">
          <div className="background-video-progress__head">
            <span>{videoProgress.message}</span>
            <span>{videoProgress.percent}%</span>
          </div>
          <div className="background-video-progress__bar">
            <span style={{ width: `${Math.max(2, videoProgress.percent)}%` }} />
          </div>
          <button
            type="button"
            className="text-button text-button--danger"
            onClick={() => abortRef.current?.abort()}
          >
            取消处理
          </button>
        </div>
      ) : null}

      <div className="background-picker__footer">
        {settings.customVideoKey ? (
          <div className="background-picker__item">
            <span className="background-picker__name" title={settings.customVideoName}>
              视频：{settings.customVideoName || '背景视频'}
              {settings.customVideoBytes
                ? ` · ${formatFileSize(settings.customVideoBytes)}`
                : ''}
            </span>
            <button
              type="button"
              className="text-button"
              onClick={() => videoInputRef.current?.click()}
              disabled={busy}
            >
              <Film size={13} />
              更换
            </button>
            <button
              type="button"
              className="text-button text-button--danger"
              onClick={clearVideo}
              disabled={busy}
            >
              <Trash2 size={13} />
              移除
            </button>
          </div>
        ) : null}
        {settings.customBackgroundSrc ? (
          <div className="background-picker__item">
            <span className="background-picker__name" title={settings.customBackgroundName}>
              图片：{settings.customBackgroundName || '背景图片'}
            </span>
            <button
              type="button"
              className="text-button"
              onClick={() => imageInputRef.current?.click()}
              disabled={busy}
            >
              <ImagePlus size={13} />
              更换
            </button>
            <button
              type="button"
              className="text-button text-button--danger"
              onClick={clearImage}
              disabled={busy}
            >
              <Trash2 size={13} />
              移除
            </button>
          </div>
        ) : null}
        {!settings.customVideoKey && !settings.customBackgroundSrc ? (
          <>
            <button
              type="button"
              className="text-button"
              onClick={() => imageInputRef.current?.click()}
              disabled={busy}
            >
              {busy ? <Loader2 size={13} className="spinner" /> : <ImagePlus size={13} />}
              {busy ? '正在处理背景…' : '上传自定义图片'}
            </button>
            <button
              type="button"
              className="text-button"
              onClick={() => videoInputRef.current?.click()}
              disabled={busy}
            >
              <Film size={13} />
              导入视频背景
            </button>
          </>
        ) : null}
        {settings.customVideoKey && !settings.customBackgroundSrc ? (
          <button
            type="button"
            className="text-button"
            onClick={() => imageInputRef.current?.click()}
            disabled={busy}
          >
            <ImagePlus size={13} />
            同时上传图片背景
          </button>
        ) : null}
      </div>
      {!compact ? (
        <p className="field-hint">
          图片会压缩到 1920px 以内的 JPEG；视频支持 MP4 / WebM / MOV 等常见格式（单个不超过 1GB），体积过大时会自动去除音轨并智能压缩到适合做背景的大小，画面保持高清。视频存放在存储库缓存或浏览器 IndexedDB 中，不会上传。
        </p>
      ) : null}
      {tone === 'light' &&
      ['blackhole', 'aurora', 'rain', 'sakura', 'fireflies', 'video'].includes(
        settings.backgroundEffect,
      ) ? (
        <p className="field-hint advanced-checkbox-warning">
          这个特效按暗色场景设计，亮色主题下文字对比度可能不足，建议搭配暮色紫 / 樱夜 / 月白等暗色主题。
        </p>
      ) : null}
    </div>
  );
}
