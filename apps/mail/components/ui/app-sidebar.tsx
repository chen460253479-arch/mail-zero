import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader } from '@/components/ui/sidebar';
import { useAppAccess } from '@/modules/external-access/access-context';
import { navigationConfig, bottomNavItems } from '@/config/navigation';
import { ExternalAccountSwitcher } from './external-account-switcher';
import { useActiveConnection } from '@/hooks/use-connections';
import { isAdministrator } from '@/lib/administrator';
import { useSidebar } from '@/components/ui/sidebar';
import { CreateEmail } from '../create/create-email';
import { useIsMobile } from '@/hooks/use-mobile';
import { useSession } from '@/lib/auth-client';
import { PencilCompose } from '../icons/icons';
import { useStats } from '@/hooks/use-stats';
import { useLocation } from 'react-router';
import { cn, FOLDERS } from '@/lib/utils';
import { m } from '@/paraglide/messages';
import React, { useMemo } from 'react';
import { NavUser } from './nav-user';
import { NavMain } from './nav-main';
import { useQueryState } from 'nuqs';

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { data: stats } = useStats();
  const location = useLocation();
  const { data: session } = useSession();
  const { data: activeConnection } = useActiveConnection();
  const access = useAppAccess();
  const { currentSection, navItems } = useMemo(() => {
    // Find which section we're in based on the pathname
    const section = Object.entries(navigationConfig).find(([, config]) =>
      location.pathname.startsWith(config.path),
    );

    const currentSection = section?.[0] || 'mail';
    if (navigationConfig[currentSection]) {
      const items = navigationConfig[currentSection].sections.map((section) => ({
        ...section,
        items: section.items.filter((item) => !item.adminOnly || isAdministrator(session)),
      }));

      if (currentSection === 'mail' && stats && stats.length) {
        if (items[0]?.items[0]) {
          items[0].items[0].badge =
            stats.find((stat) => stat.label?.toLowerCase() === FOLDERS.INBOX)?.count ?? 0;
        }
        if (items[0]?.items[3]) {
          items[0].items[3].badge =
            stats.find((stat) => stat.label?.toLowerCase() === FOLDERS.SENT)?.count ?? 0;
        }
      }

      return { currentSection, navItems: items };
    } else {
      return {
        currentSection: '',
        navItems: [],
      };
    }
  }, [location.pathname, session, stats]);

  const showComposeButton = currentSection === 'mail';
  const { state } = useSidebar();

  return (
    <div>
      <Sidebar
        collapsible="icon"
        {...props}
        className={`bg-sidebar dark:bg-sidebar flex h-screen select-none flex-col items-center ${state === 'collapsed' ? '' : ''} pb-2`}
      >
        <SidebarHeader
          className={`relative top-2.5 flex flex-col gap-2 ${state === 'collapsed' ? 'px-2' : 'md:px-4'}`}
        >
          {access.mode === 'external' ? <ExternalAccountSwitcher /> : session && <NavUser />}

          {showComposeButton && (
            <div className="flex gap-1">
              <div className={cn('w-full')}>
                <ComposeButton disabled={!activeConnection} />
              </div>
            </div>
          )}
        </SidebarHeader>
        <SidebarContent
          className={`scrollbar scrollbar-w-1 scrollbar-thumb-accent/40 scrollbar-track-transparent hover:scrollbar-thumb-accent scrollbar-thumb-rounded-full overflow-x-hidden py-0 pt-0 ${state !== 'collapsed' ? 'mt-5 md:px-4' : 'px-2'}`}
        >
          <div className="flex-1 py-0">
            <NavMain items={navItems} />
          </div>
        </SidebarContent>

        {access.mode !== 'external' && (
          <SidebarFooter className={`px-0 pb-0 ${state === 'collapsed' ? 'md:px-2' : 'md:px-4'}`}>
            <NavMain items={bottomNavItems} />
          </SidebarFooter>
        )}
      </Sidebar>
    </div>
  );
}

function ComposeButton({ disabled = false }: { disabled?: boolean }) {
  const { state } = useSidebar();
  const isMobile = useIsMobile();

  const [dialogOpen, setDialogOpen] = useQueryState('isComposeOpen');
  const [, setDraftId] = useQueryState('draftId');
  const [, setTo] = useQueryState('to');
  const [, setActiveReplyId] = useQueryState('activeReplyId');
  const [, setMode] = useQueryState('mode');

  const handleOpenChange = async (open: boolean) => {
    if (!open) {
      setDialogOpen(null);
    } else {
      setDialogOpen('true');
    }
    setDraftId(null);
    setTo(null);
    setActiveReplyId(null);
    setMode(null);
  };
  return (
    <Dialog open={!!dialogOpen && !disabled} onOpenChange={handleOpenChange}>
      <DialogTitle></DialogTitle>
      <DialogDescription></DialogDescription>

      <DialogTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          title={disabled ? 'Connect a mail provider before composing' : undefined}
          className="relative mb-1.5 inline-flex h-8 w-full cursor-pointer items-center justify-center gap-1 self-stretch overflow-hidden rounded-lg border border-gray-200 bg-[#006FFE] text-black transition-colors hover:bg-[#0056CC] disabled:cursor-not-allowed disabled:opacity-45 dark:border-none dark:text-white dark:hover:bg-[#0056CC]"
        >
          {state === 'collapsed' && !isMobile ? (
            <PencilCompose className="mt-0.5 fill-white text-black" />
          ) : (
            <div className="flex items-center justify-center gap-2.5 pl-0.5 pr-1">
              <PencilCompose className="fill-white" />
              <div className="justify-start text-sm leading-none text-white">
                {m['common.commandPalette.commands.newEmail']()}
              </div>
            </div>
          )}
        </button>
      </DialogTrigger>

      <DialogContent className="h-screen w-screen max-w-none border-none bg-[#FAFAFA] p-0 shadow-none dark:bg-[#141414]">
        <CreateEmail />
      </DialogContent>
    </Dialog>
  );
}
