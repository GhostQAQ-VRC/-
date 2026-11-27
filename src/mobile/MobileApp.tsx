import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  ArrowDownToLine,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Download,
  Images,
  Loader2,
  MonitorSmartphone,
  RefreshCw,
  Search,
  SearchX,
  Smartphone,
  Sparkles,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import { BrandGlyph } from '../components/BrandGlyph';
import {
  MobileApiError,
  fetchAlbum,
  fetchHello,
  formatBytes,
  formatMonthTitle,
  formatPhotoDate,
  formatPhotoTime,
  leaveSession,
  orientedRatio,
  savePhotoToPhone,
  setReceiveMode,
  startDirectDownload,
  type IncomingCast,
  type MobileAlbum,
  type MobileHello,
  type MobilePhoto,
} from './api';
import { isAndroidShell } from './native';
import '../styles/mobile-client.css';

type BootState = 'checking' | 'ready' | 'unpaired' | 'unsupported' | 'error';
type ReceiveMode = 'stream' | 'save';

const LAST_CAST_KEY = 'hoshikuzu-last-cast-v1';
const LAST_CAST_TTL_MS = 10 * 60 * 1000;

interface ToastState {
  id: number;
  text: string;
  tone: 'default' | 'success' | 'warning' | 'danger';
}

function Toast({ toast }: { toast: ToastState | null }) {
  return (
    <div className="m-toast-wrap" aria-live="polite" aria-atomic="true">
      {toast ? (
        <div className={`m-toast m-toast--${toast.tone}`} key={toast.id}>
          {toast.text}
        </div>
      ) : null}
    </div>
  );
}

function useToastQueue() {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<number | null>(null);
  const show = useCallback((text: string, tone: ToastState['tone'] = 'default') => {
    if (timer.current) window.clearTimeout(timer.current);
    setToast({ id: Date.now(), text, tone });
    timer.current = window.setTimeout(() => {
      timer.current = null;
      setToast(null);
    }, 3200);
  }, []);
  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );
  return { toast, show };
}

function holdVibrate(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // iOS Safari does not expose vibration.
  }
}

/**
 * Hold for ~380ms, then drag upwards. Used both by grid cards and the viewer.
 * The native touchmove listener is non-passive so the gesture can be cancelled
 * before the browser starts scrolling.
 */
function useHoldUpSave(onTrigger: () => void, enabled = true) {
  const ref = useRef<HTMLElement | null>(null);
  const consumed = useRef(false);
  const [armed, setArmed] = useState(false);
  const [distance, setDistance] = useState(0);
  const triggerRef = useRef(onTrigger);
  triggerRef.current = onTrigger;

  useEffect(() => {
    const element = ref.current;
    if (!element || !enabled) return;
    let timer = 0;
    let startX = 0;
    let startY = 0;
    let lifted = 0;
    let isArmed = false;

    const reset = () => {
      if (timer) {
        window.clearTimeout(timer);
        timer = 0;
      }
      isArmed = false;
      lifted = 0;
      setArmed(false);
      setDistance(0);
    };

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) {
        // A second finger turns this into a pinch; never let the hold gesture
        // keep arming (or fire) underneath it.
        reset();
        return;
      }
      startX = event.touches[0].clientX;
      startY = event.touches[0].clientY;
      isArmed = false;
      lifted = 0;
      setDistance(0);
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = 0;
        isArmed = true;
        setArmed(true);
        holdVibrate(12);
      }, 380);
    };

    const onTouchMove = (event: TouchEvent) => {
      if (!isArmed) {
        if (event.touches.length === 1 && timer) {
          const dx = event.touches[0].clientX - startX;
          const dy = event.touches[0].clientY - startY;
          if (Math.hypot(dx, dy) > 9) {
            window.clearTimeout(timer);
            timer = 0;
          }
        }
        return;
      }
      if (event.cancelable) event.preventDefault();
      lifted = Math.max(0, startY - event.touches[0].clientY);
      setDistance(lifted);
    };

    const onTouchEnd = () => {
      const shouldSave = isArmed && lifted >= 48;
      if (shouldSave) {
        consumed.current = true;
        triggerRef.current();
        window.setTimeout(() => {
          consumed.current = false;
        }, 700);
      }
      reset();
    };

    element.addEventListener('touchstart', onTouchStart, { passive: true });
    element.addEventListener('touchmove', onTouchMove, { passive: false });
    element.addEventListener('touchend', onTouchEnd);
    element.addEventListener('touchcancel', reset);
    return () => {
      reset();
      element.removeEventListener('touchstart', onTouchStart);
      element.removeEventListener('touchmove', onTouchMove);
      element.removeEventListener('touchend', onTouchEnd);
      element.removeEventListener('touchcancel', reset);
    };
  }, [enabled]);

  return { ref, armed, distance, consumed };
}

function PairingScreen({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="m-gate">
      <div className="m-gate__stars" aria-hidden="true" />
      <div className="m-gate__mark">
        <BrandGlyph size={46} />
      </div>
      <p className="m-gate__kicker">MOBILE CLIENT · 手机客户端</p>
      <h1>还没有和电脑配对</h1>
      <p className="m-gate__text">
        请在电脑端打开管理台 →「手机同步」，点开启后用相机扫描二维码；手机会自动进入这里。
      </p>
      <ol className="m-gate__steps">
        <li>
          <span>01</span>
          电脑和手机连同一个 Wi-Fi
        </li>
        <li>
          <span>02</span>
          电脑开启手机同步并显示二维码
        </li>
        <li>
          <span>03</span>
          手机扫码，保持这个页面打开
        </li>
      </ol>
      <button type="button" className="m-button m-button--primary" onClick={onRetry}>
        <RefreshCw size={15} />
        重新检测配对
      </button>
      <p className="m-gate__foot">配对链接只在电脑端开启期间有效，不会上传到互联网。</p>
    </div>
  );
}

