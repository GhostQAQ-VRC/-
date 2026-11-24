/**
 * Display copy for the five thumbnail presets. Resolution/quality must stay in
 * sync with desktop/library/constants.cjs; the main process validates the ID
 * and owns the actual generation.
 */
export interface ThumbnailPresetMeta {
  id: string;
  label: string;
  maxEdge: number;
  quality: number;
  tagline: string;
  /** How comfortably a large timeline scrolls: 5 = feather-light, 1 = heavy. */
  scrollCost: 1 | 2 | 3 | 4 | 5;
  scrollLabel: string;
  detail: string;
  sizeHint: string;
}

export const THUMBNAIL_PRESETS_META: ThumbnailPresetMeta[] = [
  {
    id: 'feather',
    label: '羽量',
    maxEdge: 960,
    quality: 66,
    tagline: '极速 · 千张库也不拖影',
    scrollCost: 5,
    scrollLabel: '极流畅',
    detail:
      '最长边 960px，缩略图最轻。老笔记本、核显、高刷屏都能顺滑滚动，放大看会略软。',
    sizeHint: '约 30–70 KB/张',
  },
  {
    id: 'swift',
    label: '轻快',
    maxEdge: 1280,
    quality: 74,
    tagline: '轻快 · 笔记本与核显推荐',
    scrollCost: 4,
    scrollLabel: '流畅',
    detail:
      '最长边 1280px，细节和体积平衡得最好。日常浏览、快速拖动时间轴基本感觉不到卡顿。',
    sizeHint: '约 60–120 KB/张',
  },
  {
    id: 'balanced',
    label: '均衡',
    maxEdge: 1600,
    quality: 82,
    tagline: '均衡 · 默认，清晰与流畅兼顾',
    scrollCost: 3,
    scrollLabel: '平衡',
    detail:
      '最长边 1600px，默认推荐。主流独显/新核显流畅；超长列表用鼠标快速甩动时偶有轻微掉帧。',
    sizeHint: '约 100–220 KB/张',
  },
  {
    id: 'clear',
    label: '清晰',
    maxEdge: 1920,
    quality: 86,
    tagline: '清晰 · 高分屏更好看',
    scrollCost: 2,
    scrollLabel: '略重',
    detail:
      '最长边 1920px，适合 2K/4K 屏。单张解码更重，低配核显快速滚动时可能出现短暂卡顿。',
    sizeHint: '约 180–380 KB/张',
  },
  {
    id: 'lush',
    label: '细腻',
    maxEdge: 2560,
    quality: 90,
    tagline: '细腻 · 接近原图，谨慎用于大库',
    scrollCost: 1,
    scrollLabel: '很重',
    detail:
      '最长边 2560px，几乎看不出压缩痕迹。但单张解码接近 6–8MP，大库在低配机上快速滚动容易明显掉帧，只建议照片较少的高配设备。',
    sizeHint: '约 350–800 KB/张',
  },
];

export const DEFAULT_THUMBNAIL_PRESET_ID = 'balanced';

export const IMAGE_LOADING_MODE_META = [
  {
    id: 'realtime',
    label: '实时加载',
    tagline: '滑到哪里加载哪里，内存与 GPU 占用最低',
    detail:
      '只有进入视口附近的照片才请求缩略图，离开后立即释放解码图。最省资源，快速甩动时可能看到短暂的占位。',
  },
  {
    id: 'predictive',
    label: '预测加载（推荐）',
    tagline: '按滚动方向预取后面约 10–20 张（约 5%）',
    detail:
      '看见的照片立即加载，同时根据向下/向上滚动预测后面的十几张；高分辨率规格会自动减少预测张数以控制显存，离开视野较远后释放解码图。',
  },
  {
    id: 'preload',
    label: '预先加载',
    tagline: '进入相册后一次性预取全部缩略图字节',
    detail:
      '后台按低并发把所有缩略图读入缓存，但不提前解码，因此不会明显增加 GPU；之后滚动直接从缓存读取。',
  },
] as const;

export function thumbnailPresetMeta(id: string | undefined | null): ThumbnailPresetMeta {
  return (
    THUMBNAIL_PRESETS_META.find((preset) => preset.id === id) ??
    THUMBNAIL_PRESETS_META.find((preset) => preset.id === DEFAULT_THUMBNAIL_PRESET_ID)!
  );
}

export function formatThumbBytes(bytes: number | undefined): string {
  if (!bytes || !Number.isFinite(bytes) || bytes <= 0) return '—';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
