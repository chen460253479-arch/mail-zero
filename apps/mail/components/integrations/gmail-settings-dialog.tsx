import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Inputs, Outputs } from '@zero/server/trpc';
import { Loader2, X } from 'lucide-react';
import { toast } from 'sonner';

import {
  defaultGmailConfigForm,
  getGmailConfigErrors,
  isManualOnly,
  type GmailConfigForm,
} from '@/modules/integrations/gmail-config';
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
import { getNangoValidationErrorMessage } from '@/lib/nango-validation-error';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { ConfirmIntegrationDelete } from './confirm-delete';
import { Separator } from '@/components/ui/separator';
import { GmailColor } from '@/components/icons/icons';
import { useTRPC } from '@/providers/query-provider';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

type GmailConfig = Outputs['integrations']['getGmailConfig'];

const toForm = (data: NonNullable<GmailConfig>): GmailConfigForm => ({
  authSource: data.authSource,
  inboxWatchEnabled: data.inboxWatchEnabled,
  scheduledSyncEnabled: data.scheduledSyncEnabled,
  syncIntervalMinutes: data.syncIntervalMinutes,
  topicName: data.providerConfig.topicName ?? '',
  subscriptionName: data.providerConfig.subscriptionName ?? '',
  pushAudience: data.providerConfig.pushAudience ?? '',
  pushServiceAccount: data.providerConfig.pushServiceAccount ?? '',
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
        // Google remains cross-origin until it redirects to the Zero frontend.
      }
    }, 500);
  });

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

