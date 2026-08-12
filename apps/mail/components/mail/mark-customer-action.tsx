import { Loader2, UserRoundPlus } from 'lucide-react';
import { useState } from 'react';

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import type { Sender } from '@/types';

export type CustomerCreationCandidate = {
  messageId: string;
  sender: Sender;
};

type MarkCustomerStrings = {
  label: string;
  title: string;
  description: string;
  cancel: string;
  confirm: string;
};

export function MarkCustomerAction({
  candidate,
  pending,
  strings,
  onConfirm,
}: {
  candidate: CustomerCreationCandidate | null;
  pending: boolean;
  strings: MarkCustomerStrings;
  onConfirm(candidate: CustomerCreationCandidate): boolean | Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  if (!candidate) return null;

  const sender = candidate.sender.name
    ? `${candidate.sender.name} <${candidate.sender.email}>`
    : candidate.sender.email;
  const description = strings.description.replace('{sender}', sender);
  const submit = async () => {
    if (await onConfirm(candidate)) setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <TooltipProvider delayDuration={0}>
        <Tooltip>
          <TooltipTrigger asChild>
            <DialogTrigger asChild>
              <button
                type="button"
                aria-label={strings.label}
                data-mark-customer-action="true"
                disabled={pending}
                className="inline-flex h-7 w-7 cursor-pointer items-center justify-center overflow-hidden rounded-lg bg-white transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-[#313131] dark:hover:bg-[#404040]"
              >
                {pending ? (
                  <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin text-[#9D9D9D]" />
                ) : (
                  <UserRoundPlus
                    aria-hidden="true"
                    className="h-4 w-4 stroke-[#9D9D9D] dark:stroke-[#9D9D9D]"
                  />
                )}
              </button>
            </DialogTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="bg-white dark:bg-[#313131]">
            {strings.label}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <DialogContent showOverlay>
        <DialogHeader>
          <DialogTitle>{strings.title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={pending}>
              {strings.cancel}
            </Button>
          </DialogClose>
          <Button onClick={submit} disabled={pending}>
            {pending ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : null}
            {strings.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
