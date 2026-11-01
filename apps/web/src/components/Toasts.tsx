import type { JSX } from 'react';
import { createPortal } from 'react-dom';
import { useToast, type ToastKind } from '../lib/hooks';
import { IconAlert, IconCheck, IconInfo, IconX } from './icons';

const ICONS: Record<ToastKind, JSX.Element> = {
  success: <IconCheck size={14} />,
  error: <IconAlert size={14} />,
  warning: <IconAlert size={14} />,
  info: <IconInfo size={14} />,
};

/** Floating toast stack, rendered once at the app root. */
export function ToastViewport(): JSX.Element {
  const { toasts, dismiss } = useToast();
  if (toasts.length === 0) return <div />;
  return createPortal(
    <div className="toast-stack" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast-${toast.kind}`}>
          <span className={`toast-icon ${toast.kind}`}>{ICONS[toast.kind]}</span>
          <div className="flex-1">{toast.message}</div>
          <button className="toast-close" onClick={() => dismiss(toast.id)} aria-label="Dismiss notification">
            <IconX size={13} />
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
}
