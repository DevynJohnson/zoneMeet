'use client';

import { AlertProvider } from '@/contexts/AlertContext';

export function ClientProviders({ children }: { children: React.ReactNode }) {
  return <AlertProvider>{children}</AlertProvider>;
}
