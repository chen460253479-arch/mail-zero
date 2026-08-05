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
import { m } from '@/paraglide/messages';

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

const channelLabel = (channelId: ManagedChannelId) =>
  m[
    channelId === 'outlook'
      ? 'common.brands.outlook'
      : channelId === 'zoho_mail'
        ? 'common.brands.zohoMail'
        : 'common.brands.imapSmtp'
  ]();

const nangoStateLabel = (state: 'unconfigured' | 'available' | 'unavailable') =>
  m[`pages.settings.integrations.nangoStates.${state}`]();

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
  });
  const saveChannel = useMutation(trpc.integrations.saveChannelConfig.mutationOptions());
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
      toast.error(m['pages.settings.integrations.allowPopups']());
      return;
    }
    try {
      const result = await startValidation.mutateAsync({
        channelId,
        clientId: clientId.trim(),
        clientSecret: clientSecret.trim() || undefined,
      });
      if (!result) throw new Error('OAUTH_VALIDATION_DID_NOT_START');
      popup.location.assign(result.authorizationUrl);
      const status = await waitForValidationPopup(popup);
      if (status !== 'success') throw new Error(status);
      await refresh();
      setClientSecret('');
      toast.success(
        m['pages.settings.integrations.oauthValidated']({ channel: channelLabel(channelId) }),
      );
    } catch {
      popup.close();
      toast.error(
        m['pages.settings.integrations.oauthValidationError']({ channel: channelLabel(channelId) }),
      );
    }
  };

  const save = async () => {
    if (!validInterval) return;
    try {
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
      toast.success(m['pages.settings.integrations.channelSaved']({ channel: channelLabel(channelId) }));
    } catch {
      toast.error(
        m['pages.settings.integrations.channelSaveError']({ channel: channelLabel(channelId) }),
      );
    }
  };

  const requestClose = (nextOpen: boolean) => {
    if (!nextOpen && dirty && !window.confirm(m['pages.settings.integrations.discardChanges']())) return;
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
                <DialogTitle>{channelLabel(channelId)}</DialogTitle>
                <DialogDescription>
                  {m['pages.settings.integrations.managed.description']()}
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
                title={m['pages.settings.integrations.authorizationSource']()}
                description={m['pages.settings.integrations.managed.authorizationSourceDescription']()}
              >
                <RadioGroup
                  value={form.authSource}
                  disabled={data.authSourceLocked}
                  onValueChange={(value) =>
                    setForm((current) => ({ ...current, authSource: value as AuthSource }))
                  }
                  className="grid gap-3 md:grid-cols-2"
                >
                  {channelId === 'outlook' && zeroOAuth ? (
                    <Label className="flex cursor-pointer items-start gap-3 rounded-lg border p-4">
                      <RadioGroupItem value="zero_oauth" />
                      <span>
                        <span className="block font-medium">
                          {m['pages.settings.integrations.zeroOAuth']()}
                        </span>
                        <span className="text-muted-foreground mt-1 block text-xs">
                          {m['pages.settings.integrations.managed.zeroOAuthDescription']()}
                        </span>
                      </span>
                    </Label>
                  ) : null}
                  {channelId === 'imap_smtp' && manual ? (
                    <Label className="flex cursor-pointer items-start gap-3 rounded-lg border p-4">
                      <RadioGroupItem value="manual" />
                      <span>
                        <span className="block font-medium">
                          {m['pages.settings.integrations.managed.directCredentials']()}
                        </span>
                        <span className="text-muted-foreground mt-1 block text-xs">
                          {m['pages.settings.integrations.managed.directCredentialsDescription']()}
                        </span>
                      </span>
                    </Label>
                  ) : null}
                  <Label className="flex cursor-pointer items-start gap-3 rounded-lg border p-4">
                    <RadioGroupItem
                      value="nango"
                      disabled={data.authorizationSources.nango.state !== 'available'}
                    />
                    <span className="min-w-0">
                      <span className="block font-medium">{m['common.brands.nango']()}</span>
                      <span className="text-muted-foreground mt-1 block text-xs">
                        {m['pages.settings.integrations.managed.nangoDescription']()}
                      </span>
                      <span className="mt-2 flex flex-wrap items-center gap-2">
                        <Badge
                          variant={
                            data.authorizationSources.nango.state === 'available'
                              ? 'default'
                              : 'outline'
                          }
                        >
                          {nangoStateLabel(data.authorizationSources.nango.state)}
                        </Badge>
                        <span className="text-muted-foreground text-xs">
                          {m['pages.settings.integrations.managed.mailboxBindings']({
                            count: data.authorizationSources.nango.bindingCount,
                          })}
                        </span>
                        {data.authorizationSources.nango.errorCode ? (
                          <span className="text-muted-foreground break-all text-xs">
                            {data.authorizationSources.nango.errorCode}
                          </span>
                        ) : null}
                      </span>
                    </span>
                  </Label>
                </RadioGroup>
              </FormSection>

              {channelId === 'outlook' && form.authSource === 'zero_oauth' && zeroOAuth ? (
                <FormSection
                  title={m['pages.settings.integrations.managed.zeroManagedOAuth']()}
                  description={m['pages.settings.integrations.validateOAuthDescription']()}
                >
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="grid gap-2">
                      <Label htmlFor={`${channelId}-client-id`}>
                        {m['pages.settings.integrations.clientId']()}
                      </Label>
                      <Input
                        id={`${channelId}-client-id`}
                        value={clientId}
                        disabled={zeroOAuth.bindingCount > 0}
                        onChange={(event) => setClientId(event.target.value)}
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor={`${channelId}-client-secret`}>
                        {m['pages.settings.integrations.clientSecret']()}
                      </Label>
                      <Input
                        id={`${channelId}-client-secret`}
                        type="password"
                        autoComplete="new-password"
                        value={clientSecret}
                        disabled={zeroOAuth.bindingCount > 0}
                        placeholder={
                          zeroOAuth.configured ? m['pages.settings.integrations.leaveSecretBlank']() : ''
                        }
                        onChange={(event) => setClientSecret(event.target.value)}
                      />
                    </div>
                  </div>
                  <div className="grid gap-2">
                    <Label>{m['pages.settings.integrations.authorizedRedirectUrls']()}</Label>
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
                      {m['pages.settings.integrations.testAndEnable']()}
                    </Button>
                    <Badge variant={zeroOAuth.configured ? 'default' : 'outline'}>
                      {zeroOAuth.configured
                        ? m['pages.settings.integrations.configured']()
                        : m['pages.settings.integrations.notConfigured']()}
                    </Badge>
                  </div>
                  <ConfirmIntegrationDelete
                    title={m['pages.settings.integrations.deleteOAuthTitle']({
                      channel: channelLabel(channelId),
                    })}
                    description={m['pages.settings.integrations.deleteOAuthDescription']()}
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
                      {m['pages.settings.integrations.deleteOAuth']()}
                    </Button>
                  </ConfirmIntegrationDelete>
                </FormSection>
              ) : null}

              {channelId === 'outlook' ? (
                <FormSection
                  title={m['pages.settings.integrations.managed.microsoftTenant']()}
                  description={m['pages.settings.integrations.managed.microsoftTenantDescription']()}
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
                  title={m['pages.settings.integrations.managed.zohoDataCenter']()}
                  description={m['pages.settings.integrations.managed.zohoDataCenterDescription']()}
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
                    title={m['pages.settings.integrations.managed.inboxWatchTitle']({
                      channel: channelLabel(channelId),
                    })}
                    description={
                      channelId === 'outlook'
                        ? m['pages.settings.integrations.managed.outlookInboxWatchDescription']()
                        : m['pages.settings.integrations.managed.zohoInboxWatchDescription']()
                    }
                  >
                    <div className="flex items-center justify-between rounded-lg border p-4">
                      <div>
                        <p className="text-sm font-medium">
                          {m['pages.settings.integrations.enableInboxWatch']()}
                        </p>
                        <p className="text-muted-foreground mt-1 text-xs">
                          {m['pages.settings.integrations.managed.inboxWatchHelp']()}
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
                        <Label>{m['pages.settings.integrations.webhookEndpoint']()}</Label>
                        <Input readOnly value={data.webhookUrl} />
                        {channelId === 'zoho_mail' ? (
                          <p className="text-muted-foreground text-xs">
                            {m['pages.settings.integrations.managed.zohoWebhookHelp']()}
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                  </FormSection>
                </>
              ) : null}

              <Separator />
              <FormSection
                title={m['pages.settings.integrations.scheduledSyncTitle']()}
                description={m['pages.settings.integrations.managed.scheduledSyncDescription']()}
              >
                <div className="flex items-center justify-between rounded-lg border p-4">
                  <div>
                    <p className="text-sm font-medium">
                      {m['pages.settings.integrations.enableScheduledSync']()}
                    </p>
                    <p className="text-muted-foreground mt-1 text-xs">
                      {m['pages.settings.integrations.managed.scheduledSyncHelp']()}
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
                    <Label htmlFor={`${channelId}-sync-interval`}>
                      {m['pages.settings.integrations.intervalMinutes']()}
                    </Label>
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
                {m['common.actions.cancel']()}
              </Button>
              <Button
                type="button"
                disabled={saveChannel.isPending || !validInterval || !selectedReady}
                onClick={save}
              >
                {saveChannel.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                {m['pages.settings.integrations.saveChannel']({ channel: channelLabel(channelId) })}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
