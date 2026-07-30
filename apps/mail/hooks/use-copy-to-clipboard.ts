import { useState } from 'react';
import { toast } from 'sonner';
import { m } from '@/paraglide/messages';

export function useCopyToClipboard(resetDelay = 2000) {
  const [copiedValue, setCopiedValue] = useState<string | null>(null);
  
  const copyToClipboard = (value: string, id: string) => {
    navigator.clipboard.writeText(value);
    setCopiedValue(id);
    toast.success(m['common.actions.linkCopied']());
    
    setTimeout(() => {
      setCopiedValue(null);
    }, resetDelay);
  };
  
  return { copiedValue, copyToClipboard };
}