function UnsupportedScreen({ message }: { message: string }) {
  return (
    <div className="m-gate">
      <div className="m-gate__stars" aria-hidden="true" />
      <div className="m-gate__mark">
        <MonitorSmartphone size={42} strokeWidth={1.3} />
      </div>
      <p className="m-gate__kicker">DESKTOP REQUIRED</p>
      <h1>手机客户端由电脑提供</h1>
      <p className="m-gate__text">{message}</p>
      <div className="m-gate__panel">
        <Smartphone size={16} />
        <span>
          打开桌面客户端 → 管理台 →「手机同步」→ 开启 → 用手机扫描二维码。电脑会作为局域网临时服务器，不占用手机空间。
        </span>
      </div>
    </div>
  );
}

function ModeSheet({
  mode,
  onChange,
  onClose,
  onLocal,
  busy,
}: {
  mode: ReceiveMode;
  onChange: (mode: ReceiveMode) => void;
  onClose: () => void;
  onLocal?: () => void;
  busy: boolean;
}) {
  return (
    <div className="m-sheet" role="dialog" aria-modal="true" aria-label="投送接收方式">
      <button type="button" className="m-sheet__scrim" aria-label="关闭" onClick={onClose} />
      <div className="m-sheet__panel">
        <div className="m-sheet__handle" aria-hidden="true" />
        <p className="m-sheet__kicker">DELIVERY MODE</p>
        <h2>电脑投送过来时</h2>
        <div className="m-mode-list">
          <button
            type="button"
            className={`m-mode${mode === 'stream' ? ' is-active' : ''}`}
            onClick={() => onChange('stream')}
            disabled={busy}
            aria-pressed={mode === 'stream'}
          >
            <span className="m-mode__icon">
              <Wifi size={18} />
            </span>
            <span className="m-mode__body">
              <strong>实时查看</strong>
              <small>电脑当临时服务器，照片直接从电脑读；不写入手机存储。</small>
            </span>
            <span className="m-mode__radio" aria-hidden="true" />
          </button>
          <button
            type="button"
            className={`m-mode${mode === 'save' ? ' is-active' : ''}`}
            onClick={() => onChange('save')}
            disabled={busy}
            aria-pressed={mode === 'save'}
          >
            <span className="m-mode__icon">
              <Download size={18} />
            </span>
            <span className="m-mode__body">
              <strong>保存到手机</strong>
              <small>投送后取回原图，保存到相册或下载目录，会占用手机空间。</small>
            </span>
            <span className="m-mode__radio" aria-hidden="true" />
          </button>
        </div>
        <p className="m-sheet__note">
          这里和电脑端「手机同步」里的设置是同一个开关，改哪边都会同步。
        </p>
        {onLocal ? (
          <button type="button" className="m-button m-button--ghost m-sheet__local" onClick={onLocal}>
            <Images size={15} />
            返回本地相册（不连接电脑）
          </button>
        ) : null}
        <button type="button" className="m-button m-button--ghost" onClick={onClose}>
          完成
        </button>
      </div>
    </div>
  );
}

function SaveProgress({ progress }: { progress: { loaded: number; total: number } | null }) {
  const percent =
    progress && progress.total > 0 ? Math.min(100, Math.round((progress.loaded / progress.total) * 100)) : 0;
  return (
    <span className="m-save-progress">
      <span className="m-save-progress__bar">
        <span style={{ width: `${progress ? percent : 8}%` }} />
      </span>
      <small>
        {progress && progress.total > 0
          ? `${formatBytes(progress.loaded)} / ${formatBytes(progress.total)}`
          : '正在读取原图…'}
      </small>
    </span>
  );
}

