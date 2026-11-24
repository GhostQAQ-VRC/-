import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { ToastMessage } from '../types';
import { ToastViewport } from '../components/ToastViewport';

interface ToastApi {
  pushToast: (toast: Omit<ToastMessage, 'id'>) => void;
  dismissToast: (id: string) => void;
}

const noop = () => {};

const ToastContext = createContext<ToastApi>({ pushToast: noop, dismissToast: noop });

let fallbackId = 0;

function createToastId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  fallbackId += 1;
  return `toast-${Date.now()}-${fallbackId}`;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const timers = useRef(new Map<string, number>());

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      window.clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const pushToast = useCallback(
    (toast: Omit<ToastMessage, 'id'>) => {
      const id = createToastId();
      setToasts((prev) => [...prev.slice(-3), { ...toast, id }]);
      const timer = window.setTimeout(() => dismissToast(id), 4600);
      timers.current.set(id, timer);
    },
    [dismissToast],
  );

  useEffect(() => {
    const storedTimers = timers.current;
    return () => {
      storedTimers.forEach((timer) => window.clearTimeout(timer));
      storedTimers.clear();
    };
  }, []);

  return (
    <ToastContext.Provider value={{ pushToast, dismissToast }}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismissToast} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  return useContext(ToastContext);
}
