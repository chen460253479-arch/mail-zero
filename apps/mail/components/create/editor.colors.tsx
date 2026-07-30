import { EditorBubbleItem, useEditor } from 'novel';
import { Check, ChevronDown } from 'lucide-react';

import { PopoverTrigger, Popover, PopoverContent } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { m } from '@/paraglide/messages';
export interface BubbleColorMenuItem {
  name: string;
  color: string;
}

const TEXT_COLORS: BubbleColorMenuItem[] = [
  {
    name: m['common.notes.colors.default'](),
    color: 'var(--novel-black)',
  },
  {
    name: m['common.notes.colors.purple'](),
    color: '#9333EA',
  },
  {
    name: m['common.notes.colors.red'](),
    color: '#E00000',
  },
  {
    name: m['common.notes.colors.yellow'](),
    color: '#EAB308',
  },
  {
    name: m['common.notes.colors.blue'](),
    color: '#2563EB',
  },
  {
    name: m['common.notes.colors.green'](),
    color: '#008A00',
  },
  {
    name: m['common.notes.colors.orange'](),
    color: '#FFA500',
  },
  {
    name: m['common.notes.colors.pink'](),
    color: '#BA4081',
  },
  {
    name: m['common.notes.colors.gray'](),
    color: '#A8A29E',
  },
];

const HIGHLIGHT_COLORS: BubbleColorMenuItem[] = [
  {
    name: m['common.notes.colors.default'](),
    color: 'var(--novel-highlight-default)',
  },
  {
    name: m['common.notes.colors.purple'](),
    color: 'var(--novel-highlight-purple)',
  },
  {
    name: m['common.notes.colors.red'](),
    color: 'var(--novel-highlight-red)',
  },
  {
    name: m['common.notes.colors.yellow'](),
    color: 'var(--novel-highlight-yellow)',
  },
  {
    name: m['common.notes.colors.blue'](),
    color: 'var(--novel-highlight-blue)',
  },
  {
    name: m['common.notes.colors.green'](),
    color: 'var(--novel-highlight-green)',
  },
  {
    name: m['common.notes.colors.orange'](),
    color: 'var(--novel-highlight-orange)',
  },
  {
    name: m['common.notes.colors.pink'](),
    color: 'var(--novel-highlight-pink)',
  },
  {
    name: m['common.notes.colors.gray'](),
    color: 'var(--novel-highlight-gray)',
  },
];

interface ColorSelectorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const ColorSelector = ({ open, onOpenChange }: ColorSelectorProps) => {
  const { editor } = useEditor();

  if (!editor) return null;
  const activeColorItem = TEXT_COLORS.find(({ color }) => editor.isActive('textStyle', { color }));

  const activeHighlightItem = HIGHLIGHT_COLORS.find(({ color }) =>
    editor.isActive('highlight', { color }),
  );

  console.log('editor', editor);

  return (
    <Popover modal={true} open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button className="gap-2 rounded-none" variant="ghost">
          <span
            className="rounded-sm px-1"
            style={{
              color: activeColorItem?.color,
              backgroundColor: activeHighlightItem?.color,
            }}
          >
            A
          </span>
          <ChevronDown className="h-4 w-4" />
        </Button>
      </PopoverTrigger>

      <PopoverContent
        sideOffset={5}
        className="my-1 flex max-h-80 w-48 flex-col overflow-hidden overflow-y-auto rounded border p-1 shadow-xl"
        align="start"
      >
        <div className="flex flex-col">
          <div className="text-muted-foreground my-1 px-2 text-sm font-semibold">
            {m['pages.createEmail.editor.menuBar.color']()}
          </div>
          {TEXT_COLORS.map(({ name, color }) => (
            <EditorBubbleItem
              key={name}
              onSelect={() => {
                // editor.commands.unsetColor();
                name !== 'Default' &&
                  editor
                    .chain()
                    .focus()
                    .setColor(color || '')
                    .run();
              }}
              className="hover:bg-accent flex cursor-pointer items-center justify-between px-2 py-1 text-sm"
            >
              <div className="flex items-center gap-2">
                <div className="rounded-sm border px-2 py-px font-medium" style={{ color }}>
                  A
                </div>
                <span>{name}</span>
              </div>
            </EditorBubbleItem>
          ))}
        </div>
        <div>
          <div className="text-muted-foreground my-1 px-2 text-sm font-semibold">
            {m['pages.createEmail.editor.menuBar.background']()}
          </div>
          {HIGHLIGHT_COLORS.map(({ name, color }) => (
            <EditorBubbleItem
              key={name}
              onSelect={() => {
                editor.commands.unsetHighlight();
                name !== 'Default' && editor.commands.setHighlight({ color });
              }}
              className="hover:bg-accent flex cursor-pointer items-center justify-between px-2 py-1 text-sm"
            >
              <div className="flex items-center gap-2">
                <div
                  className="rounded-sm border px-2 py-px font-medium"
                  style={{ backgroundColor: color }}
                >
                  A
                </div>
                <span>{name}</span>
              </div>
              {editor.isActive('highlight', { color }) && <Check className="h-4 w-4" />}
            </EditorBubbleItem>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
};
