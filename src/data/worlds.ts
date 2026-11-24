import type { WorldInfo, WorldLibraryEntry } from '../types';
import { photoAsset } from '../utils/assets';

type DemoWorld = Omit<WorldInfo, 'source'>;

/**
 * Local demo catalogue used by the world lookup adapter when no backend proxy
 * is configured. These are original fictional worlds, not real VRChat data.
 */
export const DEMO_WORLDS: Record<string, DemoWorld> = {
  'wrld_6c1f0b2e-8a4d-4e77-9b31-2f5a7c9d0e14': {
    id: 'wrld_6c1f0b2e-8a4d-4e77-9b31-2f5a7c9d0e14',
    name: '月灯りの杜 〜月影の社〜',
    author: '月白ルナ',
    thumbnail: photoAsset('sakura-shrine'),
    description:
      '满月之夜才会点亮石灯笼的深山神社。穿过湖上的鸟居，能听见很远的水声；据说在花田尽头许的愿，会跟着萤火一起升上天空。',
    capacity: 32,
  },
  'wrld_aa3d9f41-2b6c-4d88-8e15-7c09b4fa2d61': {
    id: 'wrld_aa3d9f41-2b6c-4d88-8e15-7c09b4fa2d61',
    name: 'Neon Reverie 2099',
    author: 'KAGAMI',
    thumbnail: photoAsset('neon-alley'),
    description:
      '一场不会停的雨，一条永远亮着的巷子。24 小时营业的关东煮、旧式卡拉 OK，以及一辆没人认领的自行车。',
    capacity: 40,
  },
  'wrld_4e8b7d2a-91c5-4f3b-a6d0-58e2c1b7f903': {
    id: 'wrld_4e8b7d2a-91c5-4f3b-a6d0-58e2c1b7f903',
    name: '空に浮かぶ島アステリア',
    author: 'ソラ',
    thumbnail: photoAsset('sky-islands'),
    description:
      '建在云海之上的岛屿群。岛与岛之间没有桥，只有灯笼和风。瀑布的尽头是另一片天空。',
    capacity: 24,
  },
  'wrld_1d5f9c3b-7e42-4a61-b9d8-0c3e6f2a8457': {
    id: 'wrld_1d5f9c3b-7e42-4a61-b9d8-0c3e6f2a8457',
    name: '星降る海辺の灯台',
    author: '灯守り',
    thumbnail: photoAsset('lighthouse'),
    description:
      '退潮后可以走到灯塔脚下的小岬。守塔人会在午夜点亮旧式灯芯，为迷路的星星指一条回家的路。',
    capacity: 16,
  },
  'wrld_b7c2d19e-4a63-4f08-9d51-8e2a6b4c7f30': {
    id: 'wrld_b7c2d19e-4a63-4f08-9d51-8e2a6b4c7f30',
    name: '朝霧の参道',
    author: '朝霧',
    thumbnail: photoAsset('torii-sunrise'),
    description:
      '日出前半小时，石阶会浮在雾上。鸟居下面是浅水，走上去能听见另一双脚步声——也许只是回声。',
    capacity: 12,
  },
  'wrld_9b2e6f47-3c81-4d59-8a20-5f7c1e9b3d68': {
    id: 'wrld_9b2e6f47-3c81-4d59-8a20-5f7c1e9b3d68',
    name: '竹音の森',
    author: '篠宮',
    thumbnail: photoAsset('bamboo'),
    description:
      '风穿过竹林时会发出类似风铃的声音。五月的萤火虫季，整座森林会像被谁轻轻摇响。',
    capacity: 20,
  },
  'wrld_5f0a8c21-6d93-4b7e-9c48-2a6f0d1e8b35': {
    id: 'wrld_5f0a8c21-6d93-4b7e-9c48-2a6f0d1e8b35',
    name: '桜坂メモリアル',
    author: '花野',
    thumbnail: photoAsset('train'),
    description:
      '无人车站与樱花坡道。广播里永远放着昭和年代的车站歌，末班车之后，站台会变成只属于你的观景台。',
    capacity: 28,
  },
  'wrld_8d3c1a74-5b26-4e90-b7f3-9a4c2e6d015f': {
    id: 'wrld_8d3c1a74-5b26-4e90-b7f3-9a4c2e6d015f',
    name: '雪灯りの村',
    author: '白瀬',
    thumbnail: photoAsset('snow-village'),
    description:
      '被雪封住的小村。每一扇窗里都亮着不同的故事，烟囱里的烟会一直飘到极光下面。',
    capacity: 24,
  },
  'wrld_2c9b5e61-4f07-4a83-b1d5-6e8a2c9f740b': {
    id: 'wrld_2c9b5e61-4f07-4a83-b1d5-6e8a2c9f740b',
    name: '夏祭り「星火」',
    author: '星野',
    thumbnail: photoAsset('festival'),
    description:
      '河边小镇的夏夜祭。最后一发烟花总是金色的，老人们说那是给没能回来的人看的。',
    capacity: 48,
  },
  'wrld_7a4e2d90-1c65-4b8f-9e23-3d1f7b5c8a06': {
    id: 'wrld_7a4e2d90-1c65-4b8f-9e23-3d1f7b5c8a06',
    name: 'The Quiet Observatory',
    author: 'Rin',
    thumbnail: photoAsset('observatory'),
    description:
      'A small hilltop observatory with an always-open dome. On clear nights the Milky Way lines up with the old telescope. Please leave the lights off.',
    capacity: 8,
  },
  'wrld_3e6f8a15-9d24-4c70-8b5a-1f9e3c6d2b48': {
    id: 'wrld_3e6f8a15-9d24-4c70-8b5a-1f9e3c6d2b48',
    name: '海底遺跡ルミナ',
    author: '深青',
    thumbnail: photoAsset('underwater'),
    description:
      '半沉的鸟居与会发光的鱼群。海面之上永远停在黄昏，海面之下没有时间。',
    capacity: 10,
  },
};

