import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  ChevronDown,
  ChevronRight,
  CopyCheckIcon,
  LogOut,
  MoonIcon,
  Plus,
  RefreshCcw,
  Settings,
  Trash2,
} from 'lucide-react';
import { listConnectedConnections } from '@/modules/mail-connections/connected-connections';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useActiveConnection, useConnections } from '@/hooks/use-connections';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useDoState } from '@/components/mail/use-do-state';
import { useLoading } from '../context/loading-context';
import { signOut, useSession } from '@/lib/auth-client';
import { AddConnectionDialog } from '../connection/add';
import { CircleCheck, ThreeDots } from '../icons/icons';
import { useTRPC } from '@/providers/query-provider';
import { useSidebar } from '@/components/ui/sidebar';
import { SunIcon } from '../icons/animated/sun';
import { clear as idbClear } from 'idb-keyval';
import { useLocation } from 'react-router';
import { m } from '@/paraglide/messages';
import { useTheme } from 'next-themes';
import { useQueryState } from 'nuqs';
import { Button } from './button';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

const bytesToMB = (bytes: number) => (bytes / 1024 / 1024).toFixed(2);

interface SyncingStatusIndicatorProps {
  isSyncing: boolean;
  storageSize: number;
  syncingFolders: string[];
}

function SyncingStatusIndicator({
  isSyncing,
  storageSize,
  syncingFolders,
}: SyncingStatusIndicatorProps) {
  const statusContent = (
    <div className="flex items-center gap-2">
      <div className="flex h-4 w-4 items-center justify-center">
        <div
          className={cn(
            'h-2 w-2 rounded-full',
            isSyncing || storageSize === 0 ? 'animate-pulse bg-orange-500' : 'bg-green-500',
          )}
        />
      </div>
      <p className="text-[13px] opacity-60">
        {isSyncing || storageSize === 0
          ? m['common.navUser.syncingEmails']()
          : storageSize
            ? m['common.navUser.syncedWithStorage']({ storage: `${bytesToMB(storageSize)} MB` })
            : m['common.navUser.synced']()}
      </p>
    </div>
  );

  if (isSyncing && syncingFolders.length > 0) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuItem className="cursor-default">{statusContent}</DropdownMenuItem>
        </TooltipTrigger>
        <TooltipContent side="right" sideOffset={10} avoidCollisions={false}>
          <p className="text-xs">
            {m['common.navUser.syncingFolders']({ folders: syncingFolders.join(', ') })}
          </p>
        </TooltipContent>
      </Tooltip>
    );
  }

  return <DropdownMenuItem className="cursor-default">{statusContent}</DropdownMenuItem>;
}

