import type { ReactNode } from 'react';
import { useState } from 'react';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { m } from '@/paraglide/messages';
import { useTRPC } from '@/providers/query-provider';
import { refreshMailboxConnectionQueries } from '@/modules/mail-connections/refresh-mailbox-queries';

type DialogProps = {
  connectionId: string;
  children: ReactNode;
  disabled?: boolean;
  onCompleted(): void;
};

export function DisconnectDialog({
  connectionId,
  children,
  disabled,
  onCompleted,
}: DialogProps) {
  const [open, setOpen] = useState(false);
  const [deleteLocalData, setDeleteLocalData] = useState(false);
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const disconnect = useMutation(trpc.connections.disconnect.mutationOptions());

  const submit = async () => {
    try {
      await disconnect.mutateAsync({ connectionId, deleteLocalData });
      await refreshMailboxConnectionQueries(
        queryClient,
        {
          connectionList: trpc.connections.list.queryKey(),
          defaultConnection: trpc.connections.getDefault.queryKey(),
          mailAccountList: trpc.mail.account.list.queryKey(),
        },
        { clearDefaultConnection: true },
      );
      toast.success(m['pages.settings.connections.disconnectSuccess']());
      setOpen(false);
      setDeleteLocalData(false);
      onCompleted();
    } catch (error) {
      console.error('Error disconnecting mailbox:', error);
      toast.error(m['pages.settings.connections.disconnectError']());
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild disabled={disabled}>
        {children}
      </DialogTrigger>
      <DialogContent showOverlay>
        <DialogHeader>
          <DialogTitle>{m['pages.settings.connections.disconnectTitle']()}</DialogTitle>
          <DialogDescription>
            {m['pages.settings.connections.disconnectDescription']()}
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-start gap-3 py-2">
          <Checkbox
            id={`delete-local-data-${connectionId}`}
            checked={deleteLocalData}
            onCheckedChange={(checked) => setDeleteLocalData(checked === true)}
          />
          <Label htmlFor={`delete-local-data-${connectionId}`} className="leading-5">
            {m['pages.settings.connections.deleteLocalDataOption']()}
          </Label>
        </div>
        <div className="flex justify-end gap-4">
          <DialogClose asChild>
            <Button variant="outline">{m['pages.settings.connections.cancel']()}</Button>
          </DialogClose>
          <Button onClick={submit} disabled={disconnect.isPending}>
            {deleteLocalData
              ? m['pages.settings.connections.disconnectDeleteData']()
              : m['pages.settings.connections.disconnectKeepData']()}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteRetainedDataDialog({
  connectionId,
  children,
  onCompleted,
}: DialogProps) {
  const [open, setOpen] = useState(false);
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const remove = useMutation(trpc.connections.deleteRetainedData.mutationOptions());

  const submit = async () => {
    try {
      await remove.mutateAsync({ connectionId });
      await refreshMailboxConnectionQueries(
        queryClient,
        {
          connectionList: trpc.connections.list.queryKey(),
          defaultConnection: trpc.connections.getDefault.queryKey(),
          mailAccountList: trpc.mail.account.list.queryKey(),
        },
        { clearDefaultConnection: true },
      );
      toast.success(m['pages.settings.connections.localDataDeleted']());
      setOpen(false);
      onCompleted();
    } catch (error) {
      console.error('Error deleting retained mailbox data:', error);
      toast.error(m['pages.settings.connections.localDataDeleteError']());
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent showOverlay>
        <DialogHeader>
          <DialogTitle>{m['pages.settings.connections.deleteRetainedDataTitle']()}</DialogTitle>
          <DialogDescription>
            {m['pages.settings.connections.deleteRetainedDataDescription']()}
          </DialogDescription>
        </DialogHeader>
        <div className="flex justify-end gap-4">
          <DialogClose asChild>
            <Button variant="outline">{m['pages.settings.connections.cancel']()}</Button>
          </DialogClose>
          <Button variant="destructive" onClick={submit} disabled={remove.isPending}>
            {m['pages.settings.connections.deleteRetainedData']()}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
