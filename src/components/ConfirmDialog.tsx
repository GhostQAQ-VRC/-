import { AlertTriangle, Trash2 } from 'lucide-react';
import { Modal } from './Modal';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  tone?: 'danger' | 'default';
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = '确认删除',
  onConfirm,
  onCancel,
  tone = 'danger',
}: ConfirmDialogProps) {
  return (
    <Modal open={open} onClose={onCancel} labelledBy="confirm-dialog-title" className="confirm-modal">
      <div className="confirm-icon" aria-hidden="true">
        {tone === 'danger' ? <Trash2 size={22} strokeWidth={1.5} /> : <AlertTriangle size={22} />}
      </div>
      <h2 id="confirm-dialog-title">{title}</h2>
      <p>{description}</p>
      <div className="confirm-actions">
        <button
          type="button"
          className="button button--ghost"
          onClick={onCancel}
          data-autofocus
        >
          取消
        </button>
        <button
          type="button"
          className={`button ${tone === 'danger' ? 'button--danger' : 'button--primary'}`}
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
