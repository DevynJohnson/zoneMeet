'use client';

import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import AlertModal, { AlertType } from '@/components/AlertModal';

interface AlertOptions {
  type: AlertType;
  title?: string;
  message: string;
  confirmText?: string;
  onConfirm?: () => void;
  cancelText?: string;
  showCancel?: boolean;
}

interface AlertContextType {
  showAlert: (options: AlertOptions) => void;
  showSuccess: (message: string, title?: string) => void;
  showError: (message: string, title?: string) => void;
  showWarning: (message: string, title?: string) => void;
  showInfo: (message: string, title?: string) => void;
  showConfirm: (message: string, onConfirm: () => void, title?: string) => void;
}

const AlertContext = createContext<AlertContextType | undefined>(undefined);

export function AlertProvider({ children }: { children: ReactNode }) {
  const [alertState, setAlertState] = useState<AlertOptions | null>(null);

  const showAlert = useCallback((options: AlertOptions) => {
    setAlertState(options);
  }, []);

  const showSuccess = useCallback((message: string, title?: string) => {
    setAlertState({
      type: 'success',
      message,
      title: title || 'Success',
    });
  }, []);

  const showError = useCallback((message: string, title?: string) => {
    setAlertState({
      type: 'error',
      message,
      title: title || 'Error',
    });
  }, []);

  const showWarning = useCallback((message: string, title?: string) => {
    setAlertState({
      type: 'warning',
      message,
      title: title || 'Warning',
    });
  }, []);

  const showInfo = useCallback((message: string, title?: string) => {
    setAlertState({
      type: 'info',
      message,
      title: title || 'Information',
    });
  }, []);

  const showConfirm = useCallback((message: string, onConfirm: () => void, title?: string) => {
    setAlertState({
      type: 'warning',
      message,
      title: title || 'Confirmation',
      confirmText: 'Confirm',
      cancelText: 'Cancel',
      showCancel: true,
      onConfirm,
    });
  }, []);

  const closeAlert = useCallback(() => {
    setAlertState(null);
  }, []);

  return (
    <AlertContext.Provider
      value={{
        showAlert,
        showSuccess,
        showError,
        showWarning,
        showInfo,
        showConfirm,
      }}
    >
      {children}
      {alertState && (
        <AlertModal
          isOpen={true}
          onClose={closeAlert}
          type={alertState.type}
          title={alertState.title}
          message={alertState.message}
          confirmText={alertState.confirmText}
          onConfirm={alertState.onConfirm}
          cancelText={alertState.cancelText}
          showCancel={alertState.showCancel}
        />
      )}
    </AlertContext.Provider>
  );
}

export function useAlert() {
  const context = useContext(AlertContext);
  if (!context) {
    throw new Error('useAlert must be used within an AlertProvider');
  }
  return context;
}
