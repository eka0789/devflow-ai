import { useEffect, useRef, type JSX, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useEscape } from '../lib/hooks';
import { IconX } from './icons';

export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}): JSX.Element | null {
  const bodyRef = useRef<HTMLDivElement>(null);

  useEscape(() => onClose(), open);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement;
    bodyRef.current?.focus();
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = overflow;
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <aside ref={bodyRef} role="dialog" aria-modal="true" tabIndex={-1} className="drawer">
        <div className="drawer-header">
          <div className="stack gap-1" style={{ minWidth: 0 }}>
            <div className="drawer-title">{title}</div>
            {subtitle ? <div className="text-sm muted truncate">{subtitle}</div> : null}
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close panel">
            <IconX size={15} />
          </button>
        </div>
        <div className="drawer-body">{children}</div>
        {footer ? <div className="drawer-footer">{footer}</div> : null}
      </aside>
    </>,
    document.body,
  );
}
