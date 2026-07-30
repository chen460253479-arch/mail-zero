import { ArrowRight } from 'lucide-react';
import type { ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { m } from '@/paraglide/messages';

export function ChannelCard({
  title,
  description,
  icon,
  available,
  configured,
  onOpen,
}: {
  title: string;
  description: string;
  icon: ReactNode;
  available: boolean;
  configured: boolean;
  onOpen?(): void;
}) {
  return (
    <button
      type="button"
      disabled={!available}
      onClick={onOpen}
      className={cn(
        'bg-card flex min-h-48 w-full flex-col rounded-xl border p-5 text-left shadow-sm',
        'enabled:hover:border-primary/40 enabled:hover:bg-muted/20 transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-60',
      )}
    >
      <div className="flex w-full items-start justify-between gap-4">
        <div className="bg-background flex size-11 items-center justify-center rounded-lg border">
          {icon}
        </div>
        <Badge variant={configured ? 'default' : 'outline'}>
          {configured
            ? m['pages.settings.integrations.configured']()
            : available
              ? m['pages.settings.integrations.notConfigured']()
              : m['pages.settings.integrations.comingSoon']()}
        </Badge>
      </div>
      <div className="mt-6 flex-1">
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-muted-foreground mt-1 text-sm">{description}</p>
      </div>
      {available ? (
        <span className="mt-5 flex items-center gap-2 text-sm font-medium">
          {m['pages.settings.integrations.configure']()}
          <ArrowRight className="size-4" />
        </span>
      ) : null}
    </button>
  );
}
