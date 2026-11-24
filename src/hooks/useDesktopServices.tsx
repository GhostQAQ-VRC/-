import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { AlbumApi } from './useAlbum';
import type {
  AiBatchDone,
  AiBatchMode,
  AiBatchProgress,
  AiGenerateResult,
  AiPhotoInput,
} from '../platform';
import { getDesktopBridge } from '../platform';
import { desktopDraftToPhotoDraft } from '../platform/importPhotos';
import type { AiSummaryResult } from '../types';
import { useToast } from './useToast';

export type AiBatchScope = 'missing' | 'all' | 'ids';

export interface AiBatchState {
  running: boolean;
  mode: AiBatchMode;
  current: number;
  total: number;
  done: number;
  failed: number;
  currentId?: string;
  last?: AiBatchDone | null;
}

interface DesktopServicesValue {
  aiBatch: AiBatchState;
  startAiBatch: (
    scope: AiBatchScope,
    ids?: string[],
    mode?: AiBatchMode,
  ) => Promise<{ ok: boolean; total?: number; error?: string }>;
  cancelAiBatch: () => Promise<void>;
}

const DesktopServicesContext = createContext<DesktopServicesValue | null>(null);

function resultToSummary(result: AiGenerateResult): AiSummaryResult | null {
  if (!result.id) return null;
  return {
    id: result.id,
    state: result.state ?? (result.ok ? 'done' : 'error'),
    summary: result.summary,
    tags: result.tags,
    model: result.model,
    usedBackup: result.usedBackup,
    error: result.error,
    generatedAt: result.generatedAt,
  };
}

