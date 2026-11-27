import type { LibraryScanResult, PhotoDraft, PhotoMetaSource, WorldInfo } from '../types';

export type ImageLoadingMode = 'realtime' | 'predictive' | 'preload';

export interface DesktopLibraryConfig {
  configured: boolean;
  libraryPath: string | null;
  libraryName: string | null;
  libraryId: string | null;
  previewPreset: string;
  previewMaxEdge: number;
  previewQuality: number;
  thumbnailDir: string;
  thumbnailDirPath: string | null;
  thumbnailsConfigured: boolean;
  imageLoadingMode: ImageLoadingMode;
  autoScan: boolean;
  watch: boolean;
  onboardingDismissed: boolean;
  unavailable?: boolean;
}

export interface ThumbnailPresetInfo {
  id: string;
  maxEdge: number;
  quality: number;
}

export interface ThumbnailSamplePreset extends ThumbnailPresetInfo {
  bytes: number;
  width?: number;
  height?: number;
  encodeMs?: number;
  fileName: string;
  url: string;
}

export interface ThumbnailSample {
  fileName: string;
  relativePath: string;
  originalUrl: string;
  originalBytes: number;
  width?: number;
  height?: number;
  imageCount: number;
  presets: ThumbnailSamplePreset[];
}

export interface ThumbnailSampleResult {
  ok: boolean;
  sample?: ThumbnailSample;
  error?: string;
}

export interface ThumbnailSetupResult {
  ok: boolean;
  config?: DesktopLibraryConfig;
  thumbnailDirPath?: string;
  error?: string;
}

export interface DesktopScanProgress {
  phase: 'discover' | 'index' | 'preview' | 'done' | 'error';
  current: number;
  total?: number;
  message?: string;
}

export interface DesktopAlbumLoadResult {
  configured: boolean;
  json: string | null;
  error?: string;
  unavailable?: boolean;
}

export interface DesktopSaveResult {
  configured: boolean;
  ok: boolean;
  error?: string;
}

export interface DesktopImportDraft {
  src: string;
  alt: string;
  capturedAt: string;
  width?: number;
  height?: number;
  fileBytes: number;
  contentHash: string;
  libraryPath: string;
  previewPath?: string;
  metaSource: PhotoMetaSource;
  worldId?: string;
  worldName?: string;
  worldInstanceId?: string;
  world?: WorldInfo | null;
  managedCopy: boolean;
  players?: Array<{ id: string; displayName: string }>;
}

export interface DesktopImportResult {
  ok: boolean;
  drafts: DesktopImportDraft[];
  errors: Array<{ file: string; message: string }>;
  error?: string;
  canceled?: boolean;
}

export interface PreviewProgress {
  done: number;
  failed: number;
  pending: number;
  total: number;
  active?: number;
}

export interface DesktopLibraryStats {
  imageCount: number;
  libraryBytes: number;
  previewBytes: number;
  previewCount: number;
  lastScanAt: string | null;
}

export interface DesktopLibraryResult {
  ok: boolean;
  config?: DesktopLibraryConfig;
  error?: string;
}

export interface DesktopBackupResult {
  ok: boolean;
  path?: string;
  error?: string;
  canceled?: boolean;
}

export type AutoBackupKind = 'metadata' | 'full';

export interface DesktopAutoBackupView {
  enabled: boolean;
  folder: string;
  effectiveFolder: string;
  usingDefaultFolder: boolean;
  intervalDays: number;
  kind: AutoBackupKind;
  retention: number;
  lastRunAt: string | null;
  lastAttemptAt: string | null;
  lastPath: string;
  lastError: string | null;
  nextRunAt: string | null;
  due: boolean;
  running: boolean;
}

export interface DesktopYearReviewSummary {
  year: number;
  photos: number;
  worlds: number;
  favorites: number;
  images: number;
  bytes: number;
}

export interface DesktopYearReviewResult {
  ok: boolean;
  path?: string;
  filename?: string;
  summary?: DesktopYearReviewSummary;
  error?: string;
  canceled?: boolean;
}

export type PlayerAvatarKind = 'avatar' | 'profile' | 'icon';

export interface PlayerAvatarSnapshot {
  file: string;
  sourceUrl: string;
  kind: PlayerAvatarKind;
  capturedAt: string;
  avatarUrl: string;
}

