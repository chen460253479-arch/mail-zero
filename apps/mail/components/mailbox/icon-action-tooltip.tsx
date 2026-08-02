import type { ReactElement } from 'react';

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export function shouldShowIconActionTooltip(label?: string) {
  return !label;
}

export function IconActionTooltip({
  label,
  tooltip,
  children,
}: {
  label?: string;
  tooltip: string;
  children: ReactElement;
}) {
  if (!shouldShowIconActionTooltip(label)) return children;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="bottom">{tooltip}</TooltipContent>
    </Tooltip>
  );
}
