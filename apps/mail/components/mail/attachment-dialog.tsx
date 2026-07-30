import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Download, ExternalLink } from 'lucide-react';
import { Button } from '../ui/button';
import { m } from '@/paraglide/messages';

type Props = {
  selectedAttachment: null | {
    id: string;
    name: string;
    type: string;
    url: string;
  };
  setSelectedAttachment: (
    attachment: null | {
      id: string;
      name: string;
      type: string;
      url: string;
    },
  ) => void;
};

const AttachmentDialog = ({ selectedAttachment, setSelectedAttachment }: Props) => {
  return (
    <Dialog
      open={!!selectedAttachment}
      onOpenChange={(open) => !open && setSelectedAttachment(null)}
    >
      <DialogContent className="max-w-4xl!">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <span>{selectedAttachment?.name}</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" asChild>
                <a
                  href={selectedAttachment?.url}
                  download
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Download className="mr-1 h-4 w-4" />
                  {m['common.mail.download']()}
                </a>
              </Button>
              <Button variant="outline" size="sm" asChild>
                <a href={selectedAttachment?.url} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="mr-1 h-4 w-4" />
                  {m['common.mail.open']()}
                </a>
              </Button>
            </div>
          </DialogTitle>
        </DialogHeader>
        <div className="bg-muted mt-4 flex min-h-[300px] items-center justify-center rounded-md p-4">
          {selectedAttachment?.type === 'image' ? (
            <img
              src={selectedAttachment.url || '/placeholder.svg'}
              alt={selectedAttachment.name}
              className="max-h-[500px] max-w-full object-contain"
            />
          ) : (
            <div className="text-center">
              <div className="mb-4 text-6xl">
                {selectedAttachment?.type === 'pdf' && '📄'}
                {selectedAttachment?.type === 'excel' && '📊'}
                {selectedAttachment?.type === 'word' && '📝'}
                {selectedAttachment &&
                  !['pdf', 'excel', 'word', 'image'].includes(selectedAttachment.type) &&
                  '📎'}
              </div>
              <p className="text-muted-foreground">{m['common.mail.previewNotAvailable']()}</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default AttachmentDialog;
