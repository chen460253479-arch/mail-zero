import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2, Mail, Plug } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useTRPC } from '@/providers/query-provider';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { m } from '@/paraglide/messages';
import { cn } from '@/lib/utils';

type MailChannelId = 'gmail' | 'outlook' | 'zoho_mail' | 'imap_smtp';

type SelectedChannel = {
  channelId: MailChannelId;
  integrationId: string;
};

type NangoConnectDialogProps = {
  open: boolean;
  onOpenChange(open: boolean): void;
  onConnected(): void;
};

export function NangoConnectDialog({ open, onOpenChange, onConnected }: NangoConnectDialogProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [selectedChannel, setSelectedChannel] = useState<SelectedChannel | null>(null);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
  const channels = useQuery(
    trpc.connections.nangoChannels.queryOptions(undefined, { enabled: open }),
  );
  const connections = useQuery(
    trpc.connections.nangoConnections.queryOptions(
      selectedChannel
        ? {
            channelId: selectedChannel.channelId,
            integrationId: selectedChannel.integrationId,
          }
        : { channelId: 'gmail', integrationId: '' },
      { enabled: open && selectedChannel !== null },
    ),
  );
  const bind = useMutation(trpc.connections.bindNango.mutationOptions());

  useEffect(() => {
    if (!open) {
      setSelectedChannel(null);
      setSelectedConnectionId(null);
    }
  }, [open]);

  const save = async () => {
    if (!selectedChannel || !selectedConnectionId) return;
    try {
      await bind.mutateAsync({
        channelId: selectedChannel.channelId,
        integrationId: selectedChannel.integrationId,
        connectionId: selectedConnectionId,
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: trpc.connections.list.queryKey() }),
        queryClient.invalidateQueries({ queryKey: trpc.connections.getDefault.queryKey() }),
      ]);
      toast.success(m['pages.settings.connections.nangoConnectionSuccess']());
      onOpenChange(false);
      onConnected();
    } catch (error) {
      const duplicate =
        error instanceof Error && error.message.includes('MAILBOX_ALREADY_CONNECTED');
      toast.error(
        duplicate
          ? m['pages.settings.connections.mailboxAlreadyConnected']()
          : m['pages.settings.connections.nangoConnectionError'](),
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showOverlay>
        <DialogHeader>
          <DialogTitle>
            {selectedChannel
              ? m['pages.settings.connections.chooseAuthorizedMailbox']()
              : m['pages.settings.connections.chooseMailChannel']()}
          </DialogTitle>
          <DialogDescription>
            {m['pages.settings.connections.existingNangoAuthorization']()}
          </DialogDescription>
        </DialogHeader>

        {selectedChannel ? (
          <div className="space-y-4">
            <Button
              variant="ghost"
              size="sm"
              className="-ml-2"
              onClick={() => {
                setSelectedChannel(null);
                setSelectedConnectionId(null);
              }}
            >
              <ArrowLeft className="size-4" />
              {m['pages.settings.connections.back']()}
            </Button>

            {connections.isLoading ? (
              <div className="flex justify-center py-10">
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
                          {m['pages.settings.connections.nangoNeedsAttention']()}
                        </Badge>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="text-muted-foreground py-10 text-center text-sm">
                {m['pages.settings.connections.noAuthorizedMailboxes']()}
              </p>
            )}

            <div className="flex justify-end">
              <Button onClick={save} disabled={!selectedConnectionId || bind.isPending}>
                {bind.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                {m['common.actions.save']()}
              </Button>
            </div>
          </div>
        ) : channels.isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="text-muted-foreground size-5 animate-spin" />
          </div>
        ) : channels.data?.length ? (
          <div className="grid gap-3 pt-2 sm:grid-cols-2">
            {channels.data?.flatMap((channel) =>
              channel.integrations.map((integration) => (
                <Button
                  key={`${channel.channelId}:${integration.integrationId}`}
                  variant="outline"
                  className="h-auto min-h-20 justify-start gap-3 p-4"
                  onClick={() =>
                    setSelectedChannel({
                      channelId: channel.channelId,
                      integrationId: integration.integrationId,
                    })
                  }
                >
                  <Plug className="size-5 shrink-0" />
                  <span className="min-w-0 text-left">
                    <span className="block truncate text-sm font-medium">
                      {channel.displayName}
                    </span>
                    <span className="text-muted-foreground block truncate text-xs">
                      {integration.displayName}
                    </span>
                  </span>
                </Button>
              )),
            )}
          </div>
        ) : (
          <p className="text-muted-foreground py-10 text-center text-sm">
            {m['pages.settings.connections.noAuthorizedMailboxes']()}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
