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
import { m } from '@/paraglide/messages';

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
    toast.success(m['pages.settings.connections.zohoWebhook.copied']());
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {children ?? (
          <Button variant="outline" size="sm">
            <Webhook className="size-4" />
            {m['pages.settings.connections.zohoWebhook.button']()}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent showOverlay>
        <DialogHeader>
          <DialogTitle>{m['pages.settings.connections.zohoWebhook.title']()}</DialogTitle>
          <DialogDescription>
            {m['pages.settings.connections.zohoWebhook.description']()}
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
              <li>{m['pages.settings.connections.zohoWebhook.stepOpenSettings']()}</li>
              <li>{m['pages.settings.connections.zohoWebhook.stepCreate']()}</li>
              <li>{m['pages.settings.connections.zohoWebhook.stepSave']()}</li>
            </ol>
          </div>
        ) : (
          <p className="text-muted-foreground py-6 text-sm">
            {m['pages.settings.connections.zohoWebhook.disabledDescription']()}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
