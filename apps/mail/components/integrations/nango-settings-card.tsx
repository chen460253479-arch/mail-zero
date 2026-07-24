import { useEffect, useState } from 'react';

import { useMutation, useQuery } from '@tanstack/react-query';
import type { Outputs } from '@zero/server/trpc';
import { toast } from 'sonner';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SettingsCard } from '@/components/settings/settings-card';
import { ConfirmIntegrationDelete } from './confirm-delete';
import { useTRPC } from '@/providers/query-provider';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

type NangoOverview = Outputs['integrations']['getOverview']['nango'];

export function NangoSettingsCard({
  data,
  onChanged,
}: {
  data: NangoOverview;
  onChanged(): Promise<unknown>;
}) {
  const trpc = useTRPC();
  const [baseUrl, setBaseUrl] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const save = useMutation(trpc.integrations.validateAndSaveNango.mutationOptions());
  const remove = useMutation(trpc.integrations.deleteNango.mutationOptions());
  const setMapping = useMutation(trpc.integrations.setNangoGmailIntegration.mutationOptions());
  const integrations = useQuery({
    ...trpc.integrations.listNangoGmailIntegrations.queryOptions(),
    enabled: data.configured,
  });
  const inUse = data.bindingCount > 0;

  useEffect(() => {
    setBaseUrl(data.configured ? data.publicConfig.baseUrl : 'https://api.nango.dev');
  }, [data]);

  const submit = async () => {
    try {
      await save.mutateAsync({ baseUrl, secretKey: secretKey || undefined });
      setSecretKey('');
      await onChanged();
      await integrations.refetch();
      toast.success('Nango configuration validated and saved');
    } catch {
      toast.error('Nango validation failed; the existing configuration was kept');
    }
  };

  return (
    <SettingsCard
      title="Nango"
      description="Configure the one global Nango service and its active Gmail Integration."
      action={
        <Badge variant={data.configured ? 'default' : 'outline'}>
          {data.configured ? data.status : 'Not configured'}
        </Badge>
      }
    >
      <div className="grid gap-5 md:max-w-2xl">
        <div className="grid gap-2">
          <Label htmlFor="nango-base-url">Base URL</Label>
          <Input
            id="nango-base-url"
            type="url"
            value={baseUrl}
            disabled={inUse}
            onChange={(event) => setBaseUrl(event.target.value)}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="nango-secret">Secret Key</Label>
          <Input
            id="nango-secret"
            type="password"
            autoComplete="new-password"
            value={secretKey}
            placeholder={data.configured ? 'Secret Key configured — leave blank to keep it' : ''}
            onChange={(event) => setSecretKey(event.target.value)}
          />
          {data.configured ? (
            <p className="text-muted-foreground text-xs">Secret Key configured</p>
          ) : null}
        </div>
        <div className="grid gap-2">
          <Label>Gmail Nango Integration</Label>
          <Select
            value={data.gmailIntegrationId ?? undefined}
            disabled={!data.configured || inUse || integrations.isLoading}
            onValueChange={async (integrationId) => {
              try {
                await setMapping.mutateAsync({ integrationId });
                await onChanged();
                toast.success('Gmail Nango Integration enabled');
              } catch {
                toast.error('Unable to change the Gmail Nango Integration');
              }
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select a Gmail Integration" />
            </SelectTrigger>
            <SelectContent>
              {(integrations.data ?? []).map((integration) => (
                <SelectItem key={integration.integrationId} value={integration.integrationId}>
                  {integration.displayName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <p className="text-muted-foreground text-sm">
          {data.bindingCount} active mailbox {data.bindingCount === 1 ? 'binding' : 'bindings'}
          {inUse ? ' — disconnect them before changing the Base URL, mapping, or deleting.' : ''}
        </p>
        <div className="flex flex-wrap gap-3">
          <Button
            onClick={submit}
            disabled={
              save.isPending ||
              !baseUrl ||
              (inUse && !secretKey.trim()) ||
              (!data.configured && !secretKey.trim())
            }
          >
            {save.isPending ? 'Validating…' : 'Validate and save'}
          </Button>
          <ConfirmIntegrationDelete
            title="Delete Nango configuration?"
            description="This removes the global Nango service and Gmail mapping. It is allowed only when no Nango mailbox authorization remains."
            disabled={!data.configured || inUse}
            pending={remove.isPending}
            onConfirm={async () => {
              try {
                await remove.mutateAsync();
                await onChanged();
                toast.success('Nango configuration deleted');
              } catch {
                toast.error('Disconnect all Nango mailboxes before deleting this configuration');
                throw new Error('Nango configuration is in use');
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