export interface DesktopPlayer {
  id: string;
  displayName: string;
  username: string;
  isFriend: boolean;
  isSelf: boolean;
  status: string;
  statusDescription: string;
  pronouns: string;
  lastPlatform: string;
  lastLogin: string;
  joinedAt: string;
  note: string;
  source: 'friend-sync' | 'vrcx' | 'photo-tag' | 'manual';
  avatar: PlayerAvatarSnapshot | null;
  avatarHistory: PlayerAvatarSnapshot[];
  avatarUrl: string;
  createdAt: string;
  updatedAt: string;
  syncedAt: string;
  removedFromFriendsAt: string;
}

export type PlayerSyncPhase = 'idle' | 'friends' | 'avatars' | 'tagged';

export interface PlayerSyncStatus {
  running: boolean;
  phase: PlayerSyncPhase;
  current: number;
  total: number;
  message: string;
  error: string | null;
  lastSyncAt: string | null;
  lastSyncError: string | null;
  totalPlayers: number;
  friendCount: number;
}

export interface PlayerLibraryView {
  ok: boolean;
  error?: string;
  me: { id: string; displayName: string; avatar: PlayerAvatarSnapshot | null } | null;
  players: DesktopPlayer[];
  status: PlayerSyncStatus;
}

export interface DesktopBackgroundSaveResult {
  ok: boolean;
  key?: string;
  bytes?: number;
  error?: string;
}

export type ProxyMode = 'system' | 'none' | 'http' | 'socks5' | 'pac' | 'custom';

export interface ProxyConfigView {
  mode: ProxyMode;
  httpUrl: string;
  socksUrl: string;
  pacUrl: string;
  customRules: string;
  bypass: string;
}

export interface VRChatConfigView {
  username: string;
  apiBase: string;
  hasPassword: boolean;
}

export interface NetworkConfigView {
  proxy: ProxyConfigView;
  vrchat: VRChatConfigView;
  modes: ProxyMode[];
}

export interface NetworkTestResult {
  ok: boolean;
  status?: number;
  mode?: string;
  proxy?: string;
  message?: string;
  error?: string;
}

export interface VRChatUserView {
  id: string;
  displayName: string;
  username?: string;
}

export interface VRChatStatusView {
  loggedIn: boolean;
  user?: VRChatUserView | null;
  pending2fa?: boolean;
  methods?: string[];
  error?: string;
  code?: string;
  status?: number;
  apiBase?: string;
}

export interface VRChatLoginResult extends VRChatStatusView {
  ok: boolean;
  requires2fa?: boolean;
  config?: VRChatConfigView;
}

export interface VRChatCoverResult {
  id: string;
  ok: boolean;
  name?: string;
  author?: string;
  thumbnail?: string;
  remoteThumbnail?: boolean;
  description?: string;
  capacity?: number;
  fetchedAt?: string;
  error?: string;
}

export interface VRChatCoverProgress {
  current: number;
  total: number;
  id: string;
  name: string;
  ok: boolean;
  error?: string;
}

export interface VRChatCoverBatchResult {
  ok: boolean;
  results?: VRChatCoverResult[];
  canceled?: boolean;
  needsLogin?: boolean;
  error?: string;
  updatedAt?: string;
  config?: VRChatConfigView;
}

export interface UpdateInfo {
  ok: boolean;
  currentVersion: string;
  latestVersion: string;
  latestTag?: string;
  hasUpdate: boolean;
  name?: string;
  notes?: string;
  publishedAt?: string | null;
  releaseUrl: string;
  setupUrl?: string;
  setupName?: string;
  setupSize?: number;
  portableUrl?: string;
  portableName?: string;
  portableSize?: number;
  error?: string;
}

export interface DesktopAppInfo {
  app: string;
  electron: string;
  chrome: string;
  node: string;
}

export interface DesktopPreferences {
  closeToTray: boolean;
  launchAtLogin: boolean;
}

export interface DesktopSyncStatus {
  enabled: boolean;
  provider: string;
  lastSyncAt: string | null;
  message: string;
  cloud?: SyncStateView;
  website?: SyncStateView;
  running?: 'cloud' | 'website' | null;
}

export type SyncTarget = 'cloud' | 'website';
export type SyncRunStatus =
  | 'idle'
  | 'running'
  | 'success'
  | 'partial'
  | 'error'
  | 'canceled';

export interface SyncStateView {
  lastSyncAt: string | null;
  status: SyncRunStatus;
  message: string;
  uploaded: number;
  skipped: number;
  failed: number;
  bytes: number;
  errors?: string[];
}

export interface SyncProviderInfo {
  id: string;
  kind: 'folder' | 'webdav' | 'google' | 'baidu';
  label: string;
  description: string;
}

