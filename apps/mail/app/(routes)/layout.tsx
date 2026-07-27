import { HotkeyProviderWrapper } from '@/components/providers/hotkey-provider-wrapper';
import { MailAccountBootstrapProvider } from '@/modules/mail/queries/use-mail-account';
import { CommandPaletteProvider } from '@/components/context/command-palette-context';

import { Outlet } from 'react-router';

export default function Layout() {
  return (
    <MailAccountBootstrapProvider>
      <CommandPaletteProvider>
        <HotkeyProviderWrapper>
          <div className="relative flex max-h-screen w-full overflow-hidden">
            <Outlet />
          </div>
        </HotkeyProviderWrapper>
      </CommandPaletteProvider>
    </MailAccountBootstrapProvider>
  );
}