/** A world that is not linked to any sample photo, handy for trying a lookup. */
export const DEMO_LOOKUP_ID = 'wrld_9a1c7e30-5b42-4d8f-a6e1-3c0d9b7f2148';

DEMO_WORLDS[DEMO_LOOKUP_ID] = {
  id: DEMO_LOOKUP_ID,
  name: '月見坂のアトリエ',
  author: 'しの',
  thumbnail: photoAsset('moon-garden'),
  description:
    '月光斜坡上的一间小画室。纸星星挂在天花板，旧钢琴只会弹一首曲子。适合一个人待到天亮。',
  capacity: 16,
};

export const MANUAL_SAMPLE_WORLD: WorldInfo = {
  id: '',
  name: '喫茶 星灯',
  author: '店长 小夜',
  description: '雨夜限定的小咖啡馆。菜单上只有热可可和一首老歌，猫负责占座。',
  source: 'manual',
};

export function demoWorldToInfo(id: string): WorldInfo | null {
  const world = DEMO_WORLDS[id];
  return world ? { ...world, source: 'demo' } : null;
}

/** Stable keys for the seeded starter library. */
export const SEED_TIME = '2026-01-01T00:00:00.000Z';
export const SEED_MANUAL_CAFE_KEY = 'seed:manual-cafe';

export function seedWorldKey(id: string): string {
  return `seed:${id.trim().toLowerCase()}`;
}

export function createSeedWorlds(): WorldLibraryEntry[] {
  const worlds = Object.values(DEMO_WORLDS).map<WorldLibraryEntry>((world) => ({
    ...world,
    key: seedWorldKey(world.id),
    source: 'demo',
    builtin: true,
    createdAt: SEED_TIME,
    updatedAt: SEED_TIME,
  }));
  worlds.push({
    ...MANUAL_SAMPLE_WORLD,
    key: SEED_MANUAL_CAFE_KEY,
    builtin: true,
    createdAt: SEED_TIME,
    updatedAt: SEED_TIME,
  });
  return worlds;
}

export function findSeedWorld(worlds: WorldLibraryEntry[], world: WorldInfo): WorldLibraryEntry | undefined {
  if (world.id) {
    const byId = worlds.find((entry) => entry.id && entry.id.toLowerCase() === world.id.toLowerCase());
    if (byId) return byId;
  }
  return worlds.find((entry) => !entry.id && entry.name === world.name);
}
