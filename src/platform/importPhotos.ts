import type { AlbumApi } from '../hooks/useAlbum';
import type { PhotoDraft, ToastMessage } from '../types';
import type { DesktopBridge, DesktopImportDraft } from './desktopApi';

type PushToast = (toast: Omit<ToastMessage, 'id'>) => void;

export function desktopDraftToPhotoDraft(draft: DesktopImportDraft): PhotoDraft {
  return {
    src: draft.src,
    alt: draft.alt,
    capturedAt: draft.capturedAt,
    note: '',
    worldId: draft.worldId,
    world: draft.world ?? null,
    width: draft.width,
    height: draft.height,
    isUploaded: true,
    isRemote: false,
    mediaKind: 'library',
    libraryPath: draft.libraryPath,
    previewPath: draft.previewPath,
    fileBytes: draft.fileBytes,
    contentHash: draft.contentHash,
    metaSource: draft.metaSource,
    worldInstanceId: draft.worldInstanceId,
    managedCopy: draft.managedCopy,
    players: draft.players,
  };
}

export function desktopDraftsToPhotoDrafts(drafts: DesktopImportDraft[]): PhotoDraft[] {
  return drafts.map(desktopDraftToPhotoDraft);
}

/**
 * Import via native picker (or explicit paths from a drag/drop) and add the
 * resulting photos to the album. Used by the titlebar menu, UploadDialog and
 * library panel so the flow stays identical everywhere.
 */
export async function importPhotosFromDesktop(
  bridge: DesktopBridge | null,
  album: Pick<AlbumApi, 'addPhoto'>,
  pushToast: PushToast,
  options: { paths?: string[] } = {},
): Promise<number> {
  if (!bridge) return 0;

  const result =
    options.paths && options.paths.length
      ? await bridge.media.importFiles(options.paths)
      : await bridge.media.pickAndImport();

  if (result.canceled) return 0;
  if (result.drafts.length === 0) {
    pushToast({
      tone: 'danger',
      title: '没有导入照片',
      description:
        result.error ??
        result.errors[0]?.message ??
        '请选择 JPG、PNG、WebP、AVIF 或 HEIC 图片。',
    });
    return 0;
  }

  for (const draft of result.drafts) {
    album.addPhoto(desktopDraftToPhotoDraft(draft));
  }

  pushToast({
    tone: 'success',
    title: `已导入 ${result.drafts.length} 张照片`,
    description: result.errors.length
      ? `${result.errors.length} 张未能导入：${result.errors[0].message}`
      : '日期与地图 ID 已自动识别，原图已复制到存储库。',
  });
  return result.drafts.length;
}
