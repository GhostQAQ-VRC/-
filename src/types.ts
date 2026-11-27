export type ThemeId =
  | 'twilight'
  | 'dawn'
  | 'daylight'
  | 'sakura'
  | 'moon'
  | 'amber'
  | 'forest';
export type LayoutId = 'starlight' | 'gallery' | 'ledger' | 'sheet';

export type BackgroundEffectId =
  | 'stars'
  | 'rain'
  | 'acrylic'
  | 'blackhole'
  | 'sakura'
  | 'aurora'
  | 'fireflies'
  | 'custom'
  | 'video';

/** How the stored photo is framed. Derived from width/height after EXIF rotate. */
export type PhotoOrientation = 'portrait' | 'landscape' | 'square';

/** Clockwise display rotation applied without touching the original file. */
export type PhotoRotation = 0 | 90 | 180 | 270;

export type WorldSource = 'demo' | 'api' | 'manual' | 'local';

export interface WorldInfo {
  /** VRChat world id (wrld_…). Empty for manually entered worlds. */
  id: string;
  name: string;
  author?: string;
  thumbnail?: string;
  description?: string;
  capacity?: number;
  source: WorldSource;
  fetchedAt?: string;
}

/** Canonical world record managed in the admin console. */
export interface WorldLibraryEntry extends WorldInfo {
  key: string;
  createdAt: string;
  updatedAt: string;
  /** Curator note, never shown on the public site. */
  notes?: string;
  /** True for the seeded starter catalogue. */
  builtin?: boolean;
}

/** How the photo's world association was obtained. */
export type WorldLookupState = 'none' | 'resolved' | 'manual' | 'failed';

/** Where the photo pixels live. */
export type PhotoMediaKind = 'embedded' | 'remote' | 'library';

/** Which metadata source supplied the capture date / world id. */
export type PhotoMetaSource = 'xmp' | 'json' | 'exif' | 'filename' | 'mtime' | 'none' | 'manual';

/** Reserved state for the future online sync provider. */
export type PhotoSyncState = 'local' | 'pending' | 'synced' | 'error';

/** AI summary lifecycle for a photo. */
export type AiPhotoState = 'none' | 'queued' | 'running' | 'done' | 'error';

export interface AiSummaryResult {
  id: string;
  state: AiPhotoState;
  summary?: string;
  tags?: string[];
  model?: string;
  usedBackup?: boolean;
  error?: string;
  generatedAt?: string;
  /** World ID read from text printed on the image (Polaroid border etc.). */
  worldId?: string;
  worldName?: string;
  confidence?: number;
}

export interface PlayerRef {
  id: string;
  displayName: string;
}

export interface Photo {
  id: string;
  src: string;
  alt: string;
  /** ISO timestamp of when the photo was taken. */
  capturedAt: string;
  note: string;
  worldId?: string;
  world?: WorldInfo | null;
  /** Points at a WorldLibraryEntry.key. */
  worldRef?: string;
  worldLookup: WorldLookupState;
  createdAt: string;
  width?: number;
  height?: number;
  isUploaded?: boolean;
  /** True when src is a remote image URL rather than embedded local data. */
  isRemote?: boolean;
  /** Seeded starter memory (can be cleared from the admin console). */
  isSample?: boolean;
  /** Where the world association came from (AI image text recognition etc.). */
  worldIdSource?: 'ai' | 'scan' | 'manual';
  /**
   * Display-only clockwise rotation. Needed for screenshots whose pixels were
   * saved sideways without an EXIF orientation tag (e.g. VRChat phone-camera
   * portraits stored as 1920x1080). The original file is never modified.
   */
  rotation?: PhotoRotation;
  /** Desktop library: media kind, relative paths and recognition metadata. */
  mediaKind?: PhotoMediaKind;
  /** Path relative to the library root (POSIX separators). */
  libraryPath?: string;
  /** Preview file name inside the library's configured thumbnail cache folder. */
  previewPath?: string;
  fileBytes?: number;
  contentHash?: string;
  metaSource?: PhotoMetaSource;
  worldInstanceId?: string;
  /** Indexed file is no longer present on disk. */
  missing?: boolean;
  /** File was copied into the library by the app (safe to delete on request). */
  managedCopy?: boolean;
  syncState?: PhotoSyncState;
  /** AI-generated memory summary and tags (desktop client). */
  aiSummary?: string;
  aiTags?: string[];
  aiModel?: string;
  aiUpdatedAt?: string;
  aiState?: AiPhotoState;
  aiError?: string;
  /** Curator-assigned tags, separate from AI tags. */
  tags?: string[];
  /** Curated favourite shown in smart albums and the star filter. */
  favorite?: boolean;
  /**
   * VRChat user IDs tagged in this group photo. Names, notes and avatar
   * snapshots live in the separate desktop player library so friend lists are
   * never exposed through the public album payload.
   */
  playerIds?: string[];
}

