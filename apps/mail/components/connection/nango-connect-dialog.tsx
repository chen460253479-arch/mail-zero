import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Mail } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { refreshMailboxConnectionQueries } from '@/modules/mail-connections/refresh-mailbox-queries';
import type { ConnectableMailChannelId } from '@/modules/mail-connections/connect-mode';
import { useTRPC } from '@/providers/query-provider';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { m } from '@/paraglide/messages';

const channelLabel = (channelId: ConnectableMailChannelId) => {
  switch (channelId) {
    case 'gmail':
      return m['common.brands.gmail']();
    case 'outlook':
      return m['common.brands.outlook']();
    case 'zoho_mail':
      return m['common.brands.zohoMail']();
    case 'imap_smtp':
      return m['common.brands.imapSmtp']();
  }
};

export function NangoConnectDialog({
  channelId,
  open,
  onOpenChange,
  onConnected,
}: {
  channelId: ConnectableMailChannelId | null;
  open: boolean;
  onOpenChange(open: boolean): void;
  onConnected(): void;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const requiresExternalBinding = channelId === 'zoho_mail';
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
  const connections = useQuery({
    ...trpc.connections.listNangoConnections.queryOptions({
      channelId: channelId ?? 'gmail',
    }),
    enabled: open && channelId !== null && !requiresExternalBinding,
  });
  const bind = useMutation(trpc.connections.bindNango.mutationOptions());

  const save = async () => {
    if (!channelId || !selectedConnectionId) return;
    if (requiresExternalBinding) {
      toast.error(m['pages.settings.connections.nango.zohoExternalBindingRequired']());
      return;
    }
    try {
      await bind.mutateAsync({ channelId, connectionId: selectedConnectionId });
      await refreshMailboxConnectionQueries(queryClient, {
        connectionList: trpc.connections.list.queryKey(),
        defaultConnection: trpc.connections.getDefault.queryKey(),
        mailAccountList: trpc.mail.account.list.queryKey(),
      });
      toast.success(
        m['pages.settings.connections.nango.mailboxConnected']({
          channel: channelLabel(channelId),
        }),
      );
      setSelectedConnectionId(null);
      onOpenChange(false);
      onConnected();
    } catch (error) {
      const duplicate =
        error instanceof Error &&
        (error.message.includes('MAILBOX_ALREADY_CONNECTED') ||
          error.message.includes('NANGO_CONNECTION_ALREADY_BOUND'));
      toast.error(
        duplicate
          ? m['pages.settings.connections.mailboxAlreadyConnected']()
          : m['pages.settings.connections.nango.connectError'](),
      );
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) setSelectedConnectionId(null);
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent showOverlay>
        <DialogHeader>
          <DialogTitle>
            {m['pages.settings.connections.nango.title']({
              channel: channelId
                ? channelLabel(channelId)
                : m['pages.settings.connections.nango.mailbox'](),
            })}
          </DialogTitle>
          <DialogDescription>{m['pages.settings.connections.nango.description']()}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {requiresExternalBinding ? (
            <p className="text-muted-foreground py-8 text-center text-sm">
              {m['pages.settings.connections.nango.zohoExternalBindingRequired']()}
            </p>
          ) : connections.isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="text-muted-foreground size-5 animate-spin" />
            </div>
          ) : connections.data?.length ? (
            <div className="max-h-72 space-y-2 overflow-y-auto">
              {connections.data.map((connection) => {
                const invalid = connection.authorizationStatus !== 'valid';
                return (
                  <button
                    key={connection.connectionId}
                    type="button"
                    disabled={invalid}
                    onClick={() => setSelectedConnectionId(connection.connectionId)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-lg border p-3 text-left',
                      'transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                      selectedConnectionId === connection.connectionId
                        ? 'border-primary bg-primary/5'
                        : 'hover:bg-muted/50',
                    )}
                  >
                    <Mail className="size-5 shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {connection.email || connection.displayName}
                      </span>
                      {connection.displayName && connection.displayName !== connection.email ? (
                        <span className="text-muted-foreground block truncate text-xs">
                          {connection.displayName}
                        </span>
                      ) : null}
                    </span>
                    {invalid ? (
                      <Badge variant="destructive">
                        {m['pages.settings.connections.nango.needsAttention']()}
                      </Badge>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="text-muted-foreground py-8 text-center text-sm">
              {m['pages.settings.connections.nango.noAuthorizedMailboxes']()}
            </p>
          )}

          {!requiresExternalBinding ? <div className="flex justify-end">
            <Button onClick={save} disabled={!selectedConnectionId || bind.isPending}>
              {bind.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              {m['pages.settings.connections.nango.connectSelectedMailbox']()}
            </Button>
          </div> : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
