import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import type { ImageLoadingMode } from '../platform';

interface LoaderEntry {
  id: string;
  index: number;
  src: string;
  element: HTMLElement;
  notify: (allowed: boolean) => void;
}

interface LoaderContextValue {
  manager: ThumbnailLoadManager;
  mode: ImageLoadingMode;
}

const LoaderContext = createContext<LoaderContextValue | null>(null);

const VISIBILITY_MARGIN = 300;
// Keep the predicted window inside a decoded-memory budget. 2560px previews
// therefore predict fewer cards than 960px ones, protecting low-VRAM GPUs.
const DECODE_BUDGET_BYTES = 224 * 1024 * 1024;
const DEFAULT_PREVIEW_EDGE = 1600;

/**
 * Owns the visible window for timeline thumbnails.
 *
 * realtime   -> visible cards only
 * predictive -> visible cards plus ~10–20 (5%) in the scroll direction
 * preload    -> visible cards only, but every thumbnail is fetched once in the
 *               background so scrolling reads from cache
 *
 * Images outside the window are un-mounted (src removed), which lets Chromium
 * free decoded bitmaps. This is the main GPU-memory saver on big libraries.
 */
class ThumbnailLoadManager {
  mode: ImageLoadingMode;
  entries = new Map<string, LoaderEntry>();
  byIndex = new Map<number, string>();
  visible = new Set<number>();
  windowStart = 0;
  windowEnd = -1;
  maxIndex = 0;
  direction: 'down' | 'up' = 'down';
  lastScrollY = 0;
  observer: IntersectionObserver | null = null;
  recomputePending = false;
  recomputeForce = false;
  scrollRaf = 0;
  prefetchQueue: string[] = [];
  prefetchSeen = new Set<string>();
  prefetchActive = 0;
  prefetchTotal = 0;
  prefetchDone = 0;
  disposed = false;
  previewMaxEdge = DEFAULT_PREVIEW_EDGE;

  constructor(mode: ImageLoadingMode) {
    this.mode = mode;
    this.lastScrollY = typeof window === 'undefined' ? 0 : window.scrollY;
    this.updateDebugAttributes();
    if (typeof window === 'undefined') return;
    if (typeof IntersectionObserver !== 'undefined') {
      this.observer = new IntersectionObserver(
        (records) => {
          let changed = false;
          for (const record of records) {
            const index = Number((record.target as HTMLElement).dataset.thumbIndex || 0);
            if (!index) continue;
            if (record.isIntersecting) {
              if (!this.visible.has(index)) {
                this.visible.add(index);
                changed = true;
              }
            } else if (this.visible.delete(index)) {
              changed = true;
            }
          }
          if (changed) this.scheduleRecompute();
        },
        { threshold: 0.01, rootMargin: `${VISIBILITY_MARGIN}px 0px ${VISIBILITY_MARGIN}px 0px` },
      );
    }
    window.addEventListener('scroll', this.onScroll, { passive: true });
  }

  onScroll = () => {
    if (this.scrollRaf) return;
    this.scrollRaf = window.requestAnimationFrame(() => {
      this.scrollRaf = 0;
      const y = window.scrollY;
      const next = y > this.lastScrollY + 2 ? 'down' : y < this.lastScrollY - 2 ? 'up' : this.direction;
      this.lastScrollY = y;
      if (next !== this.direction) {
        this.direction = next;
        this.scheduleRecompute();
      }
    });
  };

  setMode(mode: ImageLoadingMode) {
    if (this.mode === mode) return;
    this.mode = mode;
    this.updateDebugAttributes();
    if (mode === 'preload') {
      this.startPrefetch();
    } else {
      this.cancelPrefetch();
    }
    this.scheduleRecompute(true);
  }

  setPreviewMaxEdge(edge: number | undefined) {
    const next = Number.isFinite(Number(edge)) && Number(edge) > 0
      ? Number(edge)
      : DEFAULT_PREVIEW_EDGE;
    if (next === this.previewMaxEdge) return;
    this.previewMaxEdge = next;
    this.scheduleRecompute(true);
  }

