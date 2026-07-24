import {
  DeleteRetainedDataDialog,
  DisconnectDialog,
} from '@/components/connection/disconnect-dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { SettingsCard } from '@/components/settings/settings-card';
import { AddConnectionDialog } from '@/components/connection/add';

import { useConnections } from '@/hooks/use-connections';
import { Skeleton } from '@/components/ui/skeleton';
import { Trash, Plus, Unplug } from 'lucide-react';
import { useThreads } from '@/hooks/use-threads';
import { emailProviders } from '@/lib/constants';
import { Button } from '@/components/ui/button';
import { useSession } from '@/lib/auth-client';
import { Badge } from '@/components/ui/badge';
import { m } from '@/paraglide/messages';
import { useState } from 'react';

export default function ConnectionsPage() {
  const { data, isLoading, refetch: refetchConnections } = useConnections();
  const { refetch } = useSession();
  const [openTooltip, setOpenTooltip] = useState<string | null>(null);

  const [{ refetch: refetchThreads }] = useThreads({
    enabled: Boolean(data?.connections?.length),
  });
  const refreshConnectionData = () => {
    void refetchConnections();
    void refetch();
    void refetchThreads();
  };

  return (
    <div className="grid gap-6">
      <SettingsCard
        title={m['pages.settings.connections.title']()}
        description={m['pages.settings.connections.description']()}
      >
        <div className="space-y-6">
          {isLoading ? (
            <div className="grid gap-4 md:grid-cols-3">
              {[...Array(3)].map((n) => (
                <div
                  key={n}
                  className="bg-popover flex items-center justify-between rounded-lg border p-4"
                >
                  <div className="flex min-w-0 items-center gap-4">
                    <Skeleton className="h-12 w-12 rounded-lg" />
                    <div className="flex flex-col gap-1">
                      <Skeleton className="h-4 w-full lg:w-32" />
                      <Skeleton className="h-3 w-full lg:w-48" />
                    </div>
                  </div>
                  <Skeleton className="ml-4 h-8 w-8 rounded-full" />
                </div>
              ))}
            </div>
          ) : data?.connections?.length ? (
            <div className="lg: grid gap-4 sm:grid-cols-1 md:grid-cols-2">
              {data.connections.map((connection) => {
                const Icon = emailProviders.find(
                  (provider) => provider.channelId === connection.channelId,
                )?.icon;
                return (
                  <div
                    key={connection.id}
                    className="bg-popover flex items-center justify-between rounded-lg border p-4"
                  >
                    <div className="flex min-w-0 items-center gap-4">
                      {connection.picture ? (
                        <img
                          src={connection.picture}
                          alt=""
                          className="h-12 w-12 shrink-0 rounded-lg object-cover"
                          width={48}
                          height={48}
                        />
                      ) : (
                        <div className="bg-primary/10 flex h-12 w-12 shrink-0 items-center justify-center rounded-lg">
                          {Icon && <Icon className="size-6" />}
                        </div>
                      )}
                      <div className="flex min-w-0 flex-col gap-1">
                        <span className="truncate text-sm font-medium">{connection.name}</span>
                        <div className="text-muted-foreground flex items-center gap-2 text-xs">
                          <Tooltip
                            delayDuration={0}
                            open={openTooltip === connection.id}
                            onOpenChange={(open) => {
                              if (window.innerWidth <= 768) {
                                setOpenTooltip(open ? connection.id : null);
                              }
                            }}
                          >
                            <TooltipTrigger asChild>
                              <span
                                className="max-w-[180px] cursor-default truncate sm:max-w-[240px] md:max-w-[300px]"
                                onClick={() => {
                                  if (window.innerWidth <= 768) {
                                    setOpenTooltip(
                                      openTooltip === connection.id ? null : connection.id,
                                    );
                                  }
                                }}
                              >
                                {connection.email}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" align="start" className="select-all">
                              <div className="font-mono">{connection.email}</div>
                            </TooltipContent>
                          </Tooltip>
                          {connection.authSource === 'nango' ||
                          connection.authSource === 'zero_oauth' ? (
                            <Badge variant="outline">
                              {connection.authSource === 'nango'
                                ? 'Nango'
                                : m['pages.settings.connections.zeroOAuth']()}
                            </Badge>
                          ) : null}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      {connection.status === 'reconnect_required' ? (
                        <>
                          <Badge variant="destructive">
                            {m['pages.settings.connections.nangoNeedsAttention']()}
                          </Badge>
                          <DisconnectDialog
                            connectionId={connection.id}
                            onCompleted={refreshConnectionData}
                          >
                            <Button variant="destructive" size="sm">
                              <Trash className="size-4" />
                              {m['pages.settings.connections.remove']()}
                            </Button>
                          </DisconnectDialog>
                        </>
                      ) : data.disconnectedIds?.includes(connection.id) ? (
                        <>
                          <div>
                            <Badge variant="destructive">
                              {m['pages.settings.connections.disconnected']()}
                            </Badge>
                          </div>
                          <AddConnectionDialog onConnected={refreshConnectionData}>
                            <Button variant="secondary" size="sm">
                              <Unplug className="size-4" />
                              {m['pages.settings.connections.reconnect']()}
                            </Button>
                          </AddConnectionDialog>
                          <DeleteRetainedDataDialog
                            connectionId={connection.id}
                            onCompleted={refreshConnectionData}
                          >
                            <Button variant="destructive" size="sm">
                              <Trash className="size-4" />
                              {m['pages.settings.connections.deleteRetainedData']()}
                            </Button>
                          </DeleteRetainedDataDialog>
                        </>
                      ) : (
                        <DisconnectDialog
                          connectionId={connection.id}
                          onCompleted={refreshConnectionData}
                        >
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-muted-foreground hover:text-primary ml-4 shrink-0"
                          >
                            <Trash className="h-4 w-4" />
                          </Button>
                        </DisconnectDialog>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}

          <div className="flex items-center justify-start">
            <AddConnectionDialog onConnected={refreshConnectionData}>
              <Button
                variant="outline"
                className="group relative w-9 overflow-hidden duration-200 hover:w-full sm:hover:w-[32.5%]"
              >
                <Plus className="absolute left-2 h-4 w-4" />
                <span className="whitespace-nowrap pl-7 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                  {m['pages.settings.connections.addEmail']()}
                </span>
              </Button>
            </AddConnectionDialog>
          </div>
        </div>
      </SettingsCard>
    </div>
  );
}
