import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../utils/cn';
import { useFocusTrap, useLockBodyScroll } from '../hooks/useDialog';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  labelledBy: string;
  children: ReactNode;
  className?: string;
  backdropClassName?: string;
}

export function Modal({
  open,
  onClose,
  labelledBy,
  children,
  className,
  backdropClassName,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  useLockBodyScroll(open);
  useFocusTrap(panelRef, open);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="modal-layer">
      <div
        className={cn('modal-backdrop', backdropClassName)}
        aria-hidden="true"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        className={cn('modal-panel', className)}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