function IncomingOverlay({
  cast,
  saving,
  progress,
  onSave,
  onView,
  onClose,
}: {
  cast: IncomingCast;
  saving: boolean;
  progress: { loaded: number; total: number } | null;
  onSave: () => void;
  onView: () => void;
  onClose: () => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const [autoStarted, setAutoStarted] = useState(false);
  const autoCast = useRef<string | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const ratio = orientedRatio(cast.photo);

  useEffect(() => {
    setLoaded(false);
    setAutoStarted(false);
  }, [cast.id]);

  useEffect(() => {
    // A cached thumbnail can finish decoding before React attaches onLoad.
    const image = imageRef.current;
    if (image?.complete && image.naturalWidth > 0) setLoaded(true);
  }, [cast.id]);

  useEffect(() => {
    if (cast.mode !== 'save' || autoCast.current === cast.id) return;
    autoCast.current = cast.id;
    // Give the browser the download immediately. A blocked automatic download
    // is not fatal: the "保存到手机" button below retries with a user gesture.
    setAutoStarted(startDirectDownload(cast.photo));
  }, [cast.id, cast.mode, cast.photo]);

  return (
    <div className="m-incoming" role="dialog" aria-modal="true" aria-label="收到电脑投送的照片">
      <div className="m-incoming__glow" aria-hidden="true" />
      <header className="m-incoming__bar">
        <span className="m-incoming__live">
          <span aria-hidden="true" />
          来自电脑的投送
        </span>
        <button type="button" className="m-icon-btn" onClick={onClose} aria-label="关闭投送">
          <X size={18} />
        </button>
      </header>
      <div className="m-incoming__stage">
        <div
          className={`m-incoming__frame${loaded ? ' is-loaded' : ''}`}
          data-rot={cast.photo.rotation}
          style={{ aspectRatio: `${ratio}` }}
        >
          <img
            ref={imageRef}
            src={cast.photo.src}
            alt={cast.photo.alt}
            onLoad={() => setLoaded(true)}
          />
          <span className="m-incoming__beam" aria-hidden="true" />
        </div>
        <p className="m-incoming__note">
          {cast.photo.note || cast.photo.world?.name || formatPhotoDate(cast.photo.capturedAt)}
        </p>
        <p className="m-incoming__meta">
          {cast.mode === 'save'
            ? autoStarted
              ? '已开始保存 · 可在手机下载目录查看'
              : '等待保存到手机'
            : '实时读取中 · 不占用手机空间'}
          <span aria-hidden="true">·</span>
          {formatBytes(cast.photo.fileBytes)}
        </p>
      </div>
      <footer className="m-incoming__actions">
        {cast.mode === 'stream' ? (
          <>
            <button type="button" className="m-button m-button--primary" onClick={onView}>
              <MonitorSmartphone size={16} />
              大屏查看
            </button>
            <button
              type="button"
              className="m-button m-button--ghost"
              onClick={onSave}
              disabled={saving}
            >
              {saving ? <Loader2 size={16} className="spin" /> : <ArrowDownToLine size={16} />}
              保存到手机
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="m-button m-button--primary"
              onClick={onSave}
              disabled={saving}
            >
              {saving ? <Loader2 size={16} className="spin" /> : <Download size={16} />}
              {saving ? '正在保存…' : autoStarted ? '再保存一份' : '保存到手机'}
            </button>
            <button type="button" className="m-button m-button--ghost" onClick={onView}>
              先看看
            </button>
          </>
        )}
        {saving ? <SaveProgress progress={progress} /> : null}
        <button type="button" className="m-text-btn" onClick={onClose}>
          关闭，不收下这张
        </button>
      </footer>
    </div>
  );
}

function PhotoViewer({
  photos,
  index,
  mode,
  savingId,
  saveProgress,
  onIndex,
  onClose,
  onSave,
  onMode,
}: {
  photos: MobilePhoto[];
  index: number;
  mode: ReceiveMode;
  savingId: string | null;
  saveProgress: { loaded: number; total: number } | null;
  onIndex: (index: number) => void;
  onClose: () => void;
  onSave: (photo: MobilePhoto) => void;
  onMode: () => void;
}) {
  const photo = photos[index];
  const stageRef = useRef<HTMLDivElement | null>(null);
  const gesture = useRef({
    mode: 'none' as 'none' | 'drag' | 'pinch' | 'tap',
    startX: 0,
    startY: 0,
    at: 0,
    startDistance: 0,
    baseZoom: 1,
    basePanX: 0,
    basePanY: 0,
    lastTapAt: 0,
    lastTapX: 0,
    lastTapY: 0,
    moved: false,
  });
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const originalRef = useRef<HTMLImageElement | null>(null);
  const [originalLoaded, setOriginalLoaded] = useState(false);
  const [originalFailed, setOriginalFailed] = useState(false);
  const hold = useHoldUpSave(() => {
    if (photo) onSave(photo);
  }, Boolean(photo?.originalUrl) && zoom <= 1);

  useEffect(() => {
    setOriginalLoaded(false);
    setOriginalFailed(false);
  }, [photo?.id]);

  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    gesture.current.lastTapAt = 0;
  }, [photo?.id]);

  useEffect(() => {
    const image = originalRef.current;
    if (image?.complete && image.naturalWidth > 0) setOriginalLoaded(true);
  }, [photo?.id]);

  if (!photo) return null;
  const saving = savingId === photo.id;
  const ratio = orientedRatio(photo);
  const rotated = photo.rotation === 90 || photo.rotation === 270;

  const clampPan = (x: number, y: number, scale: number) => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return { x, y };
    const maxX = Math.max(0, (rect.width * (scale - 1)) / 2);
    const maxY = Math.max(0, (rect.height * (scale - 1)) / 2);
    return {
      x: Math.max(-maxX, Math.min(maxX, x)),
      y: Math.max(-maxY, Math.min(maxY, y)),
    };
  };

  const onTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    const state = gesture.current;
    if (event.touches.length >= 2) {
      const first = event.touches[0];
      const second = event.touches[1];
      state.mode = 'pinch';
      state.startDistance = Math.hypot(
        first.clientX - second.clientX,
        first.clientY - second.clientY,
      );
      state.baseZoom = zoom;
      state.basePanX = pan.x;
      state.basePanY = pan.y;
      state.moved = true;
      return;
    }
    const point = event.touches[0];
    if (!point) return;
    state.startX = point.clientX;
    state.startY = point.clientY;
    state.at = Date.now();
    state.basePanX = pan.x;
    state.basePanY = pan.y;
    state.mode = zoom > 1 ? 'drag' : 'tap';
    state.moved = false;
  };

  const onTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    const state = gesture.current;
    if (event.touches.length >= 2) {
      if (event.cancelable) event.preventDefault();
      const first = event.touches[0];
      const second = event.touches[1];
      const distance = Math.hypot(
        first.clientX - second.clientX,
        first.clientY - second.clientY,
      );
      if (state.startDistance <= 0) return;
      const next = Math.min(4, Math.max(1, state.baseZoom * (distance / state.startDistance)));
      state.mode = 'pinch';
      setZoom(next);
      setPan(
        next <= 1.02
          ? { x: 0, y: 0 }
          : clampPan(state.basePanX, state.basePanY, next),
      );
      return;
    }
    if (state.mode === 'drag' && zoom > 1 && event.touches.length === 1) {
      if (event.cancelable) event.preventDefault();
      const point = event.touches[0];
      const dx = point.clientX - state.startX;
      const dy = point.clientY - state.startY;
      if (Math.hypot(dx, dy) > 6) state.moved = true;
      setPan(clampPan(state.basePanX + dx, state.basePanY + dy, zoom));
    }
  };

  const onTouchEnd = (event: React.TouchEvent<HTMLDivElement>) => {
    const state = gesture.current;
    if (state.mode === 'pinch') {
      state.mode = 'none';
      if (zoom < 1.05) {
        setZoom(1);
        setPan({ x: 0, y: 0 });
      }
      return;
    }
    if (hold.consumed.current) {
      hold.consumed.current = false;
      state.mode = 'none';
      return;
    }
    const point = event.changedTouches[0];
    if (!point) {
      state.mode = 'none';
      return;
    }
    const dx = point.clientX - state.startX;
    const dy = point.clientY - state.startY;
    const elapsed = Date.now() - state.at;
    const isTap = elapsed < 320 && Math.hypot(dx, dy) < 12;
    const now = Date.now();
    if (state.mode === 'drag') {
      if (
        !state.moved &&
        now - state.lastTapAt < 320 &&
        Math.hypot(point.clientX - state.lastTapX, point.clientY - state.lastTapY) < 30
      ) {
        // Double-tap while zoomed: return to fit.
        setZoom(1);
        setPan({ x: 0, y: 0 });
        state.lastTapAt = 0;
      } else if (!state.moved) {
        state.lastTapAt = now;
        state.lastTapX = point.clientX;
        state.lastTapY = point.clientY;
      }
      state.mode = 'none';
      return;
    }
    if (isTap) {
      if (
        now - state.lastTapAt < 320 &&
        Math.hypot(point.clientX - state.lastTapX, point.clientY - state.lastTapY) < 30
      ) {
        setZoom(2.5);
        setPan({ x: 0, y: 0 });
        state.lastTapAt = 0;
      } else {
        state.lastTapAt = now;
        state.lastTapX = point.clientX;
        state.lastTapY = point.clientY;
      }
      state.mode = 'none';
      return;
    }
    if (
      elapsed < 600 &&
      Math.abs(dx) > 54 &&
      Math.abs(dx) > Math.abs(dy) * 1.2
    ) {
      if (dx < 0 && index < photos.length - 1) onIndex(index + 1);
      if (dx > 0 && index > 0) onIndex(index - 1);
    }
    state.mode = 'none';
  };

  return (
    <div className="m-viewer" role="dialog" aria-modal="true" aria-label="照片大图">
      <header className="m-viewer__bar">
        <button type="button" className="m-icon-btn" onClick={onClose} aria-label="关闭大图">
          <X size={19} />
        </button>
        <div className="m-viewer__title">
          <strong>{formatPhotoDate(photo.capturedAt)}</strong>
          <span>
            {formatPhotoTime(photo.capturedAt)}
            {photos.length > 1 ? ` · ${index + 1} / ${photos.length}` : ''}
          </span>
        </div>
        <button type="button" className="m-icon-btn" onClick={onMode} aria-label="接收方式">
          <Sparkles size={17} />
        </button>
      </header>

      <div
        className={`m-viewer__stage${hold.armed ? ' is-holding' : ''}${zoom > 1 ? ' is-zoomed' : ''}`}
        ref={(node) => {
          stageRef.current = node;
          (hold.ref as unknown as React.MutableRefObject<HTMLDivElement | null>).current =
            node;
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
      <div
        className={`m-viewer__photo${rotated ? ' is-rotated' : ''}`}
        data-rot={photo.rotation}
        style={{ aspectRatio: `${ratio}` }}
      >
        <div
          className={`m-viewer__zoom${zoom > 1 ? ' is-zoomed' : ''}`}
          style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
        >
          {!originalLoaded ? (
            <img className="m-viewer__preview" src={photo.src} alt="" aria-hidden="true" />
          ) : null}
          {photo.originalUrl && !originalFailed ? (
            <img
              ref={originalRef}
              className={`m-viewer__original${originalLoaded ? ' is-loaded' : ''}`}
              src={photo.originalUrl}
              alt={photo.alt}
              onLoad={() => setOriginalLoaded(true)}
              onError={() => setOriginalFailed(true)}
            />
          ) : null}
          {!photo.originalUrl ? <img className="m-viewer__original is-loaded" src={photo.src} alt={photo.alt} /> : null}
        </div>
        {hold.armed ? (
          <span className="m-viewer__hold" style={{ opacity: Math.min(1, hold.distance / 48) }}>
            <ArrowDownToLine size={18} />
            继续上滑，保存到手机
          </span>
        ) : null}
        </div>
        {index > 0 ? (
          <button
            type="button"
            className="m-viewer__nav m-viewer__nav--prev"
            onClick={() => onIndex(index - 1)}
            aria-label="上一张"
          >
            <ChevronLeft size={20} />
          </button>
        ) : null}
        {index < photos.length - 1 ? (
          <button
            type="button"
            className="m-viewer__nav m-viewer__nav--next"
            onClick={() => onIndex(index + 1)}
            aria-label="下一张"
          >
            <ChevronRight size={20} />
          </button>
        ) : null}
      </div>

      <footer className="m-viewer__foot">
        <div className="m-viewer__meta">
          <p className="m-viewer__note">{photo.note || '还没有写下备注。'}</p>
          <p className="m-viewer__sub">
            {photo.world ? photo.world.name : '未关联世界'}
            <span aria-hidden="true">·</span>
            {formatBytes(photo.fileBytes)}
            <span aria-hidden="true">·</span>
            {mode === 'stream' ? '实时读取' : '可保存'}
          </p>
          {saving ? <SaveProgress progress={saveProgress} /> : null}
        </div>
        <button
          type="button"
          className="m-button m-button--primary m-viewer__save"
          onClick={() => onSave(photo)}
          disabled={saving || !photo.originalUrl}
        >
          {saving ? <Loader2 size={16} className="spin" /> : <ArrowDownToLine size={16} />}
          {saving ? '保存中…' : '保存到手机'}
        </button>
      </footer>
    </div>
  );
}

function MobilePhotoCard({
  photo,
  onOpen,
  onSave,
}: {
  photo: MobilePhoto;
  onOpen: () => void;
  onSave: () => void;
}) {
  const hold = useHoldUpSave(onSave, Boolean(photo.originalUrl));
  const ratio = orientedRatio(photo);
  return (
    <div
      className={`m-card${hold.armed ? ' is-holding' : ''}`}
      ref={hold.ref as React.RefObject<HTMLDivElement>}
      role="button"
      tabIndex={0}
      onClick={() => {
        if (hold.consumed.current) {
          hold.consumed.current = false;
          return;
        }
        onOpen();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen();
        }
      }}
      onContextMenu={(event) => event.preventDefault()}
      aria-label={`查看 ${formatPhotoDate(photo.capturedAt)} 的照片：${photo.note || photo.alt}`}
    >
      <span
        className="m-card__frame"
        data-rot={photo.rotation}
        style={{ aspectRatio: `${ratio}` }}
      >
        <img src={photo.src} alt={photo.alt} loading="lazy" decoding="async" draggable={false} />
        <span className="m-card__shade" aria-hidden="true" />
        <span className="m-card__time">{formatPhotoTime(photo.capturedAt)}</span>
        {hold.armed ? (
          <span className="m-card__hold" style={{ opacity: Math.min(1, 0.35 + hold.distance / 60) }}>
            <ArrowDownToLine size={14} />
            上滑保存
          </span>
        ) : null}
      </span>
      <span className="m-card__body">
        <span className="m-card__note">{photo.note || photo.world?.name || '一段没有写下的记忆'}</span>
        <span className="m-card__world">
          {photo.world?.name || '未关联世界'}
          <i aria-hidden="true" />
          {formatPhotoDate(photo.capturedAt)}
        </span>
      </span>
    </div>
  );
}