export function GmailSettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const config = useQuery(trpc.integrations.getGmailConfig.queryOptions());
  const saveChannel = useMutation(trpc.integrations.saveGmailConfig.mutationOptions());
  const saveNango = useMutation(trpc.integrations.validateAndSaveNango.mutationOptions());
  const deleteNango = useMutation(trpc.integrations.deleteNango.mutationOptions());
  const setNangoMapping = useMutation(trpc.integrations.setNangoGmailIntegration.mutationOptions());
  const startGmailValidation = useMutation(
    trpc.integrations.startGmailValidation.mutationOptions(),
  );
  const deleteGmailOAuth = useMutation(trpc.integrations.deleteGmailZeroOAuth.mutationOptions());

  const [form, setForm] = useState<GmailConfigForm>(defaultGmailConfigForm);
  const [baseline, setBaseline] = useState<GmailConfigForm>(defaultGmailConfigForm);
  const [nangoBaseUrl, setNangoBaseUrl] = useState('https://api.nango.dev');
  const [nangoSecret, setNangoSecret] = useState('');
  const [gmailClientId, setGmailClientId] = useState('');
  const [gmailClientSecret, setGmailClientSecret] = useState('');

  const nangoIntegrations = useQuery({
    ...trpc.integrations.listNangoGmailIntegrations.queryOptions(),
    enabled:
      open &&
      form.authSource === 'nango' &&
      Boolean(config.data?.authorizationSources.nango.serviceConfigured),
  });

  useEffect(() => {
    if (!config.data) return;
    const next = toForm(config.data);
    setForm(next);
    setBaseline(next);
    setNangoBaseUrl(config.data.authorizationSources.nango.baseUrl ?? 'https://api.nango.dev');
    setGmailClientId(config.data.authorizationSources.zero_oauth.clientId ?? '');
  }, [config.data]);

  const dirty = JSON.stringify(form) !== JSON.stringify(baseline);
  const errors = useMemo(() => getGmailConfigErrors(form), [form]);
  const selectedSourceReady =
    form.authSource === 'nango'
      ? config.data?.authorizationSources.nango.configured
      : config.data?.authorizationSources.zero_oauth.configured;

  const refresh = async () => {
    await Promise.all([
      config.refetch(),
      queryClient.invalidateQueries({ queryKey: trpc.integrations.getChannels.queryKey() }),
      queryClient.invalidateQueries({
        queryKey: trpc.connections.getGmailAuthorizationOptions.queryKey(),
      }),
    ]);
  };

  const requestClose = (nextOpen: boolean) => {
    if (!nextOpen && dirty && !window.confirm('Discard the unsaved Gmail channel changes?')) {
      return;
    }
    onOpenChange(nextOpen);
  };

  const save = async () => {
    if (Object.keys(errors).length > 0) {
      toast.error('Review the Gmail channel configuration');
      return;
    }
    const common = {
      authSource: form.authSource,
      scheduledSyncEnabled: form.scheduledSyncEnabled,
      syncIntervalMinutes: form.syncIntervalMinutes,
    };
    const input: Inputs['integrations']['saveGmailConfig'] = form.inboxWatchEnabled
      ? {
          ...common,
          inboxWatchEnabled: true,
          providerConfig: {
            topicName: form.topicName.trim(),
            subscriptionName: form.subscriptionName.trim(),
            pushAudience: form.pushAudience.trim(),
            pushServiceAccount: form.pushServiceAccount.trim(),
          },
        }
      : {
          ...common,
          inboxWatchEnabled: false,
          providerConfig: {
            ...(form.topicName.trim() ? { topicName: form.topicName.trim() } : {}),
            ...(form.subscriptionName.trim()
              ? { subscriptionName: form.subscriptionName.trim() }
              : {}),
            ...(form.pushAudience.trim() ? { pushAudience: form.pushAudience.trim() } : {}),
            ...(form.pushServiceAccount.trim()
              ? { pushServiceAccount: form.pushServiceAccount.trim() }
              : {}),
          },
        };
    try {
      const saved = await saveChannel.mutateAsync(input);
      if (!saved) throw new Error('GMAIL_CHANNEL_CONFIG_NOT_SAVED');
      const next = toForm(saved);
      setForm(next);
      setBaseline(next);
      await refresh();
      toast.success('Gmail channel configuration saved');
    } catch {
      toast.error(
        selectedSourceReady
          ? 'Unable to save the Gmail channel configuration'
          : 'Configure the selected authorization source before saving',
      );
    }
  };

  const validateNango = async () => {
    try {
      await saveNango.mutateAsync({
        baseUrl: nangoBaseUrl,
        secretKey: nangoSecret || undefined,
      });
      setNangoSecret('');
      await refresh();
      await nangoIntegrations.refetch();
      toast.success('Nango configuration validated');
    } catch (error) {
      toast.error(getNangoValidationErrorMessage(error));
    }
  };

  const validateGmailOAuth = async () => {
    const popup = window.open('', 'gmail-oauth-validation', 'popup,width=620,height=760');
    if (!popup) {
      toast.error('Allow popups to validate Gmail OAuth');
      return;
    }
    try {
      const result = await startGmailValidation.mutateAsync({
        clientId: gmailClientId,
        clientSecret: gmailClientSecret || undefined,
      });
      if (!result) throw new Error('GMAIL_VALIDATION_DID_NOT_START');
      popup.location.href = result.authorizationUrl;
      const outcome = await waitForValidationPopup(popup);
      await refresh();
      if (outcome === 'success') {
        setGmailClientSecret('');
        toast.success('Gmail OAuth configuration validated');
      } else {
        toast.error(
          outcome === 'closed'
            ? 'Gmail validation window was closed'
            : outcome === 'timeout'
              ? 'Gmail validation timed out'
              : 'Gmail validation failed',
        );
      }
    } catch {
      popup.close();
      toast.error('Unable to start Gmail OAuth validation');
    }
  };

  const data = config.data;

  return (
    <Dialog open={open} onOpenChange={requestClose}>
      <DialogContent
        showOverlay
        className="bg-panelLight dark:bg-panelDark flex h-[100dvh] w-screen max-w-none flex-col rounded-none border-0 p-0 sm:h-[min(90vh,900px)] sm:max-w-5xl sm:rounded-xl sm:border"
      >
        <DialogHeader className="shrink-0 border-b px-5 py-4 text-left sm:px-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="bg-background flex size-10 items-center justify-center rounded-lg border">
                <GmailColor className="size-7" />
              </div>
              <div>
                <DialogTitle>Gmail channel</DialogTitle>
                <DialogDescription>
                  Configure one global authorization source and Inbox synchronization policy.
                </DialogDescription>
              </div>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Close Gmail settings"
              onClick={() => requestClose(false)}
            >
              <X className="size-4" />
            </Button>
          </div>
        </DialogHeader>

        {config.isError ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
            <p className="font-medium">Unable to load the Gmail channel configuration.</p>
            <Button type="button" variant="outline" onClick={() => config.refetch()}>
              Try again
            </Button>
          </div>
        ) : config.isLoading || !data ? (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="text-muted-foreground size-6 animate-spin" />
          </div>
        ) : (
          <>
            <div className="flex-1 space-y-7 overflow-y-auto px-5 py-6 sm:px-6">
              <FormSection
                title="Authorization source"
                description="Every Gmail mailbox uses the single source selected here."
              >
                <RadioGroup
                  value={form.authSource}
                  disabled={data.authSourceLocked}
                  onValueChange={(value) =>
                    setForm((current) => ({
                      ...current,
                      authSource: value as GmailConfigForm['authSource'],
                    }))
                  }
                  className="grid gap-3 sm:grid-cols-2"
                >
                  {[
                    {
                      value: 'zero_oauth',
                      title: 'Zero OAuth',
                      description: 'Zero owns the Gmail OAuth client configuration.',
                    },
                    {
                      value: 'nango',
                      title: 'Nango Gmail',
                      description: 'Use the configured Nango Gmail Integration.',
                    },
                  ].map((source) => (
                    <Label
                      key={source.value}
                      htmlFor={`gmail-auth-${source.value}`}
                      className="flex cursor-pointer items-start gap-3 rounded-lg border p-4"
                    >
                      <RadioGroupItem
                        id={`gmail-auth-${source.value}`}
                        value={source.value}
                        className="mt-0.5"
                      />
                      <span>
                        <span className="block text-sm font-medium">{source.title}</span>
                        <span className="text-muted-foreground mt-1 block text-xs">
                          {source.description}
                        </span>
                      </span>
                    </Label>
                  ))}
                </RadioGroup>
                {data.authSourceLocked ? (
                  <p className="text-muted-foreground text-xs">
                    Disconnect the {data.bindingCount} Gmail mailbox binding
                    {data.bindingCount === 1 ? '' : 's'} before changing the authorization source.
                  </p>
                ) : null}
              </FormSection>

              <Separator />

              {form.authSource === 'nango' ? (
                <FormSection
                  title="Nango Gmail authorization"
                  description="Nango remains internal infrastructure and is not exposed as a mail channel."
                >
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="grid gap-2">
                      <Label htmlFor="nango-base-url">Base URL</Label>
                      <Input
                        id="nango-base-url"
                        type="url"
                        value={nangoBaseUrl}
                        disabled={data.authorizationSources.nango.bindingCount > 0}
                        onChange={(event) => setNangoBaseUrl(event.target.value)}
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="nango-secret">Secret Key</Label>
                      <Input
                        id="nango-secret"
                        type="password"
                        autoComplete="new-password"
                        value={nangoSecret}
                        placeholder={
                          data.authorizationSources.nango.serviceConfigured
                            ? 'Leave blank to keep the configured secret'
                            : ''
                        }
                        onChange={(event) => setNangoSecret(event.target.value)}
                      />
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={
                        saveNango.isPending ||
                        !nangoBaseUrl ||
                        (!data.authorizationSources.nango.serviceConfigured && !nangoSecret.trim())
                      }
                      onClick={validateNango}
                    >
                      {saveNango.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                      Validate Nango
                    </Button>
                    <Badge
                      variant={
                        data.authorizationSources.nango.serviceConfigured ? 'default' : 'outline'
                      }
                    >
                      {data.authorizationSources.nango.serviceConfigured
                        ? 'Service configured'
                        : 'Not configured'}
                    </Badge>
                  </div>
                  <div className="grid gap-2">
                    <Label>Gmail Nango Integration</Label>
                    <Select
                      value={data.authorizationSources.nango.gmailIntegrationId ?? undefined}
                      disabled={
                        !data.authorizationSources.nango.serviceConfigured ||
                        data.authorizationSources.nango.bindingCount > 0 ||
                        nangoIntegrations.isLoading
                      }
                      onValueChange={async (integrationId) => {
                        try {
                          await setNangoMapping.mutateAsync({ integrationId });
                          await refresh();
                          toast.success('Nango Gmail Integration selected');
                        } catch {
                          toast.error('Unable to select the Nango Gmail Integration');
                        }
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select a Gmail Integration" />
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
                  </div>
                  <ConfirmIntegrationDelete
                    title="Delete Nango configuration?"
                    description="This removes the global Nango service and Gmail mapping."
                    disabled={
                      !data.authorizationSources.nango.serviceConfigured ||
                      data.authorizationSources.nango.bindingCount > 0
                    }
                    pending={deleteNango.isPending}
                    onConfirm={async () => {
                      await deleteNango.mutateAsync();
                      await refresh();
                    }}
                  >
                    <Button
                      type="button"
                      variant="destructive"
                      disabled={
                        !data.authorizationSources.nango.serviceConfigured ||
                        data.authorizationSources.nango.bindingCount > 0
                      }
                    >
                      Delete Nango configuration
                    </Button>
                  </ConfirmIntegrationDelete>
                </FormSection>
              ) : (
                <FormSection
                  title="Zero-managed Gmail OAuth"
                  description="Validate the global OAuth client before enabling it for mailbox connections."
                >
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="grid gap-2">
                      <Label htmlFor="gmail-client-id">Client ID</Label>
                      <Input
                        id="gmail-client-id"
                        value={gmailClientId}
                        disabled={data.authorizationSources.zero_oauth.bindingCount > 0}
                        onChange={(event) => setGmailClientId(event.target.value)}
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="gmail-client-secret">Client Secret</Label>
                      <Input
                        id="gmail-client-secret"
                        type="password"
                        autoComplete="new-password"
                        value={gmailClientSecret}
                        disabled={data.authorizationSources.zero_oauth.bindingCount > 0}
                        placeholder={
                          data.authorizationSources.zero_oauth.configured
                            ? 'Leave blank to keep the configured secret'
                            : ''
                        }
                        onChange={(event) => setGmailClientSecret(event.target.value)}
                      />
                    </div>
                  </div>
                  <div className="grid gap-2">
                    <Label>Authorized redirect URLs</Label>
                    <Input
                      readOnly
                      value={data.authorizationSources.zero_oauth.redirectUris.validation}
                    />
                    <Input
                      readOnly
                      value={data.authorizationSources.zero_oauth.redirectUris.mailbox}
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={
                        startGmailValidation.isPending ||
                        data.authorizationSources.zero_oauth.bindingCount > 0 ||
                        !gmailClientId.trim() ||
                        (!data.authorizationSources.zero_oauth.configured &&
                          !gmailClientSecret.trim())
                      }
                      onClick={validateGmailOAuth}
                    >
                      {startGmailValidation.isPending ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : null}
                      Test and enable
                    </Button>
                    <Badge
                      variant={
                        data.authorizationSources.zero_oauth.configured ? 'default' : 'outline'
                      }
                    >
                      {data.authorizationSources.zero_oauth.configured
                        ? 'Configured'
                        : 'Not configured'}
                    </Badge>
                  </div>
                  <ConfirmIntegrationDelete
                    title="Delete Gmail OAuth configuration?"
                    description="Existing Zero OAuth bindings must be disconnected first."
                    disabled={
                      !data.authorizationSources.zero_oauth.configured ||
                      data.authorizationSources.zero_oauth.bindingCount > 0
                    }
                    pending={deleteGmailOAuth.isPending}
                    onConfirm={async () => {
                      await deleteGmailOAuth.mutateAsync();
                      await refresh();
                    }}
                  >
                    <Button
                      type="button"
                      variant="destructive"
                      disabled={
                        !data.authorizationSources.zero_oauth.configured ||
                        data.authorizationSources.zero_oauth.bindingCount > 0
                      }
                    >
                      Delete Gmail OAuth configuration
                    </Button>
                  </ConfirmIntegrationDelete>
                </FormSection>
              )}

              <Separator />

              <FormSection
                title="Gmail Inbox Watch"
                description="Accept Gmail Pub/Sub notifications through the fixed Zero webhook."
              >
                <div className="flex items-center justify-between rounded-lg border p-4">
                  <div>
                    <p className="text-sm font-medium">Enable Inbox Watch</p>
                    <p className="text-muted-foreground mt-1 text-xs">
                      Zero does not create or manage Google Cloud Pub/Sub resources.
                    </p>
                  </div>
                  <Switch
                    checked={form.inboxWatchEnabled}
                    onCheckedChange={(checked) =>
                      setForm((current) => ({ ...current, inboxWatchEnabled: checked }))
                    }
                  />
                </div>
                {form.inboxWatchEnabled ? (
                  <div className="grid gap-4 md:grid-cols-2">
                    {[
                      ['topicName', 'Topic name'],
                      ['subscriptionName', 'Subscription name'],
                      ['pushAudience', 'OIDC audience'],
                      ['pushServiceAccount', 'Push service account'],
                    ].map(([key, label]) => (
                      <div key={key} className="grid gap-2">
                        <Label htmlFor={`gmail-${key}`}>{label}</Label>
                        <Input
                          id={`gmail-${key}`}
                          value={form[key as keyof GmailConfigForm] as string}
                          aria-invalid={Boolean(errors[key as keyof GmailConfigForm])}
                          onChange={(event) =>
                            setForm((current) => ({
                              ...current,
                              [key]: event.target.value,
                            }))
                          }
                        />
                        {errors[key as keyof GmailConfigForm] ? (
                          <p className="text-destructive text-xs">
                            {errors[key as keyof GmailConfigForm]}
                          </p>
                        ) : null}
                      </div>
                    ))}
                    <div className="grid gap-2 md:col-span-2">
                      <Label>Webhook endpoint</Label>
                      <Input readOnly value={data.webhookUrl} />
                      <p className="text-muted-foreground text-xs">
                        Configure Nginx to expose this endpoint over public HTTPS, then use that URL
                        as the Google Pub/Sub push endpoint.
                      </p>
                    </div>
                  </div>
                ) : null}
              </FormSection>

              <Separator />

              <FormSection
                title="Scheduled incremental sync"
                description="Periodic reconciliation is a fallback trigger for the same incremental pipeline."
              >
                <div className="flex items-center justify-between rounded-lg border p-4">
                  <div>
                    <p className="text-sm font-medium">Enable scheduled sync</p>
                    <p className="text-muted-foreground mt-1 text-xs">
                      Push, schedule, and manual refresh share one generation and lease mechanism.
                    </p>
                  </div>
                  <Switch
                    checked={form.scheduledSyncEnabled}
                    onCheckedChange={(checked) =>
                      setForm((current) => ({ ...current, scheduledSyncEnabled: checked }))
                    }
                  />
                </div>
                {form.scheduledSyncEnabled ? (
                  <div className="grid max-w-xs gap-2">
                    <Label htmlFor="gmail-sync-interval">Interval (minutes)</Label>
                    <Input
                      id="gmail-sync-interval"
                      type="number"
                      min={1}
                      max={1440}
                      value={form.syncIntervalMinutes}
                      aria-invalid={Boolean(errors.syncIntervalMinutes)}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          syncIntervalMinutes: Number(event.target.value),
                        }))
                      }
                    />
                    {errors.syncIntervalMinutes ? (
                      <p className="text-destructive text-xs">{errors.syncIntervalMinutes}</p>
                    ) : null}
                  </div>
                ) : null}
                {isManualOnly(form) ? (
                  <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
                    Gmail is in manual-only mode. New messages are imported only when a manual
                    incremental sync is requested.
                  </div>
                ) : null}
              </FormSection>
            </div>

            <div className="flex shrink-0 flex-col-reverse gap-3 border-t px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
              <Button type="button" variant="outline" onClick={() => requestClose(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                disabled={
                  saveChannel.isPending || Object.keys(errors).length > 0 || !selectedSourceReady
                }
                onClick={save}
              >
                {saveChannel.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                Save Gmail channel
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