export interface SyncCloudConfigView {
  provider: string;
  folderRoot: string;
  baseFolder: string;
  skipExisting: boolean;
  uploadMetadata: boolean;
  webdavUrl: string;
  webdavUsername: string;
  googleClientId: string;
  baiduAppKey: string;
  baiduAppName: string;
  hasWebdavPassword: boolean;
  hasGoogleClientSecret: boolean;
  hasGoogleAccessToken: boolean;
  hasGoogleRefreshToken: boolean;
  hasBaiduSecretKey: boolean;
  hasBaiduAccessToken: boolean;
  hasBaiduRefreshToken: boolean;
}

export interface SyncWebsiteConfigView {
  endpoint: string;
  includePreviewImages: boolean;
  maxPayloadMb: number;
  hasWebsiteToken: boolean;
}

export interface SyncConfigView {
  providers: SyncProviderInfo[];
  cloud: SyncCloudConfigView;
  website: SyncWebsiteConfigView;
  state: { cloud: SyncStateView; website: SyncStateView };
  manifest: { count: number; updatedAt: string | null };
  status: DesktopSyncStatus;
}

export interface SyncProgress {
  target: SyncTarget;
  phase:
    | 'discover'
    | 'folders'
    | 'upload'
    | 'metadata'
    | 'collect'
    | 'done'
    | 'error';
  current: number;
  total: number;
  bytes?: number;
  bytesDone?: number;
  dates?: number;
  date?: string;
  file?: string;
  uploaded?: number;
  skipped?: number;
  failed?: number;
  previews?: number;
  canceled?: boolean;
  message?: string;
}

export interface SyncDoneResult {
  target: SyncTarget;
  ok: boolean;
  canceled?: boolean;
  uploaded?: number;
  skipped?: number;
  failed?: number;
  bytes?: number;
  dates?: number;
  photos?: number;
  previews?: number;
  errors?: string[];
  error?: string;
  state?: SyncStateView;
}

export interface SyncTestResult {
  ok: boolean;
  message: string;
}

export interface SyncCloudConfigPatch
  extends Partial<Omit<SyncCloudConfigView, 'hasWebdavPassword' | 'hasGoogleClientSecret' | 'hasGoogleAccessToken' | 'hasGoogleRefreshToken' | 'hasBaiduSecretKey' | 'hasBaiduAccessToken' | 'hasBaiduRefreshToken'>> {
  webdavPassword?: string;
  googleClientSecret?: string;
  googleAccessToken?: string;
  googleRefreshToken?: string;
  baiduSecretKey?: string;
  baiduAccessToken?: string;
  baiduRefreshToken?: string;
  clearWebdavPassword?: boolean;
  clearGoogleClientSecret?: boolean;
  clearGoogleAccessToken?: boolean;
  clearGoogleRefreshToken?: boolean;
  clearBaiduSecretKey?: boolean;
  clearBaiduAccessToken?: boolean;
  clearBaiduRefreshToken?: boolean;
}

export interface SyncWebsiteConfigPatch
  extends Partial<Omit<SyncWebsiteConfigView, 'hasWebsiteToken'>> {
  websiteToken?: string;
  clearWebsiteToken?: boolean;
}

export type AiProtocol = 'openai' | 'anthropic' | 'gemini' | 'ollama';

export interface AiModelInfo {
  id: string;
  name: string;
  vision: boolean;
  note?: string;
}

export interface AiSettingsView {
  protocol: AiProtocol;
  baseUrl: string;
  primaryModel: string;
  backupModel: string;
  showAllModels: boolean;
  allowUnverifiedVision: boolean;
  models: AiModelInfo[];
  modelsAt: string | null;
  hasApiKey: boolean;
}

export interface AiPhotoInput {
  id: string;
  previewPath?: string;
  libraryPath?: string;
  capturedAt?: string;
  worldName?: string;
  note?: string;
}

export type AiBatchMode = 'summary' | 'worldId' | 'orientation';

export interface AiGenerateResult {
  ok: boolean;
  id?: string;
  mode?: AiBatchMode;
  state?: 'done' | 'error';
  summary?: string;
  tags?: string[];
  model?: string;
  usedBackup?: boolean;
  error?: string;
  generatedAt?: string;
  worldId?: string;
  worldName?: string;
  confidence?: number;
  /** Orientation detection result. */
  rotation?: 0 | 90 | 180 | 270;
  orientationType?: 'selfie' | 'landscape';
  head?: 'up' | 'right' | 'down' | 'left' | 'none';
}

export interface AiBatchProgress {
  current: number;
  total: number;
  id?: string;
  state?: string;
  mode?: AiBatchMode;
}

export interface AiBatchDone {
  ok: boolean;
  canceled: boolean;
  total: number;
  done: number;
  failed: number;
  error?: string;
  mode?: AiBatchMode;
  worldIds?: number;
  rotated?: number;
}

