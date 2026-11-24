import { useEffect, useRef, useState } from 'react';

interface ObserverGroup {
  observer: IntersectionObserver;
  callbacks: Map<Element, () => void>;
}

// One IntersectionObserver per threshold shared by every timeline entry instead
// of thousands of observers when a library has thousands of photos.
const observerGroups = new Map<number, ObserverGroup>();

function groupFor(threshold: number): ObserverGroup | null {
  if (typeof IntersectionObserver === 'undefined') return null;
  const existing = observerGroups.get(threshold);
  if (existing) return existing;
  const callbacks = new Map<Element, () => void>();
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const callback = callbacks.get(entry.target);
        if (!callback) continue;
        callbacks.delete(entry.target);
        observer.unobserve(entry.target);
        callback();
      }
    },
    { threshold, rootMargin: '0px 0px -6% 0px' },
  );
  const group = { observer, callbacks };
  observerGroups.set(threshold, group);
  return group;
}

/** Reveal-on-scroll helper that respects reduced-motion preferences. */
export function useInView<T extends HTMLElement>(threshold = 0.12) {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setInView(true);
      return undefined;
    }
    const group = groupFor(threshold);
    if (!group) {
      setInView(true);
      return undefined;
    }
    group.callbacks.set(element, () => setInView(true));
    group.observer.observe(element);
    return () => {
      group.callbacks.delete(element);
      group.observer.unobserve(element);
    };
  }, [threshold]);

  return { ref, inView };
}
