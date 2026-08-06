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
      data-customer-marker="true"
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-md border-0 bg-transparent p-1 text-[#2F6B3D] dark:text-[#7FC890]',
        className,
      )}
    >
      <ContactRound aria-hidden="true" className="h-[12px] w-[12px]" />
    </span>
  );
}
