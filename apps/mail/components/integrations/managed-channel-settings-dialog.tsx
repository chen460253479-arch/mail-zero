import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Inputs, Outputs } from '@zero/server/trpc';
import { Loader2, Mail, X } from 'lucide-react';
import { toast } from 'sonner';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { ConfirmIntegrationDelete } from './confirm-delete';
import { OutlookColor } from '@/components/icons/icons';
import { Separator } from '@/components/ui/separator';
import { useTRPC } from '@/providers/query-provider';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

type ManagedChannelId = 'outlook' | 'zoho_mail' | 'imap_smtp';
type ManagedConfig = Outputs['integrations']['getChannelConfig'];
type AuthSource = 'zero_oauth' | 'nango' | 'manual';

type FormState = {
  authSource: AuthSource;
  inboxWatchEnabled: boolean;
  scheduledSyncEnabled: boolean;
  syncIntervalMinutes: number;
  tenantId: string;
  dataCenter: 'com' | 'eu' | 'in' | 'com.au' | 'jp' | 'ca' | 'sa';
};

const defaults: FormState = {
  authSource: 'zero_oauth',
  inboxWatchEnabled: false,
  scheduledSyncEnabled: true,
  syncIntervalMinutes: 10,
  tenantId: 'common',
  dataCenter: 'com',
};

const labels = {
  outlook: 'Outlook',
  zoho_mail: 'Zoho Mail',
  imap_smtp: 'IMAP/SMTP',
} as const;

const nangoStateLabels = {
  unconfigured: 'Not configured',
  validating: 'Validating',
  available: 'Available',
  unavailable: 'Unavailable',
} as const;

const FormSection = ({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) => (
  <section className="space-y-4">
    <div>
      <h3 className="font-semibold">{title}</h3>
      <p className="text-muted-foreground mt-1 text-sm">{description}</p>
    </div>
    {children}
  </section>
);

const toForm = (data: NonNullable<ManagedConfig>): FormState => ({
  authSource: data.authSource,
  inboxWatchEnabled: data.inboxWatchEnabled,
  scheduledSyncEnabled: data.scheduledSyncEnabled,
  syncIntervalMinutes: data.syncIntervalMinutes,
  tenantId:
    data.channelId === 'outlook' && typeof data.providerConfig.tenantId === 'string'
      ? data.providerConfig.tenantId
      : 'common',
  dataCenter:
    data.channelId === 'zoho_mail' && typeof data.providerConfig.dataCenter === 'string'
      ? data.providerConfig.dataCenter
      : 'com',
});

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
      if (Date.now() - startedAt > 10 * 60_000) {
        popup.close();
        window.clearInterval(timer);
        resolve('timeout');
        return;
      }
      try {
        const url = new URL(popup.location.href);
        if (url.origin !== window.location.origin) return;
        const result = url.searchParams.get('channelValidation');
        if (result === 'success' || result === 'error') {
          popup.close();
          window.clearInterval(timer);
          resolve(result);
        }
      } catch {
        // The provider page remains cross-origin until it redirects to Zero.
      }
    }, 500);
  });

