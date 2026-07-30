import { EditorProvider, useCurrentEditor } from '@tiptap/react';
import React from 'react';
import { m } from '@/paraglide/messages';

const MenuBar = () => {
  const { editor } = useCurrentEditor();

  if (!editor) {
    return null;
  }

  return (
    <div className="control-group">
      <div className="button-group">
        <button
          onClick={() => editor.chain().focus().toggleBold().run()}
          disabled={!editor.can().chain().focus().toggleBold().run()}
          className={editor.isActive('bold') ? 'is-active' : ''}
        >
          {m['pages.createEmail.editor.menuBar.bold']()}
        </button>
        <button
          onClick={() => editor.chain().focus().toggleItalic().run()}
          disabled={!editor.can().chain().focus().toggleItalic().run()}
          className={editor.isActive('italic') ? 'is-active' : ''}
        >
          {m['pages.createEmail.editor.menuBar.italic']()}
        </button>
        <button
          onClick={() => editor.chain().focus().toggleStrike().run()}
          disabled={!editor.can().chain().focus().toggleStrike().run()}
          className={editor.isActive('strike') ? 'is-active' : ''}
        >
          {m['pages.createEmail.editor.menuBar.strikethrough']()}
        </button>
        <button
          onClick={() => editor.chain().focus().toggleCode().run()}
          disabled={!editor.can().chain().focus().toggleCode().run()}
          className={editor.isActive('code') ? 'is-active' : ''}
        >
          {m['pages.createEmail.editor.menuBar.code']()}
        </button>
        <button onClick={() => editor.chain().focus().unsetAllMarks().run()}>
          {m['pages.createEmail.editor.menuBar.clearMarks']()}
        </button>
        <button onClick={() => editor.chain().focus().clearNodes().run()}>
          {m['pages.createEmail.editor.menuBar.clearNodes']()}
        </button>
        <button
          onClick={() => editor.chain().focus().setParagraph().run()}
          className={editor.isActive('paragraph') ? 'is-active' : ''}
        >
          {m['pages.createEmail.editor.menuBar.paragraph']()}
        </button>
        <button
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          className={editor.isActive('heading', { level: 1 }) ? 'is-active' : ''}
        >
          H1
        </button>
        <button
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          className={editor.isActive('heading', { level: 2 }) ? 'is-active' : ''}
        >
          H2
        </button>
        <button
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          className={editor.isActive('heading', { level: 3 }) ? 'is-active' : ''}
        >
          H3
        </button>
        <button
          onClick={() => editor.chain().focus().toggleHeading({ level: 4 }).run()}
          className={editor.isActive('heading', { level: 4 }) ? 'is-active' : ''}
        >
          H4
        </button>
        <button
          onClick={() => editor.chain().focus().toggleHeading({ level: 5 }).run()}
          className={editor.isActive('heading', { level: 5 }) ? 'is-active' : ''}
        >
          H5
        </button>
        <button
          onClick={() => editor.chain().focus().toggleHeading({ level: 6 }).run()}
          className={editor.isActive('heading', { level: 6 }) ? 'is-active' : ''}
        >
          H6
        </button>
        <button
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          className={editor.isActive('bulletList') ? 'is-active' : ''}
        >
          {m['pages.createEmail.editor.menuBar.bulletList']()}
        </button>
        <button
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          className={editor.isActive('orderedList') ? 'is-active' : ''}
        >
          {m['pages.createEmail.editor.menuBar.orderedList']()}
        </button>
        <button
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
          className={editor.isActive('codeBlock') ? 'is-active' : ''}
        >
          {m['pages.createEmail.editor.menuBar.codeBlock']()}
        </button>
        <button
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          className={editor.isActive('blockquote') ? 'is-active' : ''}
        >
          {m['pages.createEmail.editor.menuBar.blockquote']()}
        </button>
        <button onClick={() => editor.chain().focus().setHorizontalRule().run()}>
          {m['pages.createEmail.editor.menuBar.horizontalRule']()}
        </button>
        <button onClick={() => editor.chain().focus().setHardBreak().run()}>
          {m['pages.createEmail.editor.menuBar.hardBreak']()}
        </button>
        <button
          onClick={() => editor.chain().focus().undo().run()}
          disabled={!editor.can().chain().focus().undo().run()}
        >
          {m['pages.createEmail.editor.menuBar.undo']()}
        </button>
        <button
          onClick={() => editor.chain().focus().redo().run()}
          disabled={!editor.can().chain().focus().redo().run()}
        >
          {m['pages.createEmail.editor.menuBar.redo']()}
        </button>
        <button
          onClick={() => editor.chain().focus().setColor('#958DF1').run()}
          className={editor.isActive('textStyle', { color: '#958DF1' }) ? 'is-active' : ''}
        >
          {m['pages.createEmail.editor.menuBar.purple']()}
        </button>
      </div>
    </div>
  );
};

export default () => {
  return <EditorProvider slotBefore={<MenuBar />}></EditorProvider>;
};