export interface EasyTierPeer {
  ipv4: string;
  hostname?: string;
  cost: number;
  latencyMs?: number;
  loss?: string;
  rx?: string;
  tx?: string;
  tunnel?: string;
  nat?: string;
  version?: string;
  direct: boolean;
}

export interface EasyTierDetection {
  found: boolean;
  corePath: string | null;
  cliPath: string | null;
  wintun: boolean;
  version: string | null;
  license: string;
  licenseUrl: string;
  releasePage: string;
  elevated: boolean;
}

export interface EasyTierStatusView {
  running: boolean;
  pid: number | null;
  startedAt: string | null;
  corePath: string | null;
  cliPath: string | null;
  elevated: boolean;
  noTun: boolean;
  peers: EasyTierPeer[];
  directCount: number;
  relayCount: number;
  selfIp: string | null;
  logs: Array<{ at: string; stream: string; text: string }>;
}

export interface EasyTierConfigView {
  corePath: string;
  cliPath: string;
  networkName: string;
  peers: string[];
  ipv4: string;
  listenerPort: number;
  rpcPort: number;
  autoStart: boolean;
  noTun: boolean;
  customArgs: string;
  networkSecret: string;
  hasSecret: boolean;
  detection: EasyTierDetection | null;
  status: EasyTierStatusView;
  license: string;
  licenseUrl: string;
}

export interface EasyTierLogEntry {
  at: string;
  stream: string;
  text: string;
}

export interface TransferReceiverConfig {
  enabled: boolean;
  port: number;
}

export interface TransferStatusView {
  running: boolean;
  port: number;
  startedAt: string | null;
  requiresToken: boolean;
}

export interface TransferConfigView {
  provider: string;
  receiver: TransferReceiverConfig;
  lastTarget: string;
  token: string;
  status: TransferStatusView;
  localIps: string[];
  virtualIp: string | null;
  directCount: number;
  relayCount: number;
}

export interface TransferProgress {
  direction: 'send';
  index: number;
  total: number;
  file: string;
  sent: number;
  bytes: number;
  percent: number;
}

export interface TransferSendItem {
  id: string;
  name: string;
  libraryPath: string;
}

export interface TransferSendResult {
  ok: boolean;
  sent: number;
  failed: number;
  results: Array<{
    id: string;
    file: string;
    ok: boolean;
    duplicate?: boolean;
    error?: string;
  }>;
  error?: string;
}

export type MobileReceiveMode = 'stream' | 'save';

export interface MobileLanAddress {
  address: string;
  iface: string;
  score: number;
}

export interface MobileDeviceView {
  id: string;
  name: string;
  platform: string;
  ip: string;
  connectedAt: string;
  lastSeen: string;
}

export interface MobileCastRecord {
  id: string;
  at: string;
  photoId: string;
  note: string;
  mode: MobileReceiveMode;
  delivered: number;
}

export interface MobileStatusView {
  running: boolean;
  port: number;
  startedAt: string | null;
  deviceCount: number;
  devices: MobileDeviceView[];
  receiveMode: MobileReceiveMode;
  preferredIp: string;
  activeIp: string;
  lanIps: MobileLanAddress[];
  lastCast: MobileCastRecord | null;
  lastError: string | null;
  hasLibrary: boolean;
  libraryName: string | null;
  url: string | null;
}

export interface MobileConfigView {
  enabled: boolean;
  port: number;
  preferredIp: string;
  receiveMode: MobileReceiveMode;
  status: MobileStatusView;
}

export interface MobileActionResult {
  ok: boolean;
  error?: string;
  delivered?: number;
  config?: MobileConfigView;
  dataUrl?: string;
  url?: string;
  ip?: string;
}

