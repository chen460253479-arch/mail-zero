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
import { useTRPC } from '@/providers/query-provider';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

type GmailConnectDialogProps = {
  open: boolean;
  onOpenChange(open: boolean): void;
  onConnected(): void;
};

export function GmailConnectDialog({ open, onOpenChange, onConnected }: GmailConnectDialogProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
  const connections = useQuery(
    trpc.connections.listNangoGmailConnections.queryOptions(undefined, {
      enabled: open,
    }),
  );
  const bind = useMutation(trpc.connections.bindNango.mutationOptions());

  const save = async () => {
    if (!selectedConnectionId) return;
    try {
      await bind.mutateAsync({ connectionId: selectedConnectionId });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: trpc.connections.list.queryKey() }),
        queryClient.invalidateQueries({ queryKey: trpc.connections.getDefault.queryKey() }),
      ]);
      toast.success('Gmail mailbox connected');
      setSelectedConnectionId(null);
      onOpenChange(false);
      onConnected();
    } catch (error) {
      const duplicate =
        error instanceof Error && error.message.includes('MAILBOX_ALREADY_CONNECTED');
      toast.error(duplicate ? 'This mailbox is already connected' : 'Unable to connect mailbox');
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
          <DialogTitle>Connect Gmail</DialogTitle>
          <DialogDescription>Select an existing Gmail authorization.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {connections.isLoading ? (
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
                    {invalid ? <Badge variant="destructive">Needs attention</Badge> : null}
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="text-muted-foreground py-8 text-center text-sm">
              No authorized Gmail mailboxes are available.
            </p>
          )}

          <div className="flex justify-end">
            <Button onClick={save} disabled={!selectedConnectionId || bind.isPending}>
              {bind.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              Connect selected mailbox
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
