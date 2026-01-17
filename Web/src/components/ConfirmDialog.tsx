'use client';

import Modal from './Modal';
import { AlertTriangle, Loader2 } from 'lucide-react';

interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  isLoading?: boolean;
  variant?: 'danger' | 'warning' | 'info';
}

export default function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  isLoading = false,
  variant = 'danger',
}: ConfirmDialogProps) {
  const variantStyles = {
    danger: {
      iconBg: '#fee2e2',
      iconColor: '#dc2626',
      buttonClass: 'btn-danger',
    },
    warning: {
      iconBg: '#fef3c7',
      iconColor: '#d97706',
      buttonClass: 'btn-warning',
    },
    info: {
      iconBg: '#dbeafe',
      iconColor: '#2563eb',
      buttonClass: 'btn-primary',
    },
  };

  const style = variantStyles[variant];

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <button
            className="btn btn-secondary"
            onClick={onClose}
            disabled={isLoading}
          >
            {cancelText}
          </button>
          <button
            className={`btn ${style.buttonClass}`}
            onClick={onConfirm}
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <Loader2 size={16} className="spinner" />
                Processing...
              </>
            ) : (
              confirmText
            )}
          </button>
        </>
      }
    >
      <div style={{ display: 'flex', gap: '1rem' }}>
        <div
          style={{
            width: '3rem',
            height: '3rem',
            borderRadius: '50%',
            backgroundColor: style.iconBg,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <AlertTriangle size={24} color={style.iconColor} />
        </div>
        <div>
          <p style={{ color: 'var(--text-primary)', marginBottom: '0.5rem' }}>
            {message}
          </p>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
            This action cannot be undone.
          </p>
        </div>
      </div>
    </Modal>
  );
}