export interface DesktopBridge {
  version: string;
  platform: string;
  library: {
    getConfig: () => Promise<DesktopLibraryConfig>;
    chooseFolder: () => Promise<DesktopLibraryResult>;
    createFolder: () => Promise<DesktopLibraryResult>;
    dismissOnboarding: () => Promise<DesktopLibraryConfig>;
    getThumbnailPresets: () => Promise<{
      presets: ThumbnailPresetInfo[];
      defaultId: string;
      defaultDir: string;
    }>;
    sampleThumbnailPreview: () => Promise<ThumbnailSampleResult>;
    setupThumbnails: (payload: {
      thumbnailDir: string;
      presetId: string;
    }) => Promise<ThumbnailSetupResult>;
    openFolder: () => Promise<{ ok: boolean; error?: string }>;
    revealFile: (relativePath: string) => Promise<{ ok: boolean; error?: string }>;
    scan: (options?: { full?: boolean }) => Promise<LibraryScanResult>;
    cancelScan: () => Promise<{ ok: boolean }>;
    setOptions: (options: Partial<{
      previewPreset: string;
      previewMaxEdge: number;
      imageLoadingMode: ImageLoadingMode;
      autoScan: boolean;
      watch: boolean;
    }>) => Promise<DesktopLibraryConfig>;
    ignoreHashes: (hashes: string[]) => Promise<{ ok: boolean }>;
    resetIgnored: () => Promise<{ ok: boolean }>;
    stats: () => Promise<DesktopLibraryStats>;
    clearPreviewCache: () => Promise<{ ok: boolean; error?: string }>;
    onScanProgress: (callback: (progress: DesktopScanProgress) => void) => () => void;
    onPreviewReady: (callback: (payload: Array<{ hash: string; previewPath: string }> | { hash: string; previewPath: string }) => void) => () => void;
    onPreviewProgress: (callback: (progress: PreviewProgress) => void) => () => void;
    onLibraryChanged: (callback: (config: DesktopLibraryConfig) => void) => () => void;
    /** Phone uploads / watched-folder imports: merge a draft into the album. */
    onImported: (callback: (draft: PhotoDraft) => void) => () => void;
  };
  album: {
    loadSync: () => DesktopAlbumLoadResult;
    saveSync: (json: string) => DesktopSaveResult;
    resetSync: () => DesktopSaveResult;
  };
  media: {
    getPathForFile: (file: File) => string;
    pickAndImport: () => Promise<DesktopImportResult>;
    importFiles: (paths: string[]) => Promise<DesktopImportResult>;
    importDataUrls: (
      items: Array<{ name: string; dataUrl: string }>,
    ) => Promise<DesktopImportResult>;
    deleteManaged: (contentHash: string) => Promise<{ ok: boolean; error?: string }>;
    urlForPreview: (previewPath: string) => string;
    urlForOriginal: (libraryPath: string) => string;
  };
  backup: {
    exportMetadata: () => Promise<DesktopBackupResult>;
    exportFull: () => Promise<DesktopBackupResult>;
    importFile: () => Promise<{
      ok: boolean;
      text?: string;
      path?: string;
      restored?: boolean;
      error?: string;
      canceled?: boolean;
    }>;
    getAutoConfig: () => Promise<DesktopAutoBackupView>;
    setAutoConfig: (patch: {
      enabled?: boolean;
      folder?: string;
      intervalDays?: number;
      kind?: AutoBackupKind;
      retention?: number;
    }) => Promise<{ ok: boolean; error?: string; config: DesktopAutoBackupView }>;
    chooseAutoFolder: () => Promise<{
      ok: boolean;
      canceled?: boolean;
      error?: string;
      config: DesktopAutoBackupView;
    }>;
    runAutoNow: () => Promise<{
      ok: boolean;
      path?: string;
      kind?: AutoBackupKind;
      bytes?: number;
      error?: string;
      config: DesktopAutoBackupView;
    }>;
    onAutoStatus: (callback: (status: DesktopAutoBackupView) => void) => () => void;
  };
  review: {
    getYears: () => Promise<{ ok: boolean; years: number[] }>;
    exportYear: (year: number) => Promise<DesktopYearReviewResult>;
  };
  players: {
    list: () => Promise<PlayerLibraryView>;
    status: () => Promise<{ ok: boolean; status: PlayerSyncStatus }>;
    sync: () => Promise<{
      ok: boolean;
      friends?: number;
      needsLogin?: boolean;
      error?: string;
      status: PlayerSyncStatus;
    }>;
    add: (payload: {
      id?: string;
      displayName?: string;
      note?: string;
    }) => Promise<{
      ok: boolean;
      player?: DesktopPlayer | null;
      warning?: string;
      error?: string;
    }>;
    update: (
      id: string,
      patch: { displayName?: string; note?: string },
    ) => Promise<{ ok: boolean; player?: DesktopPlayer | null; error?: string }>;
    remove: (id: string) => Promise<{ ok: boolean; error?: string }>;
    refresh: (id: string) => Promise<{
      ok: boolean;
      player?: DesktopPlayer | null;
      error?: string;
      needsLogin?: boolean;
    }>;
    onStatus: (callback: (status: PlayerSyncStatus) => void) => () => void;
    onChanged: (callback: (change: { updatedAt: string; count: number }) => void) => () => void;
  };
  background: {
    saveVideo: (payload: {
      name: string;
      mime: string;
      data: ArrayBuffer;
    }) => Promise<DesktopBackgroundSaveResult>;
    deleteVideo: (key: string) => Promise<{ ok: boolean; error?: string }>;
  };
  network: {
    getConfig: () => Promise<NetworkConfigView>;
    setProxy: (
      patch: Partial<ProxyConfigView>,
    ) => Promise<{
      ok: boolean;
      config: NetworkConfigView;
      applied?: string;
      error?: string;
    }>;
    test: (payload?: {
      proxy?: Partial<ProxyConfigView>;
      url?: string;
    }) => Promise<NetworkTestResult>;
  };
  vrchat: {
    getConfig: () => Promise<
      VRChatConfigView & {
        progress: { total: number; current: number; running: boolean; canceled: boolean };
      }
    >;
    setConfig: (patch: {
      username?: string;
      apiBase?: string;
    }) => Promise<{ ok: boolean; config: VRChatConfigView }>;
    status: () => Promise<
      VRChatStatusView & {
        progress: { total: number; current: number; running: boolean; canceled: boolean };
      }
    >;
    login: (payload: {
      username?: string;
      password?: string;
      totp?: string;
      remember?: boolean;
    }) => Promise<VRChatLoginResult>;
    verify2fa: (payload: {
      code: string;
      method?: 'totp' | 'emailotp';
    }) => Promise<VRChatLoginResult>;
    logout: () => Promise<{ ok: boolean; config: VRChatConfigView }>;
    fetchCovers: (payload: {
      ids: string[];
    }) => Promise<VRChatCoverBatchResult>;
    cancelCovers: () => Promise<{ ok: boolean }>;
    onCoverProgress: (callback: (progress: VRChatCoverProgress) => void) => () => void;
  };
  update: {
    check: () => Promise<UpdateInfo>;
    open: (url: string) => Promise<{ ok: boolean; error?: string }>;
    onAvailable: (callback: (info: UpdateInfo) => void) => () => void;
  };
  window: {
    minimize: () => void;
    toggleMaximize: () => void;
    close: () => void;
    isMaximized: () => Promise<boolean>;
    onMaximizedChange: (callback: (maximized: boolean) => void) => () => void;
  };
  app: {
    info: () => Promise<DesktopAppInfo>;
    openExternal: (url: string) => Promise<void>;
    getPreferences: () => Promise<DesktopPreferences>;
    setPreferences: (patch: Partial<DesktopPreferences>) => Promise<{
      ok: boolean;
      preferences: DesktopPreferences;
    }>;
    onCommand: (callback: (command: string) => void) => () => void;
  };
  sync: {
    getConfig: () => Promise<SyncConfigView>;
    setConfig: (patch: {
      cloud?: SyncCloudConfigPatch;
      website?: SyncWebsiteConfigPatch;
    }) => Promise<SyncConfigView>;
    chooseFolder: () => Promise<{ ok: boolean; path?: string; canceled?: boolean }>;
    test: (payload: { target: SyncTarget }) => Promise<SyncTestResult>;
    start: (payload: {
      target: SyncTarget;
      full?: boolean;
      album?: unknown;
    }) => Promise<{ ok: boolean; started?: boolean; target?: SyncTarget; error?: string }>;
    cancel: () => Promise<{ ok: boolean }>;
    status: () => Promise<DesktopSyncStatus>;
    resetManifest: () => Promise<{ ok: boolean; config?: SyncConfigView; error?: string }>;
    onProgress: (callback: (progress: SyncProgress) => void) => () => void;
    onDone: (callback: (result: SyncDoneResult) => void) => () => void;
    onState: (callback: (payload: { target: SyncTarget; state: SyncStateView }) => void) => () => void;
    onConfig: (callback: (config: SyncConfigView) => void) => () => void;
    onStatus: (callback: (status: DesktopSyncStatus) => void) => () => void;
  };
  ai: {
    getConfig: () => Promise<AiSettingsView>;
    setConfig: (patch: Partial<AiSettingsView> & {
      apiKey?: string;
      clearKey?: boolean;
    }) => Promise<AiSettingsView>;
    test: (payload: {
      protocol?: AiProtocol;
      baseUrl?: string;
      apiKey?: string;
    }) => Promise<{ ok: boolean; message?: string; error?: string; models?: number; visionCount?: number }>;
    listModels: (payload: {
      protocol?: AiProtocol;
      baseUrl?: string;
      apiKey?: string;
    }) => Promise<{
      ok: boolean;
      models: AiModelInfo[];
      visionCount?: number;
      error?: string;
    }>;
    generate: (payload: {
      item: AiPhotoInput;
      context?: { capturedAt?: string; worldName?: string; note?: string };
    }) => Promise<AiGenerateResult>;
    recognizeWorldId: (payload: {
      item: AiPhotoInput;
      context?: { capturedAt?: string; worldName?: string; note?: string };
    }) => Promise<AiGenerateResult>;
    detectOrientation: (payload: {
      item: AiPhotoInput;
    }) => Promise<AiGenerateResult>;
    startBatch: (payload: {
      items: AiPhotoInput[];
      mode?: AiBatchMode;
    }) => Promise<{
      ok: boolean;
      total?: number;
      error?: string;
    }>;
    cancelBatch: () => Promise<{ ok: boolean }>;
    onBatchProgress: (callback: (progress: AiBatchProgress) => void) => () => void;
    onBatchResult: (callback: (result: AiGenerateResult) => void) => () => void;
    onBatchDone: (callback: (summary: AiBatchDone) => void) => () => void;
  };
  easytier: {
    getConfig: () => Promise<EasyTierConfigView>;
    setConfig: (patch: Partial<EasyTierConfigView> & {
      networkSecret?: string;
      clearSecret?: boolean;
    }) => Promise<EasyTierConfigView>;
    detect: () => Promise<EasyTierDetection & { status?: EasyTierStatusView }>;
    chooseCore: () => Promise<{
      ok: boolean;
      canceled?: boolean;
      detection?: EasyTierDetection;
      config?: EasyTierConfigView;
    }>;
    download: () => Promise<{
      ok: boolean;
      canceled?: boolean;
      corePath?: string;
      cliPath?: string;
      version?: string | null;
      error?: string;
      config?: EasyTierConfigView;
    }>;
    start: () => Promise<{
      ok: boolean;
      error?: string;
      needsElevation?: boolean;
      warning?: string;
      status?: EasyTierStatusView;
    }>;
    stop: () => Promise<{ ok: boolean }>;
    status: () => Promise<{
      query: {
        ok: boolean;
        error?: string;
        selfIp?: string | null;
        rawPeers?: string;
        rawNode?: string;
      };
      status: EasyTierStatusView;
      detection: EasyTierDetection | null;
      elevated: boolean;
    }>;
    test: () => Promise<{
      ok: boolean;
      error?: string;
      detection?: EasyTierDetection;
      status?: EasyTierStatusView;
    }>;
    logs: () => Promise<EasyTierLogEntry[]>;
    toml: () => Promise<{ text: string; license: string; licenseUrl: string }>;
    openFolder: () => Promise<{ ok: boolean; error?: string }>;
    elevate: () => Promise<{ ok: boolean; quitting: boolean }>;
    onStatus: (callback: (status: EasyTierStatusView) => void) => () => void;
    onLog: (callback: (entry: EasyTierLogEntry) => void) => () => void;
    onDownloadProgress: (callback: (progress: {
      phase: string;
      received?: number;
      total?: number;
      percent: number;
    }) => void) => () => void;
  };
  transfer: {
    getConfig: () => Promise<TransferConfigView>;
    setConfig: (patch: {
      receiver?: Partial<TransferReceiverConfig>;
      lastTarget?: string;
      token?: string;
      regenerateToken?: boolean;
    }) => Promise<TransferConfigView>;
    startReceiver: () => Promise<{
      ok: boolean;
      error?: string;
      status?: TransferStatusView;
      config?: TransferConfigView;
    }>;
    stopReceiver: () => Promise<{ ok: boolean; config?: TransferConfigView }>;
    status: () => Promise<TransferConfigView>;
    testTarget: (payload: { target: string; token?: string }) => Promise<{
      ok: boolean;
      error?: string;
      libraryName?: string | null;
      app?: string;
      version?: string;
      requiresToken?: boolean;
    }>;
    send: (payload: {
      target: string;
      token: string;
      items: TransferSendItem[];
    }) => Promise<TransferSendResult>;
    regenerateToken: () => Promise<TransferConfigView>;
    onIncoming: (callback: (draft: DesktopImportDraft) => void) => () => void;
    onProgress: (callback: (progress: TransferProgress) => void) => () => void;
  };
  mobile: {
    getConfig: () => Promise<MobileConfigView>;
    setConfig: (patch: {
      enabled?: boolean;
      port?: number;
      preferredIp?: string;
      receiveMode?: MobileReceiveMode;
    }) => Promise<MobileActionResult & { config: MobileConfigView }>;
    start: () => Promise<MobileActionResult & { config: MobileConfigView }>;
    stop: () => Promise<MobileActionResult & { config: MobileConfigView }>;
    status: () => Promise<MobileConfigView>;
    qr: (payload?: { ip?: string }) => Promise<MobileActionResult>;
    rotate: () => Promise<MobileActionResult & { config: MobileConfigView }>;
    cast: (payload: {
      id?: string;
      ids?: string[];
      mode?: MobileReceiveMode;
    }) => Promise<MobileActionResult & { config?: MobileConfigView }>;
    disconnect: (payload: { id: string }) => Promise<MobileActionResult & { config: MobileConfigView }>;
    onStatus: (callback: (status: MobileStatusView) => void) => () => void;
    onCast: (callback: (result: MobileActionResult) => void) => () => void;
  };
  autoImport: {
    getConfig: () => Promise<AutoImportConfigView>;
    setConfig: (patch: {
      enabled?: boolean;
      folder?: string;
    }) => Promise<AutoImportResult>;
    chooseFolder: () => Promise<AutoImportResult>;
    scanNow: () => Promise<AutoImportResult>;
    status: () => Promise<AutoImportConfigView>;
    onStatus: (callback: (status: AutoImportStatusView) => void) => () => void;
  };
  duplicates: {
    scan: () => Promise<DuplicateScanResult>;
    cancel: () => Promise<{ ok: boolean }>;
    trash: (
      items: Array<{ id: string; libraryPath: string }>,
    ) => Promise<DuplicateTrashResult>;
    onProgress: (callback: (progress: DuplicateProgress) => void) => () => void;
  };
  health: {
    scan: () => Promise<HealthScanResult>;
    cleanPreviews: () => Promise<HealthCleanupResult>;
    emptyTrash: () => Promise<HealthCleanupResult>;
  };
  wallpaper: {
    set: (payload: { libraryPath: string }) => Promise<{
      ok: boolean;
      path?: string;
      error?: string;
    }>;
  };
}