  predictAhead(total: number): number {
    const bytesPerImage = Math.max(1, this.previewMaxEdge * this.previewMaxEdge * 0.5625 * 4);
    const maxImages = Math.max(8, Math.floor(DECODE_BUDGET_BYTES / bytesPerImage));
    const byPercent = Math.ceil(total * 0.05);
    return Math.max(10, Math.min(20, maxImages - 6, byPercent));
  }

  updateDebugAttributes() {
    if (typeof document === 'undefined') return;
    document.documentElement.dataset.thumbMode = this.mode;
    document.documentElement.dataset.thumbPrefetch = String(this.prefetchDone);
    document.documentElement.dataset.thumbPrefetchTotal = String(this.prefetchTotal);
  }

  register(
    id: string,
    index: number,
    src: string,
    element: HTMLElement,
    notify: (allowed: boolean) => void,
  ): () => void {
    const previous = this.entries.get(id);
    if (previous && previous.index !== index) {
      if (this.byIndex.get(previous.index) === id) this.byIndex.delete(previous.index);
      this.visible.delete(previous.index);
    }
    element.dataset.thumbIndex = String(index);
    const entry: LoaderEntry = { id, index, src, element, notify };
    this.entries.set(id, entry);
    this.byIndex.set(index, id);
    this.maxIndex = Math.max(this.maxIndex, index);

    if (previous && previous.element !== element) {
      this.observer?.unobserve(previous.element);
    }
    this.observer?.observe(element);

    this.scheduleRecompute();
    notify(this.inWindow(index));
    if (this.mode === 'preload') this.enqueuePrefetch(src);
    return () => this.unregister(id);
  }

  unregister(id: string) {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.entries.delete(id);
    if (this.byIndex.get(entry.index) === id) this.byIndex.delete(entry.index);
    this.visible.delete(entry.index);
    this.observer?.unobserve(entry.element);
    this.scheduleRecompute();
  }

  inWindow(index: number) {
    return index >= this.windowStart && index <= this.windowEnd;
  }

  scheduleRecompute(force = false) {
    if (force) this.recomputeForce = true;
    if (this.recomputePending) return;
    this.recomputePending = true;
    // Coalesce a whole page of card registrations / observer records.
    queueMicrotask(() => {
      this.recomputePending = false;
      const shouldForce = this.recomputeForce;
      this.recomputeForce = false;
      this.recompute(shouldForce);
    });
  }

  recompute(force = false) {
    if (this.disposed) return;
    const total = this.maxIndex;
    const visibleIndices = [...this.visible]
      .filter((index) => this.byIndex.has(index))
      .sort((a, b) => a - b);

    let start = 0;
    let end = -1;
    if (visibleIndices.length > 0 && total > 0) {
      const first = visibleIndices[0];
      const last = visibleIndices[visibleIndices.length - 1];
      if (this.mode === 'predictive') {
        const ahead = this.predictAhead(total);
        const behind = 4;
        if (this.direction === 'down') {
          start = first - behind;
          end = last + ahead;
        } else {
          start = first - ahead;
          end = last + behind;
        }
      } else {
        // realtime / preload: decode only what is around the viewport.
        start = first - 2;
        end = last + 2;
      }
      start = Math.max(1, start);
      end = Math.min(total, end);
      if (end < start) {
        start = 0;
        end = -1;
      }
    }

    if (!force && start === this.windowStart && end === this.windowEnd) return;
    const previousStart = this.windowStart;
    const previousEnd = this.windowEnd;
    this.windowStart = start;
    this.windowEnd = end;
    if (typeof document !== 'undefined') {
      document.documentElement.dataset.thumbWindow =
        start <= end ? `${start}-${end}` : 'none';
    }

    if (force) {
      for (const entry of this.entries.values()) {
        entry.notify(entry.index >= start && entry.index <= end);
      }
      return;
    }

    for (let index = start; index <= end; index += 1) {
      if (index >= previousStart && index <= previousEnd) continue;
      const id = this.byIndex.get(index);
      if (id) this.entries.get(id)?.notify(true);
    }
    for (let index = previousStart; index <= previousEnd; index += 1) {
      if (index >= start && index <= end) continue;
      const id = this.byIndex.get(index);
      if (id) this.entries.get(id)?.notify(false);
    }
  }

