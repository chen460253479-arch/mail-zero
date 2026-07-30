import {
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Text,
  } from 'lucide-react';
import { createSuggestionItems } from 'novel';
import { m } from '@/paraglide/messages';

export const suggestionItems = createSuggestionItems([
  {
    title: m['pages.createEmail.slashCommand.text'](),
    description: m['pages.createEmail.slashCommand.textDescription'](),
    searchTerms: ['p', 'paragraph'],
    icon: <Text size={18} />,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleNode('paragraph', 'paragraph').run();
    },
  },

  {
    title: m['pages.createEmail.editor.menuBar.heading1'](),
    description: m['pages.createEmail.slashCommand.heading1Description'](),
    searchTerms: ['title', 'big', 'large'],
    icon: <Heading1 size={18} />,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setNode('heading', { level: 1 }).run();
    },
  },
  {
    title: m['pages.createEmail.editor.menuBar.heading2'](),
    description: m['pages.createEmail.slashCommand.heading2Description'](),
    searchTerms: ['subtitle', 'medium'],
    icon: <Heading2 size={18} />,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setNode('heading', { level: 2 }).run();
    },
  },
  {
    title: m['pages.createEmail.editor.menuBar.heading3'](),
    description: m['pages.createEmail.slashCommand.heading3Description'](),
    searchTerms: ['subtitle', 'small'],
    icon: <Heading3 size={18} />,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setNode('heading', { level: 3 }).run();
    },
  },
  {
    title: m['pages.createEmail.editor.menuBar.bulletList'](),
    description: m['pages.createEmail.slashCommand.bulletListDescription'](),
    searchTerms: ['unordered', 'point'],
    icon: <List size={18} />,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleBulletList().run();
    },
  },
  {
    title: m['pages.createEmail.slashCommand.numberedList'](),
    description: m['pages.createEmail.slashCommand.numberedListDescription'](),
    searchTerms: ['ordered'],
    icon: <ListOrdered size={18} />,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleOrderedList().run();
    },
  },
]);