export interface HealthCounts {
  photos: number;
  previews: number;
  previewBytes: number;
  missing: number;
  orphanPreviews: number;
  duplicatePaths: number;
  duplicateHashes: number;
  trashCount: number;
  trashBytes: number;
}

export interface HealthIssue {
  id: string;
  severity: 'ok' | 'info' | 'warning';
  title: string;
  detail: string;
  count: number;
  bytes: number;
}

export interface HealthScanResult {
  ok: boolean;
  error?: string;
  generatedAt?: string;
  counts: Partial<HealthCounts>;
  missingIds?: string[];
  issues: HealthIssue[];
}

export interface HealthCleanupResult {
  ok: boolean;
  error?: string;
  removed: number;
  bytes: number;
}

export interface DuplicateEntry {
  id: string;
  libraryPath: string;
  fileName: string;
  size: number;
  capturedAt: string;
  note: string;
  previewPath: string;
  managedCopy: boolean;
}

export interface DuplicateGroup {
  hash: string;
  entries: DuplicateEntry[];
  totalBytes: number;
  reclaimableBytes: number;
  suggestedKeepId: string;
}

export interface DuplicateProgress {
  done: number;
  total: number;
  scanned: number;
  skipped: number;
  file: string;
}

export interface DuplicateScanResult {
  ok: boolean;
  canceled?: boolean;
  error?: string;
  groups: DuplicateGroup[];
  scanned: number;
  skipped?: number;
  totalBytes?: number;
  reclaimableBytes?: number;
}

