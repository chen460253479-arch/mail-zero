import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NotesManager } from './notes-manager';
import { getZeroDB } from './server-utils';

vi.mock('./server-utils', () => ({
  getZeroDB: vi.fn(),
}));

const storedNote = {
  id: 'note-1',
  userId: 'user-1',
  connectionId: 'connection-1',
  threadId: 'thread-1',
  content: 'content',
  color: 'default',
  isPinned: false,
  order: 1,
  createdAt: new Date('2026-07-26T00:00:00.000Z'),
  updatedAt: new Date('2026-07-26T00:00:00.000Z'),
};

const createDatabase = () => ({
  findManyNotesByThreadId: vi.fn().mockResolvedValue([storedNote]),
  findHighestNoteOrder: vi.fn().mockResolvedValue({ order: 4 }),
  createNote: vi.fn().mockResolvedValue([storedNote]),
  findNoteById: vi.fn().mockResolvedValue(storedNote),
  updateNote: vi.fn().mockResolvedValue(storedNote),
  deleteNote: vi.fn().mockResolvedValue(undefined),
  findManyNotesByIds: vi.fn().mockResolvedValue([storedNote]),
  updateManyNotes: vi.fn().mockResolvedValue(true),
});

describe('NotesManager Connection isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes the authenticated Connection to list and create operations', async () => {
    const db = createDatabase();
    vi.mocked(getZeroDB).mockResolvedValue(db as never);
    const manager = new NotesManager();

    await manager.getThreadNotes('user-1', 'connection-1', 'thread-1');
    await manager.createNote('user-1', 'connection-1', 'thread-1', 'content');

    expect(db.findManyNotesByThreadId).toHaveBeenCalledWith('connection-1', 'thread-1');
    expect(db.findHighestNoteOrder).toHaveBeenCalledWith('connection-1');
    expect(db.createNote).toHaveBeenCalledWith(
      'connection-1',
      expect.objectContaining({ threadId: 'thread-1', order: 5 }),
    );
  });

  it('passes the authenticated Connection to update and delete operations', async () => {
    const db = createDatabase();
    vi.mocked(getZeroDB).mockResolvedValue(db as never);
    const manager = new NotesManager();

    await manager.updateNote('user-1', 'connection-1', 'note-1', { content: 'updated' });
    await manager.deleteNote('user-1', 'connection-1', 'note-1');

    expect(db.findNoteById).toHaveBeenCalledWith('connection-1', 'note-1');
    expect(db.updateNote).toHaveBeenCalledWith('connection-1', 'note-1', {
      content: 'updated',
    });
    expect(db.deleteNote).toHaveBeenCalledWith('connection-1', 'note-1');
  });

  it('authorizes and updates every reorder within the authenticated Connection', async () => {
    const db = createDatabase();
    vi.mocked(getZeroDB).mockResolvedValue(db as never);
    const manager = new NotesManager();
    const reordered = [{ id: 'note-1', order: 2 }];

    await expect(manager.reorderNotes('user-1', 'connection-1', reordered)).resolves.toBe(true);
    expect(db.findManyNotesByIds).toHaveBeenCalledWith('connection-1', ['note-1']);
    expect(db.updateManyNotes).toHaveBeenCalledWith('connection-1', reordered);
  });
});
