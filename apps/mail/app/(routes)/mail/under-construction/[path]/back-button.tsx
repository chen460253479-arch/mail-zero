import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import { m } from '@/paraglide/messages';

export default function BackButton() {
  return (
    <a href="/mail">
      <Button variant="outline" className="text-muted-foreground gap-2">
        <ArrowLeft className="h-4 w-4" />
        {m['pages.underConstruction.goBack']()}
      </Button>
    </a>
  );
}
