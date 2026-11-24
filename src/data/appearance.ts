import type { BackgroundEffectId, LayoutId, ThemeId } from '../types';

export const DEFAULT_THEME: ThemeId = 'twilight';
export const DEFAULT_LAYOUT: LayoutId = 'starlight';
export const DEFAULT_BACKGROUND: BackgroundEffectId = 'stars';
/** Small cache so the pre-paint script does not have to parse the whole album. */
export const APPEARANCE_CACHE_KEY = 'hoshikuzu-appearance-v1';

export interface ThemeOption {
  id: ThemeId;
  name: string;
  en: string;
  description: string;
  tone: 'dark' | 'light';
  /** CSS gradient used by the admin preview card. */
  preview: string;
  swatches: [string, string, string];
}

export interface LayoutOption {
  id: LayoutId;
  name: string;
  en: string;
  description: string;
}

export interface BackgroundEffectOption {
  id: BackgroundEffectId;
  name: string;
  en: string;
  description: string;
  /** CSS gradient/thumbnail used by pickers. */
  preview: string;
  tone: 'dark' | 'light';
}

export const BACKGROUND_EFFECTS: BackgroundEffectOption[] = [
  {
    id: 'stars',
    name: '星轨',
    en: 'STARFIELD',
    description: '当前默认。缓慢漂移的星尘与偶尔划过的流星。',
    preview:
      'radial-gradient(circle at 70% 24%, rgba(255,255,255,.9) 0 1px, transparent 2px), radial-gradient(circle at 26% 68%, rgba(255,214,228,.8) 0 1px, transparent 2px), linear-gradient(160deg, #0b0918, #241537 58%, #120c20)',
    tone: 'dark',
  },
  {
    id: 'rain',
    name: '雨幕',
    en: 'RAIN ON GLASS',
    description: '雨滴拍打屏幕、沿玻璃滑落，留下细小的水痕与冷色反光。',
    preview:
      'radial-gradient(ellipse at 30% 20%, rgba(255,255,255,.32) 0 2px, transparent 3px), radial-gradient(ellipse at 64% 54%, rgba(255,255,255,.22) 0 3px, transparent 4px), linear-gradient(180deg, #0a1424, #12243a 52%, #07101d)',
    tone: 'dark',
  },
  {
    id: 'acrylic',
    name: '亚克力',
    en: 'ACRYLIC',
    description: '磨砂亚克力板与缓慢流动的柔光，像一块有厚度的透明展板。',
    preview:
      'linear-gradient(120deg, rgba(255,214,236,.5), rgba(205,225,255,.35) 42%, rgba(180,255,240,.28) 70%, rgba(255,255,255,.18)), linear-gradient(160deg, #f4e9ef, #dfe5f5 55%, #cfe9e5)',
    tone: 'light',
  },
  {
    id: 'blackhole',
    name: '银河黑洞',
    en: 'GARGANTUA',
    description: '星际穿越式黑洞：吸积盘、光子环、引力透镜、闪烁星海与流星，黑洞缓慢横向漂移。',
    preview:
      'radial-gradient(ellipse at 50% 50%, #000 0 18%, rgba(255,170,80,.9) 21%, rgba(255,226,170,.4) 26%, transparent 42%), radial-gradient(circle at 50% 50%, transparent 0 28%, rgba(255,140,60,.35) 32%, transparent 45%), linear-gradient(180deg, #020208, #0a0714 55%, #05040b)',
    tone: 'dark',
  },
  {
    id: 'sakura',
    name: '樱吹雪',
    en: 'SAKURA SNOW',
    description: '樱花花瓣随风飘落、旋转，适合暮色与樱夜主题。',
    preview:
      'linear-gradient(160deg, #1a0d1a, #4a1d38 52%, #1b0d18), radial-gradient(ellipse at 30% 30%, rgba(255,190,214,.5) 0 2px, transparent 3px), radial-gradient(ellipse at 70% 60%, rgba(255,210,228,.4) 0 2px, transparent 3px)',
    tone: 'dark',
  },
  {
    id: 'aurora',
    name: '极光',
    en: 'AURORA',
    description: '低饱和的极光帘幕缓慢流动，星空在后方闪烁。',
    preview:
      'radial-gradient(ellipse at 30% 18%, rgba(120,255,214,.32), transparent 55%), radial-gradient(ellipse at 70% 32%, rgba(185,150,255,.32), transparent 55%), linear-gradient(180deg, #050b18, #0b1424 58%, #050a12)',
    tone: 'dark',
  },
  {
    id: 'fireflies',
    name: '萤火',
    en: 'FIREFLIES',
    description: '夜色中漂浮的萤火，缓慢呼吸、聚散。',
    preview:
      'radial-gradient(circle at 30% 40%, rgba(255,230,150,.9) 0 1.5px, transparent 3px), radial-gradient(circle at 66% 62%, rgba(200,255,180,.8) 0 1.5px, transparent 3px), linear-gradient(160deg, #0a0c16, #16211a 58%, #080c0a)',
    tone: 'dark',
  },
  {
    id: 'custom',
    name: '自定义图片',
    en: 'CUSTOM IMAGE',
    description: '上传你自己的背景图；会压缩到 1920px 以内并保存在当前相册设置中。',
    preview:
      'linear-gradient(135deg, #2b213c, #574464 52%, #9a789d), radial-gradient(circle at 40% 30%, rgba(255,255,255,.25), transparent 55%)',
    tone: 'dark',
  },
  {
    id: 'video',
    name: '视频背景',
    en: 'VIDEO LOOP',
    description:
      '导入 MP4 / WebM / MOV 等常见视频作为循环背景；体积过大时会自动去除音轨并智能压缩，画面保持高清。',
    preview:
      'radial-gradient(circle at 50% 46%, rgba(255,255,255,.28) 0 3px, transparent 4px), linear-gradient(135deg, #101a2e, #263a5e 50%, #0a1220)',
    tone: 'dark',
  },
];

