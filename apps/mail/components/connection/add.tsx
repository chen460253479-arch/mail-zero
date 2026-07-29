import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../ui/dialog';
import {
  resolveChannelConnectAction,
  type ConnectableMailChannelId,
} from '@/modules/mail-connections/connect-mode';
import { ImapSmtpConnectDialog } from './imap-smtp-connect-dialog';
import { NangoConnectDialog } from './nango-connect-dialog';
import { useQueryClient } from '@tanstack/react-query';
import { useTRPC } from '@/providers/query-provider';
import { emailProviders } from '@/lib/constants';
import { Loader2, UserPlus } from 'lucide-react';
import { m } from '@/paraglide/messages';
import { motion } from 'motion/react';
import { Button } from '../ui/button';
import { cn } from '@/lib/utils';
import { useState } from 'react';
import { toast } from 'sonner';

export const AddConnectionDialog = ({
  children,
  className,
  onConnected,
  onOpenChange,
}: {
  children?: React.ReactNode;
  className?: string;
  onConnected?: () => void;
  onOpenChange?: (open: boolean) => void;
}) => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [pendingChannelId, setPendingChannelId] = useState<ConnectableMailChannelId | null>(null);
  const [nangoChannelId, setNangoChannelId] = useState<ConnectableMailChannelId | null>(null);
  const [manualOpen, setManualOpen] = useState(false);

  const setDialogOpen = (nextOpen: boolean) => {
    setOpen(nextOpen);
    onOpenChange?.(nextOpen);
  };

  const connectChannel = async (channelId: ConnectableMailChannelId) => {
    setPendingChannelId(channelId);
    try {
      const options = await queryClient.fetchQuery(
        trpc.connections.getChannelAuthorizationOptions.queryOptions({ channelId }),
      );
      const action = resolveChannelConnectAction(channelId, options.mode);
      if (action.type === 'redirect') {
        const baseUrl = import.meta.env.VITE_PUBLIC_BACKEND_URL.replace(/\/+$/, '');
        window.location.assign(`${baseUrl}${action.path}`);
        return;
      }
      if (action.type === 'nango') {
        setDialogOpen(false);
        setNangoChannelId(action.channelId);
        return;
      }
      if (action.type === 'manual') {
        setDialogOpen(false);
        setManualOpen(true);
        return;
      }
      toast.error(
        `${emailProviders.find((provider) => provider.channelId === channelId)?.name} is not configured`,
      );
    } catch {
      toast.error('Unable to load mail channel configuration');
    } finally {
      setPendingChannelId(null);
    }
  };

  const completeConnection = () => {
    setDialogOpen(false);
    onConnected?.();
  };

  return (
    <>
      <Dialog open={open} onOpenChange={setDialogOpen}>
        <DialogTrigger asChild>
          {children || (
            <Button
              size={'dropdownItem'}
              variant={'dropdownItem'}
              className={cn('w-full justify-start gap-2', className)}
            >
              <UserPlus size={16} strokeWidth={2} className="opacity-60" aria-hidden="true" />
              <p className="text-[13px] opacity-60">{m['pages.settings.connections.addEmail']()}</p>
            </Button>
          )}
        </DialogTrigger>
        <DialogContent showOverlay={true}>
          <DialogHeader>
            <DialogTitle>{m['pages.settings.connections.connectEmail']()}</DialogTitle>
            <DialogDescription>
              {m['pages.settings.connections.connectEmailDescription']()}
            </DialogDescription>
          </DialogHeader>
          <motion.div
            className="mt-4 grid grid-cols-2 gap-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3 }}
          >
            {emailProviders.map((provider, index) => {
              const Icon = provider.icon;
              const pending = pendingChannelId === provider.channelId;
              return (
                <motion.div
                  key={provider.channelId}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.1, duration: 0.3 }}
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.97 }}
                >
                  <Button
                    variant="outline"
                    className="relative h-24 w-full flex-col items-center justify-center gap-2"
                    disabled={pendingChannelId !== null}
                    onClick={() => connectChannel(provider.channelId)}
                  >
                    {pending ? (
                      <Loader2 className="size-6 animate-spin" />
                    ) : (
                      <Icon className="size-6!" />
                    )}
                    <span className="text-xs">{provider.name}</span>
                  </Button>
                </motion.div>
              );
            })}
          </motion.div>
        </DialogContent>
      </Dialog>
      <NangoConnectDialog
        channelId={nangoChannelId}
        open={nangoChannelId !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setNangoChannelId(null);
        }}
        onConnected={completeConnection}
      />
      <ImapSmtpConnectDialog
        open={manualOpen}
        onOpenChange={setManualOpen}
        onConnected={completeConnection}
      />
    </>
  );
};
