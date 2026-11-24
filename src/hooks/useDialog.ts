import { useEffect, type RefObject } from 'react';

let lockCount = 0;
let previousOverflow = '';
let previousPaddingRight = '';

function lockScroll() {
  if (lockCount === 0) {
    previousOverflow = document.body.style.overflow;
    previousPaddingRight = document.body.style.paddingRight;
    const scrollbar = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = 'hidden';
    if (scrollbar > 0) document.body.style.paddingRight = `${scrollbar}px`;
  }
  lockCount += 1;
}

function unlockScroll() {
  lockCount = Math.max(0, lockCount - 1);
  if (lockCount === 0) {
    document.body.style.overflow = previousOverflow;
    document.body.style.paddingRight = previousPaddingRight;
  }
}

/** Prevents background scrolling while any dialog is open. */
export function useLockBodyScroll(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    lockScroll();
    return unlockScroll;
  }, [active]);
}

const FOCUSABLE =
  'a[href], area[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), iframe, object, embed, [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

/**
 * Keeps keyboard focus inside a dialog and restores focus to the opener when
 * the dialog closes.
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, active: boolean): void {
  useEffect(() => {
    if (!active)
      return undefined;
    const root = ref.current;
    if (!root) return undefined;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const focusFirst = () => {
      const target =
        root.querySelector<HTMLElement>('[data-autofocus]') ??
        root.querySelector<HTMLElement>(FOCUSABLE) ??
        root;
      target.focus({ preventScroll: true });
    };
    const frame = window.requestAnimationFrame(focusFirst);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const items = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('keydown', onKeyDown);
      if (previous && previous.isConnected) previous.focus({ preventScroll: true });
    };
  }, [active, ref]);
}