export const THEMES: ThemeOption[] = [
  {
    id: 'twilight',
    name: '暮色紫',
    en: 'TWILIGHT',
    description: '当前默认。深紫夜空、樱花粉与月白微光。',
    tone: 'dark',
    preview: 'linear-gradient(135deg, #1a1130 0%, #5b3059 52%, #f3aecb 100%)',
    swatches: ['#f3aecb', '#c0a9ff', '#0a0816'],
  },
  {
    id: 'dawn',
    name: '晨光',
    en: 'MORNING LIGHT',
    description: '奶油白、樱花与晨光，干净温暖的浅色纸页。',
    tone: 'light',
    preview: 'linear-gradient(135deg, #fff7ec 0%, #ffd9cd 52%, #dfa3b6 100%)',
    swatches: ['#b24876', '#a26a2a', '#fff4e8'],
  },
  {
    id: 'daylight',
    name: '晴日',
    en: 'CLEAR DAY',
    description: '天空蓝、薄云与薄荷，明亮而清爽的浅色相册。',
    tone: 'light',
    preview: 'linear-gradient(135deg, #f8fbff 0%, #d4e5ff 52%, #b9e6e9 100%)',
    swatches: ['#3568b0', '#6b5bb5', '#f4f9ff'],
  },
  {
    id: 'sakura',
    name: '樱夜',
    en: 'SAKURA NIGHT',
    description: '酒红夜色与更浓的樱粉，像一场没有结束的花见。',
    tone: 'dark',
    preview: 'linear-gradient(135deg, #1c0812 0%, #6e233f 52%, #ffb6cf 100%)',
    swatches: ['#ffb6cf', '#ffd8a8', '#12070f'],
  },
  {
    id: 'moon',
    name: '月白',
    en: 'MOONLIT',
    description: '靛蓝、冰银与淡紫，安静而清冷的月光配色。',
    tone: 'dark',
    preview: 'linear-gradient(135deg, #061120 0%, #1c3b5c 52%, #c9d9ff 100%)',
    swatches: ['#c9d9ff', '#8fb6ff', '#050b16'],
  },
  {
    id: 'amber',
    name: '琥珀黄昏',
    en: 'AMBER DUSK',
    description: '褐金、蜜桃与晚霞，像旧唱片的暖色封面。',
    tone: 'dark',
    preview: 'linear-gradient(135deg, #1b0d07 0%, #6a351b 52%, #ffc98c 100%)',
    swatches: ['#ffc27f', '#ffdfb4', '#120904'],
  },
  {
    id: 'forest',
    name: '青雾',
    en: 'JADE MIST',
    description: '深林绿、薄荷与一点樱花，潮湿而安静。',
    tone: 'dark',
    preview: 'linear-gradient(135deg, #050f0b 0%, #1a4436 52%, #9fe7c7 100%)',
    swatches: ['#9fe7c7', '#f3b8cb', '#040d09'],
  },
];

export const LAYOUTS: LayoutOption[] = [
  {
    id: 'starlight',
    name: '星轨交错',
    en: 'STARLIGHT',
    description: '当前默认。中央星轨，照片左右交替。',
  },
  {
    id: 'gallery',
    name: '双列画廊',
    en: 'GALLERY',
    description: '双列瀑布式画廊，弱化时间轴线，更像一本翻开的相册。',
  },
  {
    id: 'ledger',
    name: '左侧编年',
    en: 'LEDGER',
    description: '左侧时间轨 + 横向照片条目，适合快速浏览大量回忆。',
  },
  {
    id: 'sheet',
    name: '密排相册',
    en: 'CONTACT SHEET',
    description: '三列照片墙，只保留核心信息，适合像翻相册一样快速浏览。',
  },
];

export function themeTone(theme: ThemeId): 'dark' | 'light' {
  return THEMES.find((item) => item.id === theme)?.tone ?? 'dark';
}

/** Browser chrome colour matching the canvas of each theme family. */
export function themeChromeColor(theme: ThemeId): string {
  if (theme === 'dawn') return '#fbf4e9';
  if (theme === 'daylight') return '#f5f9ff';
  return '#0b0918';
}

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === 'string' && THEMES.some((theme) => theme.id === value);
}

export function isLayoutId(value: unknown): value is LayoutId {
  return typeof value === 'string' && LAYOUTS.some((layout) => layout.id === value);
}

export function isBackgroundEffect(value: unknown): value is BackgroundEffectId {
  return (
    typeof value === 'string' &&
    BACKGROUND_EFFECTS.some((effect) => effect.id === value)
  );
}