export function MobileApp() {
  const [boot, setBoot] = useState<BootState>('checking');
  const [bootError, setBootError] = useState('');
  const [server, setServer] = useState<MobileHello['server'] | null>(null);
  const [album, setAlbum] = useState<MobileAlbum | null>(null);
  const [mode, setMode] = useState<ReceiveMode>('stream');
  const [online, setOnline] = useState(false);
  const [incoming, setIncoming] = useState<IncomingCast | null>(null);
  const [modeSheet, setModeSheet] = useState(false);
  const [modeBusy, setModeBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [year, setYear] = useState('all');
  const [world, setWorld] = useState('all');
  const [viewer, setViewer] = useState<{ photos: MobilePhoto[]; index: number } | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [saveProgress, setSaveProgress] = useState<{ loaded: number; total: number } | null>(null);
  const { toast, show } = useToastQueue();
  const [refreshKey, setRefreshKey] = useState(0);

  const loadAlbum = useCallback(
    async (quiet = false) => {
      try {
        const data = await fetchAlbum();
        setAlbum(data);
        setMode(data.mode);
        setOnline(true);
        return data;
      } catch (error) {
        if (!quiet) {
          const message = error instanceof Error ? error.message : '相册读取失败。';
          show(message, 'danger');
        }
        return null;
      }
    },
    [show],
  );

  useEffect(() => {
    let alive = true;
    setBoot('checking');
    void (async () => {
      try {
        const hello = await fetchHello();
        if (!alive) return;
        setServer(hello.server);
        setMode(hello.server.receiveMode);
        const data = await fetchAlbum();
        if (!alive) return;
        setAlbum(data);
        setMode(data.mode);
        setBoot('ready');
      } catch (error) {
        if (!alive) return;
        if (error instanceof MobileApiError && (error.status === 401 || error.code === 'pairing-required')) {
          setBoot('unpaired');
          return;
        }
        if (error instanceof MobileApiError && error.status === 404) {
          setBoot('unsupported');
          setBootError('当前页面不是由桌面客户端的手机同步服务打开的，所以读不到相册。');
          return;
        }
        if (error instanceof MobileApiError && error.code === 'not-mobile') {
          setBoot('unsupported');
          setBootError('当前地址不是手机同步服务。请回到电脑端「手机同步」重新扫码。');
          return;
        }
        if (error instanceof MobileApiError && error.status === 405) {
          setBoot('unsupported');
          setBootError('当前页面不是由桌面客户端的手机同步服务打开的，所以读不到相册。');
          return;
        }
        setBootError(error instanceof Error ? error.message : '无法连接电脑端。');
        setBoot('error');
      }
    })();
    return () => {
      alive = false;
    };
  }, [refreshKey]);

  useEffect(() => {
    if (boot !== 'ready') return;
    const stream = new EventSource('/api/mobile/events');
    stream.onopen = () => {
      setOnline(true);
      // Catch up on album edits that happened while the SSE connection was
      // reconnecting or the phone was asleep.
      void loadAlbum(true);
    };
    stream.onerror = () => {
      setOnline(false);
      void fetchHello().catch((error) => {
        if (
          error instanceof MobileApiError &&
          (error.status === 401 || error.code === 'pairing-required')
        ) {
          setBoot('unpaired');
        }
      });
    };
    stream.addEventListener('cast', (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent<string>).data) as IncomingCast;
        if (!payload?.photo?.src) return;
        setIncoming(payload);
        setMode(payload.mode);
        holdVibrate([18, 70, 18]);
        // Persist briefly so returning from a notification (or a WebView
        // restart) still shows the cast overlay.
        try {
          window.localStorage.setItem(
            LAST_CAST_KEY,
            JSON.stringify({ cast: payload, at: Date.now() }),
          );
        } catch {
          // Private mode / storage full: the overlay still works in-session.
        }
        const visible =
          document.visibilityState === 'visible' && document.hasFocus();
        if (!visible) {
          window.HoshikuzuAndroid?.notifyCast?.(
            payload.photo.id,
            '收到一张投送',
            payload.photo.note ||
              payload.photo.world?.name ||
              '电脑把一张照片投送到了手机',
          );
        }
      } catch {
        // Ignore malformed events.
      }
    });
    stream.addEventListener('album', () => {
      void loadAlbum(true);
    });
    stream.addEventListener('mode', (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent<string>).data) as { mode: ReceiveMode };
        if (payload.mode === 'stream' || payload.mode === 'save') setMode(payload.mode);
      } catch {
        // Ignore.
      }
    });
    stream.addEventListener('status', (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent<string>).data) as {
          running?: boolean;
          deviceCount?: number;
        };
        if (payload.running === false) setOnline(false);
      } catch {
        // Ignore.
      }
    });
    stream.addEventListener('offline', () => setOnline(false));
    return () => {
      stream.close();
    };
  }, [boot, loadAlbum]);

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') return;
    };
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  }, []);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(LAST_CAST_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as { cast?: IncomingCast; at?: number };
      if (!saved?.cast?.photo?.src || Date.now() - Number(saved.at || 0) > LAST_CAST_TTL_MS) {
        window.localStorage.removeItem(LAST_CAST_KEY);
        return;
      }
      setIncoming(saved.cast);
      setMode(saved.cast.mode);
    } catch {
      // Ignore a corrupt/expired cast cache.
    }
  }, []);

  const photos = album?.photos ?? [];
  const years = useMemo(() => {
    const set = new Set<number>();
    for (const photo of photos) {
      const parsed = Number.parseInt(photo.capturedAt.slice(0, 4), 10);
      if (Number.isFinite(parsed)) set.add(parsed);
    }
    return Array.from(set).sort((a, b) => b - a);
  }, [photos]);
  const worlds = useMemo(() => {
    const set = new Set<string>();
    for (const photo of photos) {
      if (photo.world?.name) set.add(photo.world.name);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'zh-CN'));
  }, [photos]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return photos.filter((photo) => {
      if (year !== 'all' && !photo.capturedAt.startsWith(year)) return false;
      if (world !== 'all' && photo.world?.name !== world) return false;
      if (!needle) return true;
      const haystack = `${photo.note} ${photo.world?.name || ''} ${photo.alt}`.toLowerCase();
      return haystack.includes(needle);
    });
  }, [photos, query, year, world]);

  const groups = useMemo(() => {
    const map = new Map<string, MobilePhoto[]>();
    for (const photo of filtered) {
      const key = photo.capturedAt.slice(0, 7);
      const list = map.get(key);
      if (list) list.push(photo);
      else map.set(key, [photo]);
    }
    return Array.from(map.entries());
  }, [filtered]);

  const featured = useMemo(() => {
    if (!album) return null;
    const pinned = album.settings.featuredPhotoId
      ? photos.find((photo) => photo.id === album.settings.featuredPhotoId)
      : undefined;
    return pinned ?? photos[0] ?? null;
  }, [album, photos]);

  const openPhoto = useCallback(
    (photo: MobilePhoto) => {
      setViewer({ photos: filtered.length ? filtered : photos, index: Math.max(0, filtered.findIndex((item) => item.id === photo.id)) });
    },
    [filtered, photos],
  );

  const openFeatured = useCallback(() => {
    if (!featured) return;
    setViewer({ photos, index: Math.max(0, photos.findIndex((photo) => photo.id === featured.id)) });
  }, [featured, photos]);

  const openLocal = useCallback(() => {
    window.HoshikuzuAndroid?.openLocal?.();
  }, []);

  const savePhoto = useCallback(
    async (photo: MobilePhoto) => {
      if (savingId) return;
      setSavingId(photo.id);
      setSaveProgress({ loaded: 0, total: photo.fileBytes });
      try {
        const result = await savePhotoToPhone(photo, {
          onProgress: (loaded, total) => setSaveProgress({ loaded, total }),
        });
        show(
          result === 'started'
            ? '已开始保存到手机，完成后会提示'
            : result === 'shared'
              ? '已交给系统保存 / 分享'
              : '已保存到手机下载目录',
          'success',
        );
      } catch (error) {
        if ((error as Error)?.name === 'AbortError') {
          show('已取消保存', 'warning');
        } else {
          show(error instanceof Error ? error.message : '保存失败', 'danger');
        }
      } finally {
        setSavingId(null);
        setSaveProgress(null);
      }
    },
    [savingId, show],
  );

  const changeMode = useCallback(
    async (next: ReceiveMode) => {
      if (next === mode || modeBusy) return;
      setModeBusy(true);
      const previous = mode;
      setMode(next);
      try {
        const result = await setReceiveMode(next);
        setMode(result.mode);
        show(
          result.mode === 'stream'
            ? '已切换：投送时实时查看，不占手机空间'
            : '已切换：投送后保存原图到手机',
          'success',
        );
      } catch (error) {
        setMode(previous);
        show(error instanceof Error ? error.message : '切换失败', 'danger');
      } finally {
        setModeBusy(false);
      }
    },
    [mode, modeBusy, show],
  );

  const incomingSave = useCallback(() => {
    if (!incoming) return;
    void savePhoto(incoming.photo);
  }, [incoming, savePhoto]);

  const incomingView = useCallback(() => {
    if (!incoming) return;
    setViewer({ photos: [incoming.photo], index: 0 });
    setIncoming(null);
    try {
      window.localStorage.removeItem(LAST_CAST_KEY);
    } catch {
      // Ignore storage errors.
    }
  }, [incoming]);

  useEffect(() => {
    if (!viewer) return;
    const onKey = (event: KeyboardEvent) => {      if (event.key === 'Escape') setViewer(null);
      if (event.key === 'ArrowRight' && viewer.index < viewer.photos.length - 1) {
        setViewer({ ...viewer, index: viewer.index + 1 });
      }
      if (event.key === 'ArrowLeft' && viewer.index > 0) {
        setViewer({ ...viewer, index: viewer.index - 1 });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [viewer]);

  useEffect(() => {
    const locked = Boolean(viewer || incoming || modeSheet);
    document.body.classList.toggle('m-lock', locked);
    return () => document.body.classList.remove('m-lock');
  }, [viewer, incoming, modeSheet]);

  useEffect(() => {
    // Android shell: hardware back closes the topmost web overlay first.
    window.__hoshikuzuHandleBack = () => {
      if (modeSheet) {
        setModeSheet(false);
        return true;
      }
      if (incoming) {
        setIncoming(null);
        try {
          window.localStorage.removeItem(LAST_CAST_KEY);
        } catch {
          // Ignore storage errors.
        }
        return true;
      }
      if (viewer) {
        setViewer(null);
        return true;
      }
      return false;
    };
    return () => {
      delete window.__hoshikuzuHandleBack;
    };
  }, [viewer, incoming, modeSheet]);

  useEffect(() => {
    const root = document.documentElement;
    // The LAN page shares the built index.html (and theme-boot.js) with the
    // public site. Force the phone client onto its own dark palette even if
    // this origin happens to have an old light-theme cache.
    root.dataset.theme = 'twilight';
    root.dataset.tone = 'dark';
    root.dataset.layout = 'starlight';
    root.dataset.background = 'stars';
    root.style.colorScheme = 'dark';
  }, []);

  useEffect(() => {
    if (album) {
      document.title = `${album.settings.siteName} · 手机版`;
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute('content', '#070510');
    }
  }, [album]);

  useEffect(
    () => () => {
      void leaveSession();
    },
    [],
  );

  if (boot === 'unpaired') {
    return <PairingScreen onRetry={() => setRefreshKey((value) => value + 1)} />;
  }
  if (boot === 'unsupported') {
    return <UnsupportedScreen message={bootError} />;
  }
  if (boot === 'error') {
    return (
      <div className="m-gate">
        <div className="m-gate__stars" aria-hidden="true" />
        <div className="m-gate__mark">
          <CircleAlert size={40} strokeWidth={1.3} />
        </div>
        <p className="m-gate__kicker">CONNECTION LOST</p>
        <h1>和电脑的连接断开了</h1>
        <p className="m-gate__text">{bootError}</p>
        <button
          type="button"
          className="m-button m-button--primary"
          onClick={() => setRefreshKey((value) => value + 1)}
        >
          <RefreshCw size={15} />
          重新连接
        </button>
      </div>
    );
  }
  if (boot === 'checking' || !album) {
    return (
      <div className="m-boot">
        <div className="m-boot__mark">
          <BrandGlyph size={52} />
          <span className="m-boot__ring" aria-hidden="true" />
        </div>
        <p>正在连接电脑上的时光轴…</p>
        <span>同一 Wi-Fi · 直接读取 · 不经过互联网</span>
      </div>
    );
  }

  return (
    <div className={`m-app m-app--${mode}`}>
      <div className="m-app__atmosphere" aria-hidden="true" />
      <div className="m-app__grain" aria-hidden="true" />

      <header className="m-topbar">
        <div className="m-brand">
          <BrandGlyph size={22} />
          <span>
            <strong>{album.settings.siteName}</strong>
            <small>{album.settings.siteNameEn}</small>
          </span>
        </div>
        <button
          type="button"
          className={`m-conn${online ? ' is-online' : ''}`}
          onClick={() => setModeSheet(true)}
          aria-label={`电脑${online ? '在线' : '离线'}，点击切换投送方式`}
        >
          {online ? <Wifi size={12} /> : <WifiOff size={12} />}
          <span>{online ? '电脑在线' : '重连中'}</span>
          <i aria-hidden="true" />
          <small>{mode === 'stream' ? '实时' : '保存'}</small>
        </button>
        {isAndroidShell() ? (
          <button
            type="button"
            className="m-conn m-local-return"
            onClick={openLocal}
            aria-label="返回本地相册"
          >
            <Images size={12} />
            <span>本地</span>
          </button>
        ) : null}
      </header>

      <main className="m-main">
        {featured ? (
          <section className="m-hero" aria-label="精选记忆">
            <button type="button" className="m-hero__card" onClick={openFeatured}>
              <img src={featured.src} alt="" aria-hidden="true" />
              <span className="m-hero__veil" aria-hidden="true" />
              <span className="m-hero__content">
                <span className="m-hero__kicker">
                  <Sparkles size={11} />
                  MEMORY TIMELINE
                </span>
                <strong>{album.settings.tagline || '收藏世界之间的每一次相遇'}</strong>
                <span className="m-hero__meta">
                  <span>{album.stats.photos} 张记忆</span>
                  <span aria-hidden="true">·</span>
                  <span>{album.stats.worlds} 个世界</span>
                  <span aria-hidden="true">·</span>
                  <span>{album.stats.years} 年</span>
                </span>
                <span className="m-hero__open">
                  打开最新一张
                  <ChevronRight size={13} />
                </span>
              </span>
            </button>
            <div className="m-hero__intro">
              <p>
                <span className="m-hero__intro-kicker">MOBILE TEST BUILD</span>
                手机测试版 · 由电脑实时提供
              </p>
              <span className="m-hero__library">{server?.libraryName || album.libraryName}</span>
            </div>
          </section>
        ) : (
          <section className="m-empty">
            <BrandGlyph size={36} />
            <h1>相册还是空的</h1>
            <p>在电脑端收录第一张照片后，刷新这里就能看到。</p>
          </section>
        )}

        <section className="m-controls" aria-label="搜索与筛选">
          <label className="m-search">
            <Search size={15} aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索备注、世界名…"
              enterKeyHint="search"
              aria-label="搜索照片"
            />
            {query ? (
              <button type="button" onClick={() => setQuery('')} aria-label="清空搜索">
                <X size={13} />
              </button>
            ) : null}
          </label>
          <div className="m-chips" role="group" aria-label="按年份筛选">
            <button
              type="button"
              className={`m-chip${year === 'all' ? ' is-active' : ''}`}
              onClick={() => setYear('all')}
            >
              全部
            </button>
            {years.map((item) => (
              <button
                key={item}
                type="button"
                className={`m-chip${year === String(item) ? ' is-active' : ''}`}
                onClick={() => setYear(String(item))}
              >
                {item}
              </button>
            ))}
          </div>
          {worlds.length > 0 ? (
            <select
              className="m-world-select"
              value={world}
              onChange={(event) => setWorld(event.target.value)}
              aria-label="按世界筛选"
            >
              <option value="all">全部世界</option>
              {worlds.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          ) : null}
          <div className="m-count">
            <span>{filtered.length}</span> / {photos.length} 张
            {query || year !== 'all' || world !== 'all' ? (
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  setYear('all');
                  setWorld('all');
                }}
              >
                清除筛选
              </button>
            ) : null}
          </div>
        </section>

        <section className="m-timeline" aria-label="时光轴">
          {groups.length === 0 ? (
            <div className="m-empty m-empty--filter">
              <SearchX size={28} strokeWidth={1.3} />
              <h2>没有找到符合条件的记忆</h2>
              <p>换个关键词，或清除筛选再看看。</p>
            </div>
          ) : (
            groups.map(([month, list]) => (
              <div className="m-month" key={month}>
                <header className="m-month__head">
                  <h2>{formatMonthTitle(`${month}-01`)}</h2>
                  <span>{list.length} 张</span>
                  <i aria-hidden="true" />
                </header>
                <div className="m-grid">
                  {list.map((photo) => (
                    <MobilePhotoCard
                      key={photo.id}
                      photo={photo}
                      onOpen={() => openPhoto(photo)}
                      onSave={() => void savePhoto(photo)}
                    />
                  ))}
                </div>
              </div>
            ))
          )}
        </section>

        <footer className="m-footer">
          <BrandGlyph size={18} />
          <p>{album.settings.siteName} · 手机测试版</p>
          <span>
            {mode === 'stream'
              ? '照片由电脑实时读取，不占用手机空间'
              : '投送的照片可保存到手机'}
          </span>
          <span className="m-footer__hint">长按照片向上滑，可以保存到手机</span>
        </footer>
      </main>

      {viewer ? (
        <PhotoViewer
          photos={viewer.photos}
          index={viewer.index}
          mode={mode}
          savingId={savingId}
          saveProgress={saveProgress}
          onIndex={(index) => setViewer({ ...viewer, index })}
          onClose={() => setViewer(null)}
          onSave={(photo) => void savePhoto(photo)}
          onMode={() => setModeSheet(true)}
        />
      ) : null}

      {incoming ? (
        <IncomingOverlay
          cast={incoming}
          saving={savingId === incoming.photo.id}
          progress={saveProgress}
          onSave={incomingSave}
          onView={incomingView}
          onClose={() => {
            setIncoming(null);
            try {
              window.localStorage.removeItem(LAST_CAST_KEY);
            } catch {
              // Ignore storage errors.
            }
          }}
        />
      ) : null}

      {modeSheet ? (
        <ModeSheet
          mode={mode}
          onChange={(next) => void changeMode(next)}
          onClose={() => setModeSheet(false)}
          onLocal={isAndroidShell() ? openLocal : undefined}
          busy={modeBusy}
        />
      ) : null}

      <Toast toast={toast} />
    </div>
  );
}

export function MobileBootScreen({ children }: { children?: ReactNode }) {
  return <div className="m-boot">{children}</div>;
}
