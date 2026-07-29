import { Copy, Loader2, Webhook } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { useTRPC } from '@/providers/query-provider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function ZohoWebhookSetupDialog({
  connectionId,
  children,
}: {
  connectionId: string;
  children?: ReactNode;
}) {
  const trpc = useTRPC();
  const [open, setOpen] = useState(false);
  const setup = useQuery({
    ...trpc.connections.getZohoWebhookSetup.queryOptions({ connectionId }),
    enabled: open,
    retry: false,
  });

  const copy = async () => {
    if (!setup.data?.webhookUrl) return;
    await navigator.clipboard.writeText(setup.data.webhookUrl);
    toast.success('Webhook URL copied');
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {children ?? (
          <Button variant="outline" size="sm">
            <Webhook className="size-4" />
            Webhook
          </Button>
        )}
      </DialogTrigger>
      <DialogContent showOverlay>
        <DialogHeader>
          <DialogTitle>Zoho Inbox Watch</DialogTitle>
          <DialogDescription>
            Add this per-mailbox URL as an Outgoing Webhook in the Zoho Mail developer settings.
            Zero treats the callback only as a sync signal and fetches the message from Zoho.
          </DialogDescription>
        </DialogHeader>

        {setup.isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="text-muted-foreground size-5 animate-spin" />
          </div>
        ) : setup.data ? (
          <div className="space-y-4">
            <div className="flex gap-2">
              <Input readOnly value={setup.data.webhookUrl} className="font-mono text-xs" />
              <Button type="button" variant="outline" size="icon" onClick={copy}>
                <Copy className="size-4" />
              </Button>
            </div>
            <ol className="text-muted-foreground list-decimal space-y-2 pl-5 text-sm">
              <li>Open the Zoho Mail Outgoing Webhook settings for this mailbox.</li>
              <li>Create an HTTPS webhook using the URL above.</li>
              <li>Choose incoming-message events, save it, and keep scheduled sync enabled.</li>
            </ol>
          </div>
        ) : (
          <p className="text-muted-foreground py-6 text-sm">
            Inbox Watch is disabled for the global Zoho Mail channel. Enable it in Integrations
            before configuring this mailbox.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
