import { useEffect, useState, type JSX } from 'react';
import { Modal } from './Modal';

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  requireText,
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  /** When set, the user must type this exact text to enable confirm. */
  requireText?: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}): JSX.Element {
  const [typed, setTyped] = useState('');

  useEffect(() => {
    if (open) setTyped('');
  }, [open]);

  const blocked = requireText !== undefined && typed !== requireText;

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      size="sm"
      footer={
        <>
          <button className="btn" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button
            className={`btn ${danger ? 'btn-solid-danger' : 'btn-primary'}`}
            onClick={onConfirm}
            disabled={busy || blocked}
          >
            {busy ? <span className="spinner" style={{ borderTopColor: 'currentColor' }} /> : null}
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="stack gap-2 muted" style={{ fontSize: 13.5, lineHeight: 1.55 }}>
        {message}
        {requireText !== undefined ? (
          <div className="stack gap-1" style={{ marginTop: 6 }}>
            <div className="field">
              <label>
                Type <strong className="mono">{requireText}</strong> to confirm
              </label>
              <input
                className="input"
                value={typed}
                autoFocus
                onChange={(e) => setTyped(e.target.value)}
                placeholder={requireText}
                spellCheck={false}
              />
            </div>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