export interface DuplicateTrashResult {
  ok: boolean;
  error?: string;
  trashDir?: string;
  trashed: Array<{ id: string; libraryPath: string; to: string }>;
  errors: Array<{ id: string; error: string }>;
}

export interface AutoImportStatusView {
  enabled: boolean;
  folder: string;
  running: boolean;
  scanning: boolean;
  watched: boolean;
  startedAt: string | null;
  lastScanAt: string | null;
  lastImportedAt: string | null;
  importedCount: number;
  lastError: string | null;
}

export interface AutoImportConfigView {
  enabled: boolean;
  folder: string;
  lastScanAt: string | null;
  status: AutoImportStatusView;
}

export interface AutoImportResult {
  ok: boolean;
  error?: string;
  canceled?: boolean;
  imported?: number;
  skipped?: number;
  failed?: number;
  remaining?: number;
  config: AutoImportConfigView;
}

/** Returns the preload bridge when running inside the desktop client. */
export function getDesktopBridge(): DesktopBridge | null {
  if (typeof window === 'undefined') return null;
  const bridge = (window as Window & { hoshikuzu?: { desktop?: DesktopBridge } }).hoshikuzu?.desktop;
  return bridge && bridge.version ? bridge : null;
}

export function isDesktopRuntime(): boolean {
  return getDesktopBridge() !== null;
}
