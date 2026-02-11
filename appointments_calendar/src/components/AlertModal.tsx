'use client';

import { useEffect } from 'react';
import { X, CheckCircle, AlertCircle, AlertTriangle, Info } from 'lucide-react';

export type AlertType = 'success' | 'error' | 'warning' | 'info';

interface AlertModalProps {
  isOpen: boolean;
  onClose: () => void;
  type: AlertType;
  title?: string;
  message: string;
  confirmText?: string;
  onConfirm?: () => void;
  cancelText?: string;
  showCancel?: boolean;
}

export default function AlertModal({
  isOpen,
  onClose,
  type,
  title,
  message,
  confirmText = 'OK',
  onConfirm,
  cancelText = 'Cancel',
  showCancel = false,
}: AlertModalProps) {
  // Close on escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleConfirm = () => {
    if (onConfirm) {
      onConfirm();
    }
    onClose();
  };

  const getIconAndColors = () => {
    switch (type) {
      case 'success':
        return {
          icon: <CheckCircle className="w-12 h-12" />,
          iconBg: 'bg-green-100',
          iconColor: 'text-green-600',
          buttonBg: 'bg-green-600 hover:bg-green-700',
        };
      case 'error':
        return {
          icon: <AlertCircle className="w-12 h-12" />,
          iconBg: 'bg-red-100',
          iconColor: 'text-red-600',
          buttonBg: 'bg-red-600 hover:bg-red-700',
        };
      case 'warning':
        return {
          icon: <AlertTriangle className="w-12 h-12" />,
          iconBg: 'bg-yellow-100',
          iconColor: 'text-yellow-600',
          buttonBg: 'bg-yellow-600 hover:bg-yellow-700',
        };
      case 'info':
        return {
          icon: <Info className="w-12 h-12" />,
          iconBg: 'bg-blue-100',
          iconColor: 'text-blue-600',
          buttonBg: 'bg-blue-600 hover:bg-blue-700',
        };
    }
  };

  const { icon, iconBg, iconColor, buttonBg } = getIconAndColors();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black bg-opacity-50 transition-opacity"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-white rounded-lg shadow-xl max-w-md w-full p-6 animate-in fade-in zoom-in duration-200">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors"
          aria-label="Close"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Content */}
        <div className="flex flex-col items-center text-center">
          {/* Icon */}
          <div className={`${iconBg} ${iconColor} rounded-full p-3 mb-4`}>
            {icon}
          </div>

          {/* Title */}
          {title && (
            <h3 className="text-xl font-bold text-gray-900 mb-2">{title}</h3>
          )}

          {/* Message */}
          <p className="text-gray-600 mb-6 whitespace-pre-line">{message}</p>

          {/* Buttons */}
          <div className="flex gap-3 w-full">
            {showCancel && (
              <button
                onClick={onClose}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 transition-colors font-medium"
              >
                {cancelText}
              </button>
            )}
            <button
              onClick={handleConfirm}
              className={`${showCancel ? 'flex-1' : 'w-full'} px-4 py-2 ${buttonBg} text-white rounded-md transition-colors font-medium`}
            >
              {confirmText}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