export function NavUser() {
  const { data: session } = useSession();
  const { data } = useConnections();
  const [isRendered, setIsRendered] = useState(false);
  const { theme, resolvedTheme, setTheme } = useTheme();
  const { state } = useSidebar();
  const trpc = useTRPC();
  const [, setThreadId] = useQueryState('threadId');
  const { mutateAsync: setDefaultConnection } = useMutation(
    trpc.connections.setDefault.mutationOptions(),
  );
  const pathname = useLocation().pathname;
  const queryClient = useQueryClient();
  const {
    data: activeConnection,
    isPending: isActiveConnectionPending,
    refetch: refetchActiveConnection,
  } = useActiveConnection();
  const [category] = useQueryState('category', { defaultValue: 'All Mail' });
  const { setLoading } = useLoading();
  const [{ isSyncing, syncingFolders, storageSize, shards }] = useDoState();

  const getSettingsHref = useCallback(() => {
    const currentPath = category
      ? `${pathname}?category=${encodeURIComponent(category)}`
      : pathname;
    return `/settings/general?from=${encodeURIComponent(currentPath)}`;
  }, [pathname, category]);

  const handleClearCache = useCallback(async () => {
    queryClient.clear();
    await idbClear();
    toast.success(m['common.navUser.cacheCleared']());
  }, [queryClient]);

  const handleCopyConnectionId = useCallback(async () => {
    await navigator.clipboard.writeText(activeConnection?.id || '');
    toast.success(m['common.navUser.connectionIdCopied']());
  }, [activeConnection]);

  const activeAccount = activeConnection;

  useEffect(() => setIsRendered(true), []);

  const handleAccountSwitch = (connectionId: string) => async () => {
    if (connectionId === activeConnection?.id) return;

    try {
      setLoading(true, m['common.navUser.switchingAccounts']());
      setThreadId(null);
      await setDefaultConnection({ connectionId });
      queryClient.clear();
      await queryClient.refetchQueries({
        queryKey: trpc.mail.view.threadPage.infiniteQueryKey(),
      });
    } catch (error) {
      console.error('Error switching accounts:', error);
      toast.error(m['common.navUser.failedToSwitchAccount']());

      await refetchActiveConnection();
    } finally {
      setLoading(false);
    }
  };

  const handleRefreshMailbox = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: trpc.mail.view.threadPage.infiniteQueryKey(),
      }),
      queryClient.invalidateQueries({
        queryKey: trpc.mail.view.threadDetail.queryKey(),
      }),
      queryClient.invalidateQueries({
        queryKey: trpc.mail.mailbox.get.queryKey(),
      }),
    ]);
    toast.success(m['common.navUser.localMailboxRefreshed']());
  }, [queryClient, trpc.mail.mailbox.get, trpc.mail.view.threadDetail, trpc.mail.view.threadPage]);

  const handleLogout = async () => {
    toast.promise(signOut(), {
      loading: m['common.actions.signingOut'](),
      success: () => m['common.actions.signedOutSuccess'](),
      error: m['common.actions.signOutError'](),
      async finally() {
        // await handleClearCache();
        window.location.href = '/login';
      },
    });
  };

  const connectedConnections = useMemo(
    () => listConnectedConnections(data?.connections ?? []),
    [data?.connections],
  );
  const otherConnections = useMemo(() => {
    if (!activeAccount) return [];
    return connectedConnections.filter((connection) => connection.id !== activeAccount.id);
  }, [activeAccount, connectedConnections]);
  const orderedConnections = useMemo(
    () => (activeAccount ? [activeAccount, ...otherConnections] : connectedConnections),
    [activeAccount, connectedConnections, otherConnections],
  );
  const visibleConnections = orderedConnections.slice(0, 3);
  const overflowConnections = orderedConnections.slice(3);

  const handleThemeToggle = () => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  };

  if (!isRendered) return null;
  if (!session) return null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        {state === 'collapsed' ? (
          activeAccount && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <div className="flex cursor-pointer items-center">
                  <div className="relative">
                    <Avatar className="relative left-0.5 size-7 rounded-[5px]">
                      <AvatarImage
                        className="rounded-[5px]"
                        src={activeAccount?.picture || undefined}
                        alt={activeAccount?.name || activeAccount?.email}
                      />

                      <AvatarFallback className="rounded-[5px] text-[10px]">
                        {(activeAccount?.name || activeAccount?.email || '')
                          .split(' ')
                          .map((n: string) => n[0])
                          .join('')
                          .toUpperCase()
                          .slice(0, 2)}
                      </AvatarFallback>
                    </Avatar>
                  </div>
                </div>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                className="w-(--radix-dropdown-menu-trigger-width) ml-3 min-w-56 bg-white font-medium dark:bg-[#131313]"
                align="end"
                side={'bottom'}
                sideOffset={8}
              >
                {session && activeAccount && (
                  <>
                    <div className="flex flex-col items-center p-3 text-center">
                      <Avatar className="border-border/50 mb-2 size-14 rounded-xl border">
                        <AvatarImage
                          className="rounded-xl"
                          src={activeAccount.picture ?? undefined}
                          alt={activeAccount.name || activeAccount.email}
                        />
                        <AvatarFallback className="rounded-xl">
                          <span>
                            {(activeAccount.name || activeAccount.email)
                              .split(' ')
                              .map((n) => n[0])
                              .join('')
                              .toUpperCase()
                              .slice(0, 2)}
                          </span>
                        </AvatarFallback>
                      </Avatar>
                      <div className="w-full">
                        <div className="flex items-center justify-center gap-0.5 text-sm font-medium">
                          {activeAccount.name || activeAccount.email}
                        </div>
                        <div className="text-muted-foreground text-xs">{activeAccount.email}</div>
                      </div>
                    </div>
                    <DropdownMenuSeparator />
                  </>
                )}
                <div className="space-y-1">
                  <>
                    <p className="text-muted-foreground px-2 py-1 text-[11px] font-medium">
                      {m['common.navUser.accounts']()}
                    </p>

                    {connectedConnections
                      .filter((connection) => connection.id !== activeConnection?.id)
                      .map((connection) => (
                        <DropdownMenuItem
                          key={connection.id}
                          onClick={handleAccountSwitch(connection.id)}
                          className="flex cursor-pointer items-center gap-3 py-1"
                        >
                          <Avatar className="size-7 rounded-lg">
                            <AvatarImage
                              className="rounded-lg"
                              src={connection.picture || undefined}
                              alt={connection.name || connection.email}
                            />
                            <AvatarFallback className="rounded-lg text-[10px]">
                              {(connection.name || connection.email)
                                .split(' ')
                                .map((n) => n[0])
                                .join('')
                                .toUpperCase()
                                .slice(0, 2)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="-space-y-0.5">
                            <p className="text-[12px]">{connection.name || connection.email}</p>
                            {connection.name && (
                              <p className="text-muted-foreground text-[11px]">
                                {connection.email.length > 25
                                  ? `${connection.email.slice(0, 25)}...`
                                  : connection.email}
                              </p>
                            )}
                          </div>
                        </DropdownMenuItem>
                      ))}
                    <AddConnectionDialog />

                    <DropdownMenuSeparator className="my-1" />

                    <DropdownMenuItem asChild>
                      <a href={getSettingsHref()} className="cursor-pointer">
                        <div className="flex items-center gap-2">
                          <Settings size={16} className="opacity-60" />
                          <p className="text-[13px] opacity-60">{m['common.actions.settings']()}</p>
                        </div>
                      </a>
                    </DropdownMenuItem>
                  </>
                </div>
                <>
                  <DropdownMenuSeparator className="mt-1" />
                  <p className="text-muted-foreground px-2 py-1 text-[11px] font-medium">
                    {m['common.navUser.debug']()}
                  </p>
                  <DropdownMenuItem onClick={handleCopyConnectionId}>
                    <div className="flex items-center gap-2">
                      <CopyCheckIcon size={16} className="opacity-60" />
                      <p className="text-[13px] opacity-60">
                        {m['common.navUser.copyConnectionId']()}
                      </p>
                    </div>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleClearCache}>
                    <div className="flex items-center gap-2">
                      <Trash2 size={16} className="opacity-60" />
                      <p className="text-[13px] opacity-60">
                        {m['common.navUser.clearLocalCache']()}
                      </p>
                    </div>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => void handleRefreshMailbox()}>
                    <div className="flex items-center gap-2">
                      <RefreshCcw size={16} className="opacity-60" />
                      <p className="text-[13px] opacity-60">
                        {m['common.navUser.refreshLocalMailbox']()}
                      </p>
                    </div>
                  </DropdownMenuItem>
                  <SyncingStatusIndicator
                    isSyncing={isSyncing}
                    storageSize={storageSize}
                    syncingFolders={syncingFolders}
                  />
                  <DropdownMenuItem>
                    <div className="flex items-center gap-2">
                      <p className="text-[13px] opacity-60">
                        {m['common.navUser.shards']({ count: shards })}
                      </p>
                    </div>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator className="mt-1" />
                  <DropdownMenuItem onSelect={() => handleThemeToggle()} className="cursor-pointer">
                    <div className="flex w-full items-center gap-2">
                      {resolvedTheme === 'dark' ? (
                        <MoonIcon className="size-4 opacity-60" />
                      ) : (
                        <SunIcon className="size-4 opacity-60" />
                      )}
                      <p className="text-[13px] opacity-60">{m['common.navUser.appTheme']()}</p>
                    </div>
                  </DropdownMenuItem>
                  <DropdownMenuItem className="cursor-pointer" onSelect={() => handleLogout()}>
                    <div className="flex items-center gap-2">
                      <LogOut size={16} className="opacity-60" />
                      <p className="text-[13px] opacity-60">{m['common.actions.logout']()}</p>
                    </div>
                  </DropdownMenuItem>
                </>
              </DropdownMenuContent>
            </DropdownMenu>
          )
        ) : (
          <div className="relative w-full">
            <div className="border-border/70 bg-background/60 min-w-0 rounded-xl border p-1.5 shadow-sm">
              <div className="mb-1 flex h-7 items-center justify-between px-1">
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="text-muted-foreground truncate text-[11px] font-medium">
                    {m['common.navUser.accounts']()}
                  </span>
                  {orderedConnections.length > 0 && (
                    <span className="bg-muted text-muted-foreground flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] tabular-nums">
                      {orderedConnections.length}
                    </span>
                  )}
                </div>
                <AddConnectionDialog>
                  <Button
                    type="button"
                    variant="ghost"
                    aria-label={m['pages.settings.connections.addEmail']()}
                    title={m['pages.settings.connections.addEmail']()}
                    className="text-muted-foreground hover:text-foreground mr-7 size-7 rounded-md p-0"
                  >
                    <Plus className="size-4" />
                  </Button>
                </AddConnectionDialog>
              </div>

              {activeAccount ? (
                <div className="space-y-1">
                  {visibleConnections.map((connection) => {
                    const isActive = connection.id === activeConnection?.id;

                    return (
                      <button
                        type="button"
                        key={connection.id}
                        aria-current={isActive ? 'true' : undefined}
                        onClick={handleAccountSwitch(connection.id)}
                        className={cn(
                          'group flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#006FFE]/40',
                          isActive
                            ? 'bg-blue-50/90 text-blue-950 ring-1 ring-inset ring-blue-200/80 dark:bg-blue-500/10 dark:text-blue-50 dark:ring-blue-400/20'
                            : 'hover:bg-muted/70 cursor-pointer',
                        )}
                      >
                        <Avatar className="size-8 shrink-0 rounded-lg">
                          <AvatarImage
                            className="rounded-lg"
                            src={connection.picture || undefined}
                            alt={connection.name || connection.email}
                          />
                          <AvatarFallback className="rounded-lg text-[10px] font-medium">
                            {(connection.name || connection.email)
                              .split(' ')
                              .map((namePart) => namePart[0])
                              .join('')
                              .toUpperCase()
                              .slice(0, 2)}
                          </AvatarFallback>
                        </Avatar>
                        <span className="min-w-0 flex-1">
                          <span className="flex min-w-0 items-center gap-1.5">
                            <span className="min-w-0 truncate text-[12px] font-medium leading-4">
                              {connection.name || connection.email.split('@')[0]}
                            </span>
                            {isActive && (
                              <span className="flex shrink-0 items-center gap-0.5 text-[10px] font-medium text-[#006FFE]">
                                <CircleCheck className="size-3.5 fill-[#006FFE]" />
                                {m['common.navUser.currentAccount']()}
                              </span>
                            )}
                          </span>
                          <span
                            className={cn(
                              'block truncate text-[11px] leading-4',
                              isActive
                                ? 'text-blue-700 dark:text-blue-300'
                                : 'text-muted-foreground',
                            )}
                          >
                            {connection.email}
                          </span>
                        </span>
                        {!isActive && (
                          <ChevronRight className="text-muted-foreground/60 size-3.5 shrink-0 transition-transform group-hover:translate-x-0.5" />
                        )}
                      </button>
                    );
                  })}

                  {overflowConnections.length > 0 && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          className="text-muted-foreground hover:bg-muted/70 hover:text-foreground flex h-8 w-full items-center justify-between rounded-lg px-2 text-[11px] transition-colors"
                        >
                          <span>
                            {m['common.navUser.moreAccounts']({
                              count: overflowConnections.length,
                            })}
                          </span>
                          <ChevronDown className="size-3.5" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        className="ml-3 min-w-64 bg-white font-medium dark:bg-[#131313]"
                        align="start"
                        side="bottom"
                        sideOffset={6}
                      >
                        {overflowConnections.map((connection) => (
                          <DropdownMenuItem
                            key={connection.id}
                            onClick={handleAccountSwitch(connection.id)}
                            className="flex cursor-pointer items-center gap-3 py-2"
                          >
                            <Avatar className="size-8 rounded-lg">
                              <AvatarImage
                                className="rounded-lg"
                                src={connection.picture || undefined}
                                alt={connection.name || connection.email}
                              />
                              <AvatarFallback className="rounded-lg text-[10px]">
                                {(connection.name || connection.email)
                                  .split(' ')
                                  .map((namePart) => namePart[0])
                                  .join('')
                                  .toUpperCase()
                                  .slice(0, 2)}
                              </AvatarFallback>
                            </Avatar>
                            <div className="min-w-0">
                              <p className="truncate text-[12px] font-medium">
                                {connection.name || connection.email.split('@')[0]}
                              </p>
                              <p className="text-muted-foreground truncate text-[11px]">
                                {connection.email}
                              </p>
                            </div>
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              ) : isActiveConnectionPending ? (
                <div className="space-y-1 px-1 pb-1">
                  <div className="bg-muted h-12 animate-pulse rounded-lg" />
                  <div className="bg-muted/70 h-12 animate-pulse rounded-lg" />
                </div>
              ) : null}
            </div>

            <div className="absolute right-1.5 top-1.5 flex items-center justify-center gap-1">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className={cn('md:h-fit md:px-2')}>
                    <ThreeDots className="fill-iconLight dark:fill-iconDark" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  className="ml-3 min-w-56 bg-white font-medium dark:bg-[#131313]"
                  align="end"
                  side={'bottom'}
                  sideOffset={8}
                >
                  <p className="text-muted-foreground px-2 py-1 text-[11px] font-medium">
                    {m['common.navUser.debug']()}
                  </p>
                  <DropdownMenuItem onClick={handleCopyConnectionId}>
                    <div className="flex items-center gap-2">
                      <CopyCheckIcon size={16} className="opacity-60" />
                      <p className="text-[13px] opacity-60">
                        {m['common.navUser.copyConnectionId']()}
                      </p>
                    </div>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleClearCache}>
                    <div className="flex items-center gap-2">
                      <Trash2 size={16} className="opacity-60" />
                      <p className="text-[13px] opacity-60">
                        {m['common.navUser.clearLocalCache']()}
                      </p>
                    </div>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => void handleRefreshMailbox()}>
                    <div className="flex items-center gap-2">
                      <RefreshCcw size={16} className="opacity-60" />
                      <p className="text-[13px] opacity-60">
                        {m['common.navUser.refreshLocalMailbox']()}
                      </p>
                    </div>
                  </DropdownMenuItem>
                  <SyncingStatusIndicator
                    isSyncing={isSyncing}
                    storageSize={storageSize}
                    syncingFolders={syncingFolders}
                  />
                  <DropdownMenuItem>
                    <div className="flex items-center gap-2">
                      <p className="text-[13px] opacity-60">
                        {m['common.navUser.shards']({ count: shards })}
                      </p>
                    </div>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator className="mt-1" />
                  <DropdownMenuItem onClick={handleThemeToggle} className="cursor-pointer">
                    <div className="flex w-full items-center gap-2">
                      {theme === 'dark' ? (
                        <MoonIcon className="size-4 opacity-60" />
                      ) : (
                        <SunIcon className="size-4 opacity-60" />
                      )}
                      <p className="text-[13px] opacity-60">{m['common.navUser.appTheme']()}</p>
                    </div>
                  </DropdownMenuItem>
                  <DropdownMenuItem className="cursor-pointer" onClick={handleLogout}>
                    <div className="flex items-center gap-2">
                      <LogOut size={16} className="opacity-60" />
                      <p className="text-[13px] opacity-60">{m['common.actions.logout']()}</p>
                    </div>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
