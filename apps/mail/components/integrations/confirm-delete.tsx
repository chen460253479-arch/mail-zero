import { useState, type ReactNode } from 'react';

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { m } from '@/paraglide/messages';

export function ConfirmIntegrationDelete({
  children,
  title,
  description,
  disabled,
  pending,
  onConfirm,
}: {
  children: ReactNode;
  title: string;
  description: string;
  disabled?: boolean;
  pending: boolean;
  onConfirm(): Promise<void>;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild disabled={disabled}>
        {children}
      </DialogTrigger>
      <DialogContent showOverlay>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="flex justify-end gap-3 pt-4">
          <DialogClose asChild>
            <Button variant="outline">{m['common.actions.cancel']()}</Button>
          </DialogClose>
          <Button
            variant="destructive"
            disabled={pending}
            onClick={async () => {
              await onConfirm();
              setOpen(false);
            }}
          >
            {m['common.actions.confirmDelete']()}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
