import { useEffect, useState } from 'react';

import { useMutation } from '@tanstack/react-query';
import type { Outputs } from '@zero/server/trpc';
import { toast } from 'sonner';

import { SettingsCard } from '@/components/settings/settings-card';
import { ConfirmIntegrationDelete } from './confirm-delete';
import { useTRPC } from '@/providers/query-provider';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

type GmailOverview = Outputs['integrations']['getOverview']['gmail'];

const waitForValidationPopup = (
  popup: Window,
): Promise<'success' | 'error' | 'closed' | 'timeout'> =>
  new Promise((resolve) => {
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      if (popup.closed) {
        window.clearInterval(timer);
        resolve('closed');
        return;
      }
      if (Date.now() - startedAt > 10 * 60 * 1000) {
        popup.close();
        window.clearInterval(timer);
        resolve('timeout');
        return;
      }
      try {
        const url = new URL(popup.location.href);
        if (url.origin !== window.location.origin) return;
        const result = url.searchParams.get('gmailValidation');
        if (result === 'success' || result === 'error') {
          popup.close();
          window.clearInterval(timer);
          resolve(result);
        }
      } catch {
        // Cross-origin access is expected until Google redirects back to Zero.
      }
    }, 500);
  });

export function GmailOAuthSettingsCard({
  data,
  onChanged,
}: {
  data: GmailOverview;
  onChanged(): Promise<unknown>;
}) {
  const trpc = useTRPC();
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const startValidation = useMutation(trpc.integrations.startGmailValidation.mutationOptions());
  const remove = useMutation(trpc.integrations.deleteGmailZeroOAuth.mutationOptions());
  const inUse = data.bindingCount > 0;

  useEffect(() => {
    setClientId(data.configured ? data.publicConfig.clientId : '');
  }, [data]);

  const validate = async () => {
    const popup = window.open('', 'gmail-oauth-validation', 'popup,width=620,height=760');
    if (!popup) {
      toast.error('Allow popups to validate the Gmail OAuth configuration');
      return;
    }
    try {
      const result = await startValidation.mutateAsync({
        clientId,
        clientSecret: clientSecret || undefined,
      });
      if (!result) throw new Error('Gmail validation did not start');
      popup.location.href = result.authorizationUrl;
      const outcome = await waitForValidationPopup(popup);
      await onChanged();
      if (outcome === 'success') {
        setClientSecret('');
        toast.success('Gmail OAuth configuration validated and enabled');
      } else if (outcome === 'closed') {
        toast.error('Gmail validation window was closed');
      } else if (outcome === 'timeout') {
        toast.error('Gmail validation timed out');
      } else {
        toast.error('Gmail validation failed; the existing configuration was kept');
      }
    } catch {
      popup.close();
      toast.error('Unable to start Gmail OAuth validation');
    }
  };

  return (
    <SettingsCard
      title="Gmail"
      description="Configure Zero-managed Gmail OAuth. Google user login is not enabled."
      action={
        <Badge variant={data.configured ? 'default' : 'outline'}>
          {data.configured ? data.status : 'Not configured'}
        </Badge>
      }
    >
      <div className="grid gap-5 md:max-w-2xl">
        <div className="grid gap-2">
          <Label htmlFor="gmail-client-id">Client ID</Label>
          <Input
            id="gmail-client-id"
            value={clientId}
            disabled={inUse}
            onChange={(event) => setClientId(event.target.value)}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="gmail-client-secret">Client Secret</Label>
          <Input
            id="gmail-client-secret"
            type="password"
            autoComplete="new-password"
            value={clientSecret}
            disabled={inUse}
            placeholder={data.configured ? 'Client Secret configured — leave blank to keep it' : ''}
            onChange={(event) => setClientSecret(event.target.value)}
          />
          {data.configured ? (
            <p className="text-muted-foreground text-xs">Client Secret configured</p>
          ) : null}
        </div>
        <div className="grid gap-2">
          <Label>Authorized redirect URLs</Label>
          <Input readOnly value={data.redirectUris.validation} />
          <Input readOnly value={data.redirectUris.mailbox} />
        </div>
        <p className="text-muted-foreground text-sm">
          {data.bindingCount} active Zero OAuth mailbox{' '}
          {data.bindingCount === 1 ? 'binding' : 'bindings'}
          {inUse ? ' — disconnect them before replacing or deleting this configuration.' : ''}
        </p>
        <div className="flex flex-wrap gap-3">
          <Button
            onClick={validate}
            disabled={
              startValidation.isPending ||
              inUse ||
              !clientId.trim() ||
              (!data.configured && !clientSecret.trim())
            }
          >
            {startValidation.isPending ? 'Starting…' : 'Test and enable'}
          </Button>
          <ConfirmIntegrationDelete
            title="Delete Gmail OAuth configuration?"
            description="Zero will stop offering new Gmail OAuth authorization. Existing bindings must be disconnected first."
            disabled={!data.configured || inUse}
            pending={remove.isPending}
            onConfirm={async () => {
              try {
                await remove.mutateAsync();
                await onChanged();
                toast.success('Gmail OAuth configuration deleted');
              } catch {
                toast.error(
                  'Disconnect all Zero OAuth mailboxes before deleting this configuration',
                );
                throw new Error('Gmail OAuth configuration is in use');
              }
            }}
          >
            <Button variant="destructive" disabled={!data.configured || inUse}>
              Delete configuration
            </Button>
          </ConfirmIntegrationDelete>
        </div>
      </div>
    </SettingsCard>
  );
}
