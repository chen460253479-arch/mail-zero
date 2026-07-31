import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
import { m } from '@/paraglide/messages';

type GmailConfig = Outputs['integrations']['getGmailConfig'];

const nangoStateLabel = (state: 'unconfigured' | 'available' | 'unavailable') =>
  m[`pages.settings.integrations.nangoStates.${state}`]();

const toForm = (data: NonNullable<GmailConfig>): GmailConfigForm => ({
  authSource: data.authSource,
  inboxWatchEnabled: data.inboxWatchEnabled,
  scheduledSyncEnabled: data.scheduledSyncEnabled,
  syncIntervalMinutes: data.syncIntervalMinutes,
  topicName: data.providerConfig.topicName ?? '',
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
  const startGmailValidation = useMutation(
    trpc.integrations.startGmailValidation.mutationOptions(),
  );
  const deleteGmailOAuth = useMutation(trpc.integrations.deleteGmailZeroOAuth.mutationOptions());

  const [form, setForm] = useState<GmailConfigForm>(defaultGmailConfigForm);
  const [baseline, setBaseline] = useState<GmailConfigForm>(defaultGmailConfigForm);
  const [gmailClientId, setGmailClientId] = useState('');
  const [gmailClientSecret, setGmailClientSecret] = useState('');
  const [hydratedConfigUpdatedAt, setHydratedConfigUpdatedAt] = useState<number | null>(null);
  const dirtyRef = useRef(false);

  useEffect(() => {
    if (!config.data) return;
    const next = toForm(config.data);
    setForm(next);
    setBaseline(next);
    setGmailClientId(config.data.authorizationSources.zero_oauth.clientId ?? '');
    setHydratedConfigUpdatedAt(config.dataUpdatedAt);
  }, [config.data, config.dataUpdatedAt]);

  const dirty = JSON.stringify(form) !== JSON.stringify(baseline);
  dirtyRef.current = dirty;
  const errors = useMemo(() => getGmailConfigErrors(form), [form]);
  const selectedSourceReady =
    form.authSource === 'nango'
      ? config.data?.authorizationSources.nango.state === 'available'
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
    if (
      !nextOpen &&
      dirtyRef.current &&
      !window.confirm(m['pages.settings.integrations.gmail.discardChanges']())
    ) {
      return;
    }
    onOpenChange(nextOpen);
  };

  const save = async () => {
    if (Object.keys(errors).length > 0) {
      toast.error(m['pages.settings.integrations.gmail.reviewConfiguration']());
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
          },
        }
      : {
          ...common,
          inboxWatchEnabled: false,
          providerConfig: {
            ...(form.topicName.trim() ? { topicName: form.topicName.trim() } : {}),
          },
        };
    try {
      const saved = await saveChannel.mutateAsync(input);
      if (!saved) throw new Error('GMAIL_CHANNEL_CONFIG_NOT_SAVED');
      const next = toForm(saved);
      setForm(next);
      setBaseline(next);
      await refresh();
      dirtyRef.current = false;
      toast.success(m['pages.settings.integrations.gmail.saved']());
      onOpenChange(false);
    } catch {
      toast.error(
        selectedSourceReady
          ? m['pages.settings.integrations.gmail.saveError']()
          : m['pages.settings.integrations.gmail.configureAuthorizationSource'](),
      );
    }
  };

  const validateGmailOAuth = async () => {
    const popup = window.open('', 'gmail-oauth-validation', 'popup,width=620,height=760');
    if (!popup) {
      toast.error(m['pages.settings.integrations.gmail.allowPopups']());
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
        toast.success(m['pages.settings.integrations.gmail.oauthValidated']());
      } else {
        toast.error(
          outcome === 'closed'
            ? m['pages.settings.integrations.gmail.validationClosed']()
            : outcome === 'timeout'
              ? m['pages.settings.integrations.gmail.validationTimedOut']()
              : m['pages.settings.integrations.gmail.validationFailed'](),
        );
      }
    } catch {
      popup.close();
      toast.error(m['pages.settings.integrations.gmail.validationStartError']());
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
                <DialogTitle>{m['pages.settings.integrations.gmail.title']()}</DialogTitle>
                <DialogDescription>
                  {m['pages.settings.integrations.gmail.description']()}
                </DialogDescription>
              </div>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={m['pages.settings.integrations.gmail.closeSettings']()}
              onClick={() => requestClose(false)}
            >
              <X className="size-4" />
            </Button>
          </div>
        </DialogHeader>

        {config.isError ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
            <p className="font-medium">{m['pages.settings.integrations.gmail.loadError']()}</p>
            <Button type="button" variant="outline" onClick={() => config.refetch()}>
              {m['pages.settings.integrations.tryAgain']()}
            </Button>
          </div>
        ) : config.isLoading ||
          config.isFetching ||
          !data ||
          hydratedConfigUpdatedAt !== config.dataUpdatedAt ? (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="text-muted-foreground size-6 animate-spin" />
          </div>
        ) : (
          <>
            <div className="flex-1 space-y-7 overflow-y-auto px-5 py-6 sm:px-6">
              <FormSection
                title={m['pages.settings.integrations.authorizationSource']()}
                description={m[
                  'pages.settings.integrations.gmail.authorizationSourceDescription'
                ]()}
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
                      title: m['pages.settings.integrations.zeroOAuth'](),
                      description: m['pages.settings.integrations.gmail.zeroOAuthDescription'](),
                    },
                    {
                      value: 'nango',
                      title: m['pages.settings.integrations.gmail.nangoTitle'](),
                      description: m['pages.settings.integrations.gmail.nangoDescription'](),
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
                        disabled={
                          source.value === 'nango' &&
                          data.authorizationSources.nango.state !== 'available'
                        }
                        className="mt-0.5"
                      />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">{source.title}</span>
                        <span className="text-muted-foreground mt-1 block text-xs">
                          {source.description}
                        </span>
                        {source.value === 'nango' ? (
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
                            {data.authorizationSources.nango.errorCode ? (
                              <span className="text-muted-foreground break-all text-xs">
                                {data.authorizationSources.nango.errorCode}
                              </span>
                            ) : null}
                          </span>
                        ) : null}
                      </span>
                    </Label>
                  ))}
                </RadioGroup>
                {data.authSourceLocked ? (
                  <p className="text-muted-foreground text-xs">
                    {m['pages.settings.integrations.gmail.authorizationSourceLocked']()}
                  </p>
                ) : null}
              </FormSection>

              <Separator />

              {form.authSource === 'zero_oauth' ? (
                <FormSection
                  title={m['pages.settings.integrations.gmail.zeroManagedOAuth']()}
                  description={m['pages.settings.integrations.validateOAuthDescription']()}
                >
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="grid gap-2">
                      <Label htmlFor="gmail-client-id">
                        {m['pages.settings.integrations.clientId']()}
                      </Label>
                      <Input
                        id="gmail-client-id"
                        value={gmailClientId}
                        disabled={data.authorizationSources.zero_oauth.bindingCount > 0}
                        onChange={(event) => setGmailClientId(event.target.value)}
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="gmail-client-secret">
                        {m['pages.settings.integrations.clientSecret']()}
                      </Label>
                      <Input
                        id="gmail-client-secret"
                        type="password"
                        autoComplete="new-password"
                        value={gmailClientSecret}
                        disabled={data.authorizationSources.zero_oauth.bindingCount > 0}
                        placeholder={
                          data.authorizationSources.zero_oauth.configured
                            ? m['pages.settings.integrations.leaveSecretBlank']()
                            : ''
                        }
                        onChange={(event) => setGmailClientSecret(event.target.value)}
                      />
                    </div>
                  </div>
                  <div className="grid gap-2">
                    <Label>{m['pages.settings.integrations.authorizedRedirectUrls']()}</Label>
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
                      {m['pages.settings.integrations.testAndEnable']()}
                    </Button>
                    <Badge
                      variant={
                        data.authorizationSources.zero_oauth.configured ? 'default' : 'outline'
                      }
                    >
                      {data.authorizationSources.zero_oauth.configured
                        ? m['pages.settings.integrations.configured']()
                        : m['pages.settings.integrations.notConfigured']()}
                    </Badge>
                  </div>
                  <ConfirmIntegrationDelete
                    title={m['pages.settings.integrations.gmail.deleteOAuthTitle']()}
                    description={m['pages.settings.integrations.deleteOAuthDescription']()}
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
                      {m['pages.settings.integrations.gmail.deleteOAuth']()}
                    </Button>
                  </ConfirmIntegrationDelete>
                </FormSection>
              ) : null}

              <Separator />

              <FormSection
                title={m['pages.settings.integrations.gmail.inboxWatchTitle']()}
                description={m['pages.settings.integrations.gmail.inboxWatchDescription']()}
              >
                <div className="flex items-center justify-between rounded-lg border p-4">
                  <div>
                    <p className="text-sm font-medium">
                      {m['pages.settings.integrations.enableInboxWatch']()}
                    </p>
                    <p className="text-muted-foreground mt-1 text-xs">
                      {m['pages.settings.integrations.gmail.inboxWatchHelp']()}
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
                  <div className="grid gap-4">
                    <div className="grid gap-2">
                      <Label htmlFor="gmail-topic-name">
                        {m['pages.settings.integrations.gmail.topicName']()}
                      </Label>
                      <Input
                        id="gmail-topic-name"
                        value={form.topicName}
                        aria-invalid={Boolean(errors.topicName)}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            topicName: event.target.value,
                          }))
                        }
                      />
                      {errors.topicName ? (
                        <p className="text-destructive text-xs">{errors.topicName}</p>
                      ) : null}
                    </div>
                    <div className="grid gap-2">
                      <Label>{m['pages.settings.integrations.webhookEndpoint']()}</Label>
                      <Input readOnly value={data.webhookUrl} />
                      <p className="text-muted-foreground text-xs">
                        {m['pages.settings.integrations.gmail.webhookHelp']()}
                      </p>
                    </div>
                  </div>
                ) : null}
              </FormSection>

              <Separator />

              <FormSection
                title={m['pages.settings.integrations.scheduledSyncTitle']()}
                description={m['pages.settings.integrations.gmail.scheduledSyncDescription']()}
              >
                <div className="flex items-center justify-between rounded-lg border p-4">
                  <div>
                    <p className="text-sm font-medium">
                      {m['pages.settings.integrations.enableScheduledSync']()}
                    </p>
                    <p className="text-muted-foreground mt-1 text-xs">
                      {m['pages.settings.integrations.gmail.scheduledSyncHelp']()}
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
                    <Label htmlFor="gmail-sync-interval">
                      {m['pages.settings.integrations.intervalMinutes']()}
                    </Label>
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
                    {m['pages.settings.integrations.gmail.manualOnlyDescription']()}
                  </div>
                ) : null}
              </FormSection>
            </div>

            <div className="flex shrink-0 flex-col-reverse gap-3 border-t px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
              <Button type="button" variant="outline" onClick={() => requestClose(false)}>
                {m['common.actions.cancel']()}
              </Button>
              <Button
                type="button"
                disabled={
                  saveChannel.isPending || Object.keys(errors).length > 0 || !selectedSourceReady
                }
                onClick={save}
              >
                {saveChannel.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                {m['pages.settings.integrations.gmail.saveChannel']()}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