export function ManagedChannelSettingsDialog({
  channelId,
  open,
  onOpenChange,
}: {
  channelId: ManagedChannelId;
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const config = useQuery({
    ...trpc.integrations.getChannelConfig.queryOptions({ channelId }),
    enabled: open,
    refetchInterval: (query) =>
      query.state.data?.authorizationSources.nango.state === 'validating' ? 1000 : false,
  });
  const nangoIntegrations = useQuery({
    ...trpc.integrations.listNangoIntegrations.queryOptions({ channelId }),
    enabled: open && config.data?.authorizationSources.nango.state === 'available',
  });
  const saveChannel = useMutation(trpc.integrations.saveChannelConfig.mutationOptions());
  const setNangoMapping = useMutation(trpc.integrations.setNangoIntegration.mutationOptions());
  const startValidation = useMutation(
    trpc.integrations.startChannelOAuthValidation.mutationOptions(),
  );
  const deleteOAuth = useMutation(trpc.integrations.deleteChannelZeroOAuth.mutationOptions());

  const [form, setForm] = useState<FormState>(defaults);
  const [baseline, setBaseline] = useState<FormState>(defaults);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');

  useEffect(() => {
    if (!config.data) return;
    const next = toForm(config.data);
    setForm(next);
    setBaseline(next);
    setClientId(config.data.authorizationSources.zero_oauth?.clientId ?? '');
    setClientSecret('');
  }, [config.data]);

  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(baseline), [baseline, form]);
  const validInterval =
    Number.isSafeInteger(form.syncIntervalMinutes) &&
    form.syncIntervalMinutes >= 1 &&
    form.syncIntervalMinutes <= 1440;
  const selectedReady =
    form.authSource === 'nango'
      ? config.data?.authorizationSources.nango.configured === true
      : form.authSource === 'manual'
        ? config.data?.authorizationSources.manual?.available === true
        : config.data?.authorizationSources.zero_oauth?.configured === true;

  const refresh = async () => {
    await Promise.all([
      config.refetch(),
      queryClient.invalidateQueries({ queryKey: trpc.integrations.getChannels.queryKey() }),
    ]);
  };

  const validateOAuth = async () => {
    if (channelId === 'imap_smtp') return;
    const popup = window.open('', '_blank', 'popup,width=640,height=760');
    if (!popup) {
      toast.error('Allow pop-ups to validate OAuth');
      return;
    }
    try {
      const result = await startValidation.mutateAsync({
        channelId,
        clientId: clientId.trim(),
        clientSecret: clientSecret.trim() || undefined,
      });
      if (!result) throw new Error('OAuth validation did not start');
      popup.location.assign(result.authorizationUrl);
      const status = await waitForValidationPopup(popup);
      if (status !== 'success') throw new Error(status);
      await refresh();
      setClientSecret('');
      toast.success(`${labels[channelId]} OAuth validated`);
    } catch {
      popup.close();
      toast.error(`Unable to validate ${labels[channelId]} OAuth`);
    }
  };

  const save = async () => {
    if (!validInterval) return;
    try {
      const selectedIntegration = config.data?.authorizationSources.nango.integrationId ?? null;
      if (form.authSource === 'nango' && !selectedIntegration) {
        toast.error('Select a Nango Integration first');
        return;
      }
      let input: Inputs['integrations']['saveChannelConfig'];
      if (channelId === 'outlook') {
        input = {
          channelId,
          authSource: form.authSource as 'zero_oauth' | 'nango',
          inboxWatchEnabled: form.inboxWatchEnabled,
          scheduledSyncEnabled: form.scheduledSyncEnabled,
          syncIntervalMinutes: form.syncIntervalMinutes,
          providerConfig: { tenantId: form.tenantId.trim() || 'common' },
        };
      } else if (channelId === 'zoho_mail') {
        input = {
          channelId,
          authSource: form.authSource as 'zero_oauth' | 'nango',
          inboxWatchEnabled: form.inboxWatchEnabled,
          scheduledSyncEnabled: form.scheduledSyncEnabled,
          syncIntervalMinutes: form.syncIntervalMinutes,
          providerConfig: { dataCenter: form.dataCenter },
        };
      } else {
        input = {
          channelId,
          authSource: form.authSource as 'manual' | 'nango',
          inboxWatchEnabled: false,
          scheduledSyncEnabled: form.scheduledSyncEnabled,
          syncIntervalMinutes: form.syncIntervalMinutes,
          providerConfig: {},
        };
      }
      await saveChannel.mutateAsync(input);
      setBaseline(form);
      await refresh();
      toast.success(`${labels[channelId]} channel saved`);
    } catch {
      toast.error(`Unable to save ${labels[channelId]} channel`);
    }
  };

  const requestClose = (nextOpen: boolean) => {
    if (!nextOpen && dirty && !window.confirm('Discard unsaved channel changes?')) return;
    onOpenChange(nextOpen);
  };

  const data = config.data;
  const zeroOAuth = data?.authorizationSources.zero_oauth;
  const manual = data?.authorizationSources.manual;

  return (
    <Dialog open={open} onOpenChange={requestClose}>
      <DialogContent
        showOverlay
        className="flex max-h-[92vh] max-w-4xl flex-col gap-0 overflow-hidden p-0"
      >
        <DialogHeader className="border-b px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex gap-3">
              <div className="bg-background flex size-10 items-center justify-center rounded-lg border">
                {channelId === 'outlook' ? (
                  <OutlookColor className="size-6" />
                ) : (
                  <Mail className="size-5" />
                )}
              </div>
              <div>
                <DialogTitle>{labels[channelId]}</DialogTitle>
                <DialogDescription>
                  Configure one global provider channel and authorization source.
                </DialogDescription>
              </div>
            </div>
            <Button type="button" variant="ghost" size="icon" onClick={() => requestClose(false)}>
              <X className="size-4" />
            </Button>
          </div>
        </DialogHeader>

        {!data || config.isLoading ? (
          <div className="flex min-h-72 items-center justify-center">
            <Loader2 className="text-muted-foreground size-6 animate-spin" />
          </div>
        ) : (
          <>
            <div className="min-h-0 flex-1 space-y-7 overflow-y-auto px-6 py-6">
              <FormSection
                title="Authorization source"
                description="Only one source can be active globally. Disconnect existing bindings before switching."
              >
                <RadioGroup
                  value={form.authSource}
                  disabled={data.authSourceLocked}
                  onValueChange={(value) =>
                    setForm((current) => ({ ...current, authSource: value as AuthSource }))
                  }
                  className="grid gap-3 md:grid-cols-2"
                >
                  {channelId !== 'imap_smtp' && zeroOAuth ? (
                    <Label className="flex cursor-pointer items-start gap-3 rounded-lg border p-4">
                      <RadioGroupItem value="zero_oauth" />
                      <span>
                        <span className="block font-medium">Zero OAuth</span>
                        <span className="text-muted-foreground mt-1 block text-xs">
                          Zero stores the provider OAuth application and encrypted mailbox tokens.
                        </span>
                      </span>
                    </Label>
                  ) : null}
                  {channelId === 'imap_smtp' && manual ? (
                    <Label className="flex cursor-pointer items-start gap-3 rounded-lg border p-4">
                      <RadioGroupItem value="manual" />
                      <span>
                        <span className="block font-medium">Direct credentials</span>
                        <span className="text-muted-foreground mt-1 block text-xs">
                          Credentials are encrypted locally and used by the isolated protocol
                          worker.
                        </span>
                      </span>
                    </Label>
                  ) : null}
                  <Label className="flex cursor-pointer items-start gap-3 rounded-lg border p-4">
                    <RadioGroupItem value="nango" />
                    <span>
                      <span className="block font-medium">Nango</span>
                      <span className="text-muted-foreground mt-1 block text-xs">
                        Nango stores credentials; Zero still runs all mailbox logic locally.
                      </span>
                    </span>
                  </Label>
                </RadioGroup>
              </FormSection>

              {form.authSource === 'nango' ? (
                <FormSection
                  title="Nango Integration"
                  description="Select the one Nango Integration mapped to this channel."
                >
                  <div className="flex items-center gap-3">
                    <Badge
                      variant={
                        data.authorizationSources.nango.state === 'available'
                          ? 'default'
                          : 'outline'
                      }
                    >
                      {nangoStateLabels[data.authorizationSources.nango.state]}
                    </Badge>
                    <span className="text-muted-foreground text-xs">
                      {data.authorizationSources.nango.bindingCount} mailbox bindings
                    </span>
                  </div>
                  <Select
                    value={data.authorizationSources.nango.integrationId ?? undefined}
                    disabled={
                      data.authSourceLocked ||
                      nangoIntegrations.isLoading ||
                      data.authorizationSources.nango.state !== 'available'
                    }
                    onValueChange={async (integrationId) => {
                      try {
                        await setNangoMapping.mutateAsync({ channelId, integrationId });
                        await refresh();
                        toast.success('Nango Integration selected');
                      } catch {
                        toast.error('Unable to select Nango Integration');
                      }
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select an Integration" />
                    </SelectTrigger>
                    <SelectContent>
                      {(nangoIntegrations.data ?? []).map((integration) => (
                        <SelectItem
                          key={integration.integrationId}
                          value={integration.integrationId}
                        >
                          {integration.displayName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormSection>
              ) : form.authSource === 'zero_oauth' && zeroOAuth ? (
                <FormSection
                  title="Zero-managed OAuth"
                  description="Validate the global OAuth client before enabling mailbox connections."
                >
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="grid gap-2">
                      <Label htmlFor={`${channelId}-client-id`}>Client ID</Label>
                      <Input
                        id={`${channelId}-client-id`}
                        value={clientId}
                        disabled={zeroOAuth.bindingCount > 0}
                        onChange={(event) => setClientId(event.target.value)}
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor={`${channelId}-client-secret`}>Client Secret</Label>
                      <Input
                        id={`${channelId}-client-secret`}
                        type="password"
                        autoComplete="new-password"
                        value={clientSecret}
                        disabled={zeroOAuth.bindingCount > 0}
                        placeholder={
                          zeroOAuth.configured ? 'Leave blank to keep current secret' : ''
                        }
                        onChange={(event) => setClientSecret(event.target.value)}
                      />
                    </div>
                  </div>
                  <div className="grid gap-2">
                    <Label>Authorized redirect URLs</Label>
                    <Input readOnly value={zeroOAuth.redirectUris.validation} />
                    <Input readOnly value={zeroOAuth.redirectUris.mailbox} />
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={
                        startValidation.isPending ||
                        zeroOAuth.bindingCount > 0 ||
                        !clientId.trim() ||
                        (!zeroOAuth.configured && !clientSecret.trim())
                      }
                      onClick={validateOAuth}
                    >
                      {startValidation.isPending ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : null}
                      Test and enable
                    </Button>
                    <Badge variant={zeroOAuth.configured ? 'default' : 'outline'}>
                      {zeroOAuth.configured ? 'Configured' : 'Not configured'}
                    </Badge>
                  </div>
                  <ConfirmIntegrationDelete
                    title={`Delete ${labels[channelId]} OAuth configuration?`}
                    description="Existing Zero OAuth bindings must be disconnected first."
                    disabled={!zeroOAuth.configured || zeroOAuth.bindingCount > 0}
                    pending={deleteOAuth.isPending}
                    onConfirm={async () => {
                      await deleteOAuth.mutateAsync({
                        channelId: channelId as 'outlook' | 'zoho_mail',
                      });
                      await refresh();
                    }}
                  >
                    <Button
                      type="button"
                      variant="destructive"
                      disabled={!zeroOAuth.configured || zeroOAuth.bindingCount > 0}
                    >
                      Delete OAuth configuration
                    </Button>
                  </ConfirmIntegrationDelete>
                </FormSection>
              ) : null}

              {channelId === 'outlook' ? (
                <FormSection
                  title="Microsoft tenant"
                  description="Use common for multi-tenant accounts, or a tenant ID/domain to restrict sign-in."
                >
                  <Input
                    value={form.tenantId}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, tenantId: event.target.value }))
                    }
                  />
                </FormSection>
              ) : channelId === 'zoho_mail' ? (
                <FormSection
                  title="Zoho data center"
                  description="OAuth and Mail API calls stay inside this fixed Zoho data center."
                >
                  <Select
                    value={form.dataCenter}
                    disabled={data.authSourceLocked}
                    onValueChange={(dataCenter) =>
                      setForm((current) => ({
                        ...current,
                        dataCenter: dataCenter as FormState['dataCenter'],
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {['com', 'eu', 'in', 'com.au', 'jp', 'ca', 'sa'].map((value) => (
                        <SelectItem key={value} value={value}>
                          {value}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormSection>
              ) : null}

              {channelId !== 'imap_smtp' ? (
                <>
                  <Separator />
                  <FormSection
                    title={`${labels[channelId]} Inbox Watch`}
                    description={
                      channelId === 'outlook'
                        ? 'Zero creates and renews a Microsoft Graph subscription using this fixed endpoint.'
                        : 'Configure each connected mailbox Outgoing Webhook in Zoho using its tokenized Zero URL.'
                    }
                  >
                    <div className="flex items-center justify-between rounded-lg border p-4">
                      <div>
                        <p className="text-sm font-medium">Enable Inbox Watch</p>
                        <p className="text-muted-foreground mt-1 text-xs">
                          Webhook and schedule feed the same idempotent incremental pipeline.
                        </p>
                      </div>
                      <Switch
                        checked={form.inboxWatchEnabled}
                        onCheckedChange={(checked) =>
                          setForm((current) => ({
                            ...current,
                            inboxWatchEnabled: checked,
                          }))
                        }
                      />
                    </div>
                    {data.webhookUrl ? (
                      <div className="grid gap-2">
                        <Label>Webhook endpoint</Label>
                        <Input readOnly value={data.webhookUrl} />
                        {channelId === 'zoho_mail' ? (
                          <p className="text-muted-foreground text-xs">
                            The real per-mailbox URL replaces :endpointToken after the mailbox is
                            connected.
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                  </FormSection>
                </>
              ) : null}

              <Separator />
              <FormSection
                title="Scheduled incremental sync"
                description="Periodic reconciliation imports only changes after the no-history binding baseline."
              >
                <div className="flex items-center justify-between rounded-lg border p-4">
                  <div>
                    <p className="text-sm font-medium">Enable scheduled sync</p>
                    <p className="text-muted-foreground mt-1 text-xs">
                      IMAP currently supports scheduled incremental synchronization only.
                    </p>
                  </div>
                  <Switch
                    checked={form.scheduledSyncEnabled}
                    onCheckedChange={(checked) =>
                      setForm((current) => ({
                        ...current,
                        scheduledSyncEnabled: checked,
                      }))
                    }
                  />
                </div>
                {form.scheduledSyncEnabled ? (
                  <div className="grid max-w-xs gap-2">
                    <Label htmlFor={`${channelId}-sync-interval`}>Interval (minutes)</Label>
                    <Input
                      id={`${channelId}-sync-interval`}
                      type="number"
                      min={1}
                      max={1440}
                      value={form.syncIntervalMinutes}
                      aria-invalid={!validInterval}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          syncIntervalMinutes: Number(event.target.value),
                        }))
                      }
                    />
                  </div>
                ) : null}
              </FormSection>
            </div>

            <div className="flex shrink-0 flex-col-reverse gap-3 border-t px-6 py-4 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" onClick={() => requestClose(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                disabled={saveChannel.isPending || !validInterval || !selectedReady}
                onClick={save}
              >
                {saveChannel.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                Save {labels[channelId]} channel
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
