import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { refreshMailboxConnectionQueries } from '@/modules/mail-connections/refresh-mailbox-queries';
import { useTRPC } from '@/providers/query-provider';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { m } from '@/paraglide/messages';

type ProtocolForm = {
  email: string;
  username: string;
  password: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
};

const initialForm: ProtocolForm = {
  email: '',
  username: '',
  password: '',
  imapHost: '',
  imapPort: 993,
  imapSecure: true,
  smtpHost: '',
  smtpPort: 465,
  smtpSecure: true,
};

const ProtocolEndpointFields = ({
  prefix,
  label,
  host,
  port,
  secure,
  onHostChange,
  onPortChange,
  onSecureChange,
}: {
  prefix: 'imap' | 'smtp';
  label: string;
  host: string;
  port: number;
  secure: boolean;
  onHostChange(value: string): void;
  onPortChange(value: number): void;
  onSecureChange(value: boolean): void;
}) => (
  <fieldset className="space-y-4 rounded-lg border p-4">
    <legend className="px-1 text-sm font-semibold">{label}</legend>
    <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
      <div className="grid gap-2">
        <Label htmlFor={`${prefix}-host`}>{m['pages.settings.connections.imapSmtp.host']()}</Label>
        <Input
          id={`${prefix}-host`}
          value={host}
          autoComplete="off"
          onChange={(event) => onHostChange(event.target.value)}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor={`${prefix}-port`}>{m['pages.settings.connections.imapSmtp.port']()}</Label>
        <Input
          id={`${prefix}-port`}
          type="number"
          min={1}
          max={65_535}
          value={port}
          onChange={(event) => onPortChange(Number(event.target.value))}
        />
      </div>
    </div>
    <div className="flex items-center justify-between">
      <div>
        <Label htmlFor={`${prefix}-secure`}>
          {m['pages.settings.connections.imapSmtp.tlsFromConnectionStart']()}
        </Label>
        <p className="text-muted-foreground mt-1 text-xs">
          {m['pages.settings.connections.imapSmtp.tlsDescription']()}
        </p>
      </div>
      <Switch id={`${prefix}-secure`} checked={secure} onCheckedChange={onSecureChange} />
    </div>
  </fieldset>
);

export function ImapSmtpConnectDialog({
  open,
  onOpenChange,
  onConnected,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  onConnected(): void;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const bind = useMutation(trpc.connections.bindManualImapSmtp.mutationOptions());
  const [form, setForm] = useState<ProtocolForm>(initialForm);
  const valid =
    form.email.trim().length > 0 &&
    form.username.trim().length > 0 &&
    form.password.length > 0 &&
    form.imapHost.trim().length > 0 &&
    form.smtpHost.trim().length > 0 &&
    Number.isInteger(form.imapPort) &&
    form.imapPort >= 1 &&
    form.imapPort <= 65_535 &&
    Number.isInteger(form.smtpPort) &&
    form.smtpPort >= 1 &&
    form.smtpPort <= 65_535;

  const save = async () => {
    if (!valid) return;
    try {
      await bind.mutateAsync({
        email: form.email.trim(),
        username: form.username.trim(),
        password: form.password,
        imap: {
          host: form.imapHost.trim(),
          port: form.imapPort,
          secure: form.imapSecure,
        },
        smtp: {
          host: form.smtpHost.trim(),
          port: form.smtpPort,
          secure: form.smtpSecure,
        },
      });
      await refreshMailboxConnectionQueries(queryClient, {
        connectionList: trpc.connections.list.queryKey(),
        defaultConnection: trpc.connections.getDefault.queryKey(),
        mailAccountList: trpc.mail.account.list.queryKey(),
      });
      setForm(initialForm);
      onOpenChange(false);
      onConnected();
      toast.success(m['pages.settings.connections.imapSmtp.connected']());
    } catch (error) {
      const duplicate =
        error instanceof Error && error.message.includes('MAILBOX_ALREADY_CONNECTED');
      toast.error(
        duplicate
          ? m['pages.settings.connections.mailboxAlreadyConnected']()
          : m['pages.settings.connections.imapSmtp.connectError'](),
      );
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) setForm(initialForm);
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent showOverlay className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{m['pages.settings.connections.imapSmtp.title']()}</DialogTitle>
          <DialogDescription>
            {m['pages.settings.connections.imapSmtp.description']()}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 pt-2">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="mailbox-email">
                {m['pages.settings.connections.imapSmtp.mailboxEmail']()}
              </Label>
              <Input
                id="mailbox-email"
                type="email"
                autoComplete="email"
                value={form.email}
                onChange={(event) =>
                  setForm((current) => ({ ...current, email: event.target.value }))
                }
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="mailbox-username">
                {m['pages.settings.connections.imapSmtp.username']()}
              </Label>
              <Input
                id="mailbox-username"
                autoComplete="username"
                value={form.username}
                onChange={(event) =>
                  setForm((current) => ({ ...current, username: event.target.value }))
                }
              />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="mailbox-password">
              {m['pages.settings.connections.imapSmtp.password']()}
            </Label>
            <Input
              id="mailbox-password"
              type="password"
              autoComplete="new-password"
              value={form.password}
              onChange={(event) =>
                setForm((current) => ({ ...current, password: event.target.value }))
              }
            />
          </div>

          <ProtocolEndpointFields
            prefix="imap"
            label={m['pages.settings.connections.imapSmtp.incomingMail']()}
            host={form.imapHost}
            port={form.imapPort}
            secure={form.imapSecure}
            onHostChange={(imapHost) => setForm((current) => ({ ...current, imapHost }))}
            onPortChange={(imapPort) => setForm((current) => ({ ...current, imapPort }))}
            onSecureChange={(imapSecure) => setForm((current) => ({ ...current, imapSecure }))}
          />
          <ProtocolEndpointFields
            prefix="smtp"
            label={m['pages.settings.connections.imapSmtp.outgoingMail']()}
            host={form.smtpHost}
            port={form.smtpPort}
            secure={form.smtpSecure}
            onHostChange={(smtpHost) => setForm((current) => ({ ...current, smtpHost }))}
            onPortChange={(smtpPort) => setForm((current) => ({ ...current, smtpPort }))}
            onSecureChange={(smtpSecure) => setForm((current) => ({ ...current, smtpSecure }))}
          />

          <div className="flex justify-end">
            <Button disabled={!valid || bind.isPending} onClick={save}>
              {bind.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              {m['pages.settings.connections.imapSmtp.validateAndConnect']()}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
