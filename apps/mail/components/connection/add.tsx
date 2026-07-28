import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../ui/dialog';
import { GmailConnectDialog } from './gmail-connect-dialog';
import { useTRPC } from '@/providers/query-provider';
import { useQuery } from '@tanstack/react-query';
import { emailProviders } from '@/lib/constants';
import { Plus, UserPlus } from 'lucide-react';
import { m } from '@/paraglide/messages';
import { motion } from 'motion/react';
import { Button } from '../ui/button';
import { cn } from '@/lib/utils';
import { useState } from 'react';

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
  const [open, setOpen] = useState(false);
  const [gmailOpen, setGmailOpen] = useState(false);
  const options = useQuery(
    trpc.connections.getGmailAuthorizationOptions.queryOptions(undefined, { enabled: open }),
  );

  const setDialogOpen = (nextOpen: boolean) => {
    setOpen(nextOpen);
    onOpenChange?.(nextOpen);
  };

  const connectGmail = () => {
    if (!options.data) return;
    if (options.data.mode === 'zero_oauth') {
      const baseUrl = import.meta.env.VITE_PUBLIC_BACKEND_URL.replace(/\/+$/, '');
      window.location.assign(`${baseUrl}/api/integrations/gmail/connect/start`);
      return;
    }
    if (options.data.mode === 'nango') {
      setDialogOpen(false);
      setGmailOpen(true);
    }
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
              return (
                <motion.div
                  key={provider.name}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.1, duration: 0.3 }}
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.97 }}
                >
                  <Button
                    variant="outline"
                    className="relative h-24 w-full flex-col items-center justify-center gap-2"
                    disabled={options.isLoading || options.data?.mode === 'unavailable'}
                    onClick={connectGmail}
                  >
                    <Icon className="size-6!" />
                    <span className="text-xs">{provider.name}</span>
                  </Button>
                </motion.div>
              );
            })}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                delay: emailProviders.length * 0.1,
                duration: 0.3,
              }}
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
            >
              <Button
                variant="outline"
                className="h-24 w-full flex-col items-center justify-center gap-2 border-dashed"
              >
                <Plus className="h-12 w-12" />
                <span className="text-xs">{m['pages.settings.connections.moreComingSoon']()}</span>
              </Button>
            </motion.div>
          </motion.div>
          {options.data?.mode === 'unavailable' ? (
            <p className="text-muted-foreground mt-3 text-sm">
              Gmail authorization has not been configured by an administrator.
            </p>
          ) : null}
        </DialogContent>
      </Dialog>
      <GmailConnectDialog
        open={gmailOpen}
        onOpenChange={setGmailOpen}
        onConnected={() => {
          setDialogOpen(false);
          onConnected?.();
        }}
      />
    </>
  );
};
