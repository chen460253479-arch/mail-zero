import { ContactRound } from 'lucide-react';

import type { Label } from '@/types';
import { cn } from '@/lib/utils';

export function CustomerMarkerBadge({
  label,
  className,
}: {
  label: Pick<Label, 'name'>;
  className?: string;
}) {
  return (
    <span
      role="img"
      aria-label={label.name}
      title={label.name}
      data-customer-marker="true"
      className={cn(
        'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-[#D1F0D9] bg-[#EDF8F0] text-[#12341D] dark:border-[#285C36] dark:bg-[#12341D] dark:text-[#D1F0D9]',
        className,
      )}
    >
      <ContactRound aria-hidden="true" className="h-3.5 w-3.5" />
    </span>
  );
}