export function DesktopServicesProvider({
  album,
  children,
}: {
  album: AlbumApi;
  children: ReactNode;
}) {
  const bridge = getDesktopBridge();
  const { pushToast } = useToast();
  const albumRef = useRef(album);
  albumRef.current = album;

  const [aiBatch, setAiBatch] = useState<AiBatchState>({
    running: false,
    mode: 'summary',
    current: 0,
    total: 0,
    done: 0,
    failed: 0,
    last: null,
  });
  const pendingResults = useRef(new Map<string, AiGenerateResult>());
  const flushTimer = useRef<number | null>(null);

  const flushAiResults = useCallback(() => {
    if (flushTimer.current) {
      window.clearTimeout(flushTimer.current);
      flushTimer.current = null;
    }
    const entries = Array.from(pendingResults.current.values())
      .map(resultToSummary)
      .filter((entry): entry is AiSummaryResult => entry !== null);
    pendingResults.current.clear();
    if (entries.length) albumRef.current.applyAiResults(entries);
  }, []);

  useEffect(() => {
    if (!bridge) return;

    const offIncoming = bridge.transfer.onIncoming((draft) => {
      const exists = albumRef.current.photos.some(
        (photo) => photo.contentHash && photo.contentHash === draft.contentHash,
      );
      if (exists) return;
      const photo = albumRef.current.addPhoto(desktopDraftToPhotoDraft(draft));
      pushToast({
        tone: 'success',
        title: '收到好友发来的照片',
        description: photo.world
          ? `已加入相册并关联世界「${photo.world.name}」。`
          : '已加入相册，可以在照片管理中继续完善备注。',
      });
    });

    const offProgress = bridge.ai.onBatchProgress((progress: AiBatchProgress) => {
      setAiBatch((prev) => ({
        ...prev,
        running: true,
        mode: progress.mode ?? prev.mode,
        current: progress.current,
        total: progress.total,
        currentId: progress.id,
      }));
    });

    const offResult = bridge.ai.onBatchResult((result) => {
      if (!result.id) return;
      setAiBatch((prev) => ({
        ...prev,
        done: prev.done + (result.ok ? 1 : 0),
        failed: prev.failed + (result.ok ? 0 : 1),
      }));
      if (result.mode === 'worldId') {
        if (result.worldId) {
          albumRef.current.applyWorldRecognition([
            { id: result.id, worldId: result.worldId, worldName: result.worldName },
          ]);
        }
        return;
      }
      if (result.mode === 'orientation') {
        if (result.ok && typeof result.rotation === 'number') {
          albumRef.current.updatePhoto(result.id, {
            rotation: result.rotation === 0 ? undefined : result.rotation,
          });
        }
        return;
      }
      pendingResults.current.set(result.id, result);
      if (flushTimer.current) return;
      flushTimer.current = window.setTimeout(() => {
        flushTimer.current = null;
        flushAiResults();
      }, 400);
    });

    const offDone = bridge.ai.onBatchDone((summary) => {
      flushAiResults();
      const mode = summary.mode ?? 'summary';
      if (mode === 'worldId') {
        setAiBatch({
          running: false,
          mode: 'worldId',
          current: summary.total,
          total: summary.total,
          done: summary.done,
          failed: summary.failed,
          last: summary,
        });
        pushToast({
          tone: summary.worldIds ? 'success' : 'warning',
          title: summary.canceled ? 'World ID 识别已停止' : 'World ID 识别完成',
          description: `识别到 ${summary.worldIds ?? 0} 个 World ID${
            summary.failed ? ` · ${summary.failed} 张未识别/失败` : ''
          }`,
        });
        return;
      }
      if (mode === 'orientation') {
        setAiBatch({
          running: false,
          mode: 'orientation',
          current: summary.total,
          total: summary.total,
          done: summary.done,
          failed: summary.failed,
          last: summary,
        });
        pushToast({
          tone: summary.failed ? 'warning' : 'success',
          title: summary.canceled ? '方向检测已停止' : 'AI 方向检测完成',
          description: `已检测 ${summary.done} 张${
            summary.rotated ? ` · 校正 ${summary.rotated} 张` : ''
          }${summary.failed ? ` · ${summary.failed} 张失败` : ''}`,
        });
        return;
      }

      const leftovers = albumRef.current.photos
        .filter((photo) => photo.aiState === 'queued' || photo.aiState === 'running')
        .map((photo) => ({
          id: photo.id,
          state: photo.aiSummary ? ('done' as const) : ('none' as const),
          summary: photo.aiSummary,
          tags: photo.aiTags,
          model: photo.aiModel,
        }));
      if (leftovers.length) albumRef.current.applyAiResults(leftovers);
      setAiBatch({
        running: false,
        mode: 'summary',
        current: summary.total,
        total: summary.total,
        done: summary.done,
        failed: summary.failed,
        last: summary,
      });
      if (summary.done > 0) {
        albumRef.current.logAiActivity(
          `AI 为 ${summary.done} 张照片生成了回忆总结${summary.failed ? `，${summary.failed} 张失败` : ''}`,
        );
      }
      pushToast({
        tone: summary.failed ? 'warning' : 'success',
        title: summary.canceled
          ? 'AI 总结已停止'
          : summary.failed
            ? 'AI 总结部分完成'
            : 'AI 总结已生成',
        description: `成功 ${summary.done} 张${summary.failed ? ` · 失败 ${summary.failed} 张` : ''}${
          summary.error ? ` · ${summary.error}` : ''
        }`,
      });
    });

    return () => {
      offIncoming();
      offProgress();
      offResult();
      offDone();
      if (flushTimer.current) window.clearTimeout(flushTimer.current);
    };
  }, [bridge, flushAiResults, pushToast]);

  const startAiBatch = useCallback(
    async (scope: AiBatchScope, ids?: string[], mode: AiBatchMode = 'summary') => {
      if (!bridge) return { ok: false, error: '仅桌面客户端可用。' };
      const idSet = new Set(ids || []);
      const photos = albumRef.current.photos.filter((photo) => {
        if (photo.mediaKind !== 'library' || photo.missing) return false;
        if (mode === 'worldId') {
          if (photo.worldId || photo.worldRef) return false;
          if (scope === 'ids') return idSet.has(photo.id);
          return true;
        }
        if (mode === 'orientation') {
          // Only 16:9 landscape captures can be "sideways selfies". Already
          // rotated photos and portrait/square photos are left alone.
          if (photo.rotation) return false;
          if (!photo.width || !photo.height) return false;
          const ratio = photo.width / photo.height;
          if (ratio < 1.68 || ratio > 1.86) return false;
          if (scope === 'ids') return idSet.has(photo.id);
          return true;
        }
        if (scope === 'ids') return idSet.has(photo.id);
        if (scope === 'missing') return !photo.aiSummary;
        return true;
      });
      if (photos.length === 0) {
        return {
          ok: false,
          error:
            mode === 'worldId'
              ? '没有需要识别 World ID 的照片。'
              : mode === 'orientation'
                ? '没有需要检测方向的 16:9 横图（已旋转的照片会跳过）。'
                : '没有符合条件、可以生成总结的照片。',
        };
      }

      const items: AiPhotoInput[] = photos.map((photo) => ({
        id: photo.id,
        previewPath: photo.previewPath,
        libraryPath: photo.libraryPath,
        capturedAt: photo.capturedAt,
        worldName: photo.world?.name,
        note: photo.note,
      }));

      const result = await bridge.ai.startBatch({ items, mode });
      if (!result.ok) {
        return {
          ok: false,
          error:
            result.error ||
            (mode === 'worldId'
              ? '无法开始 World ID 识别。'
              : mode === 'orientation'
                ? '无法开始方向检测。'
                : '无法开始 AI 总结。'),
        };
      }

      if (mode === 'summary') {
        albumRef.current.applyAiResults(
          photos.map((photo) => ({
            id: photo.id,
            state: 'queued' as const,
            summary: photo.aiSummary,
            tags: photo.aiTags,
            model: photo.aiModel,
          })),
        );
      }
      setAiBatch({
        running: true,
        mode,
        current: 0,
        total: items.length,
        done: 0,
        failed: 0,
        last: null,
      });
      pushToast({
        tone: 'default',
        title:
          mode === 'worldId'
            ? 'World ID 识别已开始'
            : mode === 'orientation'
              ? 'AI 方向检测已开始'
              : 'AI 总结已开始',
        description: `共 ${items.length} 张照片，可以随时停止。`,
      });
      return { ok: true, total: items.length };
    },
    [bridge, pushToast],
  );

  const cancelAiBatch = useCallback(async () => {
    if (!bridge) return;
    await bridge.ai.cancelBatch();
    pushToast({ tone: 'warning', title: '正在停止 AI 任务…' });
  }, [bridge, pushToast]);

  const value = useMemo<DesktopServicesValue>(
    () => ({ aiBatch, startAiBatch, cancelAiBatch }),
    [aiBatch, startAiBatch, cancelAiBatch],
  );

  return (
    <DesktopServicesContext.Provider value={value}>
      {children}
    </DesktopServicesContext.Provider>
  );
}

export function useDesktopServices(): DesktopServicesValue {
  const value = useContext(DesktopServicesContext);
  if (!value) {
    throw new Error('useDesktopServices must be used inside DesktopServicesProvider');
  }
  return value;
}
