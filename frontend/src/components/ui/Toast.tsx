import { createContext, useCallback, useContext, useRef, useState } from 'react';
import type { ReactNode } from 'react';

type ToastVariant = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  message: string;
  variant: ToastVariant;
}

interface ToastContextValue {
  showToast: (message: string, variant?: ToastVariant) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(0);

  const showToast = useCallback((message: string, variant: ToastVariant = 'info') => {
    const id = ++nextId.current;
    setToasts(prev => [...prev, { id, message, variant }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4000);
  }, []);

  function dismiss(id: number) {
    setToasts(prev => prev.filter(t => t.id !== id));
  }

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {toasts.length > 0 ? (
        <div className="toast-container" aria-live="polite">
          {toasts.map(toast => (
            <div key={toast.id} className={`toast toast-${toast.variant}`}>
              <span>{toast.message}</span>
              <button
                type="button"
                className="toast-dismiss"
                aria-label="Fechar"
                onClick={() => dismiss(toast.id)}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast deve ser usado dentro de ToastProvider');
  return ctx.showToast;
}