export interface PhotoDraft {
  src: string;
  alt: string;
  capturedAt: string;
  note: string;
  worldId?: string;
  /** Full world snapshot for sources that already resolved it (desktop library). */
  world?: WorldInfo | null;
  width?: number;
  height?: number;
  isUploaded?: boolean;
  isRemote?: boolean;
  mediaKind?: PhotoMediaKind;
  libraryPath?: string;
  previewPath?: string;
  fileBytes?: number;
  contentHash?: string;
  metaSource?: PhotoMetaSource;
  worldInstanceId?: string;
  managedCopy?: boolean;
  /** VRCX players found on import; consumed by the player library. */
  players?: PlayerRef[];
}

/** Result of scanning a desktop library, merged into the album by the renderer. */
export interface LibraryScanSeed {
  id: string;
  contentHash: string;
  libraryPath: string;
  previewPath?: string;
  fileBytes: number;
  width?: number;
  height?: number;
  capturedAt: string;
  metaSource: PhotoMetaSource;
  alt?: string;
  worldId?: string;
  worldName?: string;
  worldInstanceId?: string;
  /** Players found in VRCX screenshot metadata, consumed by the player library. */
  players?: PlayerRef[];
}

export interface LibraryScanWorldSeed {
  id: string;
  name?: string;
  instanceId?: string;
}

export interface LibraryScanStats {
  scanned: number;
  total: number;
  withWorldId: number;
  withDate: number;
  previewsQueued: number;
}

export interface LibraryScanResult {
  ok: boolean;
  /** False when the scan was cancelled or an error interrupted it. */
  complete: boolean;
  seeds: LibraryScanSeed[];
  worlds: LibraryScanWorldSeed[];
  stats: LibraryScanStats;
  error?: string;
}

export interface AlbumSettings {
  siteName: string;
  siteNameEn: string;
  tagline: string;
  timelineIntro: string;
  /** Photo shown in the hero card; null falls back to the newest photo. */
  featuredPhotoId: string | null;
  /** Optional runtime backend proxy for live world lookups. */
  worldApiBase: string;
  theme: ThemeId;
  layout: LayoutId;
  /** Animated background effect or custom uploaded image. */
  backgroundEffect: BackgroundEffectId;
  /** Enables hidden experimental backdrops such as the black hole. */
  experimentalEffects: boolean;
  customBackgroundSrc?: string;
  customBackgroundName?: string;
  /**
   * Looping video backdrop. `customVideoKey` points at a file inside the
   * desktop library cache (`.hoshikuzu/backgrounds/`) or an IndexedDB record in
   * the browser edition; `customVideoPoster` is a small inline first frame so
   * the backdrop paints before the video decodes.
   */
  customVideoKey?: string;
  customVideoName?: string;
  customVideoPoster?: string;
  customVideoMime?: string;
  customVideoBytes?: number;
  customVideoWidth?: number;
  customVideoHeight?: number;
  /** Saved filter presets shown on the photos page. */
  smartAlbums?: SmartAlbum[];
}

export type FavoriteFilter = 'all' | 'only' | 'none';

export interface SmartAlbum {
  id: string;
  name: string;
  query: string;
  worldRef: string;
  origin: string;
  sort: string;
  tag: string;
  favorite: FavoriteFilter;
  createdAt: string;
}

export type ActivityType =
  | 'photo.add'
  | 'photo.update'
  | 'photo.delete'
  | 'photo.bulk'
  | 'photo.feature'
  | 'world.create'
  | 'world.update'
  | 'world.delete'
  | 'settings.update'
  | 'data.import'
  | 'data.reset'
  | 'data.clear'
  | 'auth.update';

export interface ActivityEvent {
  id: string;
  type: ActivityType;
  message: string;
  at: string;
  meta?: string;
}

export interface AlbumData {
  version: 2;
  photos: Photo[];
  worlds: WorldLibraryEntry[];
  settings: AlbumSettings;
  activity: ActivityEvent[];
  updatedAt: string;
}

export interface BackupFile {
  format: 'hoshikuzu-album-backup';
  version: 2;
  exportedAt: string;
  data: AlbumData;
}

export type ImportMode = 'replace' | 'merge';

export type SortOrder = 'desc' | 'asc';

export interface AlbumFilters {
  query: string;
  /** "all" | "unlinked" | "world:<id>" | "manual:<name>" */
  worldKey: string;
  sort: SortOrder;
}

export interface WorldLookupSuccess {
  status: 'ok';
  world: WorldInfo;
  source: 'demo' | 'live' | 'library';
}

export interface WorldLookupFailure {
  status: 'error';
  code: 'invalid' | 'not-found' | 'network' | 'timeout' | 'bad-response';
  message: string;
  worldId: string;
  demo?: boolean;
}

export type WorldLookupResult = WorldLookupSuccess | WorldLookupFailure;

export type ToastTone = 'default' | 'success' | 'warning' | 'danger';

export interface ToastMessage {
  id: string;
  title: string;
  description?: string;
  tone?: ToastTone;
}