  enqueuePrefetch(src: string) {
    if (this.mode !== 'preload' || !src || !src.startsWith('hoshikuzu-media://preview/')) return;
    if (this.prefetchSeen.has(src)) return;
    this.prefetchSeen.add(src);
    this.prefetchQueue.push(src);
    this.prefetchTotal += 1;
    this.updateDebugAttributes();
    this.pumpPrefetch();
  }

  startPrefetch() {
    for (const entry of this.entries.values()) this.enqueuePrefetch(entry.src);
    this.pumpPrefetch();
  }

  cancelPrefetch() {
    for (const src of this.prefetchQueue) this.prefetchSeen.delete(src);
    this.prefetchQueue = [];
  }

  pumpPrefetch() {
    if (this.disposed || this.mode !== 'preload') return;
    while (this.prefetchActive < 2 && this.prefetchQueue.length > 0) {
      const src = this.prefetchQueue.shift();
      if (!src) break;
      this.prefetchActive += 1;
      // Fetch bytes only: no image decode, so preloading does not raise GPU
      // memory. The renderer still decodes only cards inside the window.
      void fetch(src, { cache: 'force-cache' })
        .then((response) => response.arrayBuffer())
        .then(() => {
          this.prefetchDone += 1;
        })
        .catch(() => {
          this.prefetchSeen.delete(src);
        })
        .finally(() => {
          this.prefetchActive -= 1;
          this.updateDebugAttributes();
          this.pumpPrefetch();
        });
    }
  }

  dispose() {
    this.disposed = true;
    this.observer?.disconnect();
    this.observer = null;
    if (typeof window !== 'undefined') {
      window.removeEventListener('scroll', this.onScroll);
      if (this.scrollRaf) window.cancelAnimationFrame(this.scrollRaf);
    }
    this.cancelPrefetch();
    this.entries.clear();
    this.byIndex.clear();
    this.visible.clear();
  }
}

export function ThumbnailLoadingProvider({
  mode,
  previewMaxEdge = DEFAULT_PREVIEW_EDGE,
  children,
}: {
  mode: ImageLoadingMode;
  previewMaxEdge?: number;
  children: ReactNode;
}) {
  const [manager] = useState(() => new ThumbnailLoadManager(mode));

  useEffect(() => {
    manager.setMode(mode);
  }, [manager, mode]);

  useEffect(() => {
    manager.setPreviewMaxEdge(previewMaxEdge);
  }, [manager, previewMaxEdge]);

  useEffect(() => () => manager.dispose(), [manager]);

  const value = useMemo<LoaderContextValue>(() => ({ manager, mode }), [manager, mode]);

  return <LoaderContext.Provider value={value}>{children}</LoaderContext.Provider>;
}

/**
 * Gate a single card image. Returns a ref for the card media element and
 * whether its `src` should be attached right now. Without a provider (web
 * usage or non-timeline surfaces) images load normally.
 */
export function useThumbnailLoader(
  id: string,
  index: number,
  src: string | null | undefined,
): { ref: RefObject<HTMLDivElement | null>; allowed: boolean } {
  const context = useContext(LoaderContext);
  const [allowed, setAllowed] = useState(() => !context);
  const ref = useRef<HTMLDivElement>(null);
  const notify = useCallback((next: boolean) => setAllowed(next), []);

  useEffect(() => {
    const manager = context?.manager;
    const element = ref.current;
    if (!manager || !element || !src) {
      setAllowed(true);
      return undefined;
    }
    return manager.register(id, index, src, element, notify);
  }, [context?.manager, id, index, src, notify]);

  return { ref, allowed: context ? allowed : true };
}
