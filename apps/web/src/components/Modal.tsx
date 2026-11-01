import { useEffect, useRef, type JSX, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useEscape } from '../lib/hooks';
import { IconX } from './icons';

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
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
      <div className="modal-overlay" onClick={onClose} />
      <div
        ref={bodyRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`modal ${size === 'sm' ? 'modal-sm' : ''} ${size === 'lg' ? 'modal-lg' : ''}`}
      >
        <div className="modal-header">
          <div className="modal-title">{title}</div>
          <button className="modal-close" onClick={onClose} aria-label="Close dialog">
            <IconX size={15} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-footer">{footer}</div> : null}
      </div>
    </>,
    document.body,
  );
}
