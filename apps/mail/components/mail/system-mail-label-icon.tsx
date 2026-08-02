import { Star } from 'lucide-react';

import { Lightning } from '../icons/icons';

export function getSystemMailLabelIcon(label: string) {
  const normalizedLabel = label.toLowerCase().replace(/^category_/i, '');

  switch (normalizedLabel) {
    case 'starred':
      return <Star className="h-[12px] w-[12px] fill-yellow-400 stroke-yellow-400" />;
    case 'important':
      return <Lightning className="h-[12px] w-[12px] fill-orange-400" />;
    default:
      return null;
  }
}

export function SystemMailLabelIcon({ label }: { label: string }) {
  return getSystemMailLabelIcon(label);
}
