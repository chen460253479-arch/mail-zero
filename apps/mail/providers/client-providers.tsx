import { useKeyboardLayout } from '@/components/keyboard-layout-indicator';
import { LoadingProvider } from '@/components/context/loading-context';
import { NuqsAdapter } from 'nuqs/adapters/react-router/v7';
import { SidebarProvider } from '@/components/ui/sidebar';
import { Provider as JotaiProvider } from 'jotai';
import type { PropsWithChildren } from 'react';
import Toaster from '@/components/ui/toast';
import { ThemeProvider } from 'next-themes';

export function ClientProviders({ children }: PropsWithChildren) {
  useKeyboardLayout();

  return (
    <NuqsAdapter>
      <JotaiProvider>
        <ThemeProvider
          attribute="class"
          enableSystem
          disableTransitionOnChange
          defaultTheme="system"
        >
          <SidebarProvider>
            <LoadingProvider>
              {children}
              <Toaster />
            </LoadingProvider>
          </SidebarProvider>
        </ThemeProvider>
      </JotaiProvider>
    </NuqsAdapter>
  );
}
