import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import type { ToastMessage, ToastTone } from '../types';

const ICONS: Record<ToastTone, typeof Info> = {
  default: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: AlertTriangle,
};

interface ToastViewportProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

export function ToastViewport({ toasts, onDismiss }: ToastViewportProps) {
  return (
    <div className="toast-viewport" role="region" aria-label="操作通知">
      <div className="toast-stack" aria-live="polite" aria-atomic="false">
        {toasts.map((toast) => {
          const tone = toast.tone ?? 'default';
          const Icon = ICONS[tone];
          return (
            <div key={toast.id} className={`toast toast--${tone}`}>
              <span className="toast__icon" aria-hidden="true">
                <Icon size={18} strokeWidth={1.7} />
              </span>
              <div className="toast__body">
                <p className="toast__title">{toast.title}</p>
                {toast.description ? <p className="toast__desc">{toast.description}</p> : null}
              </div>
              <button
                type="button"
                className="toast__close"
                onClick={() => onDismiss(toast.id)}
                aria-label="关闭通知"
              >
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
