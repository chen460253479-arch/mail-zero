import { getUserWorkspace } from './server-utils';
import { note } from '../db/schema';

export class NotesManager {
  constructor() {}

  async getThreadNotes(
    userId: string,
    connectionId: string,
    threadId: string,
  ): Promise<(typeof note.$inferSelect)[]> {
    const db = getUserWorkspace(userId);
    return await db.findManyNotesByThreadId(connectionId, threadId);
  }

  async createNote(
    userId: string,
    connectionId: string,
    threadId: string,
    content: string,
    color: string = 'default',
    isPinned: boolean = false,
  ): Promise<typeof note.$inferSelect> {
    try {
      const db = getUserWorkspace(userId);
      const highestOrder = await db.findHighestNoteOrder(connectionId);

      const id = crypto.randomUUID();
      const result = await db.createNote(connectionId, {
        id,
        threadId,
        content,
        color,
        isPinned,
        order: (highestOrder?.order ?? 0) + 1,
      });
      if (!result || result.length === 0) {
        throw new Error('Failed to create note');
      }
      return result[0];
    } catch (error) {
      console.error('Error creating note:', error);
      throw error;
    }
  }

  async updateNote(
    userId: string,
    connectionId: string,
    noteId: string,
    data: Partial<
      Omit<
        typeof note.$inferSelect,
        'id' | 'userId' | 'connectionId' | 'threadId' | 'createdAt' | 'updatedAt'
      >
    >,
  ): Promise<typeof note.$inferSelect> {
    const db = getUserWorkspace(userId);
    const existingNote = await db.findNoteById(connectionId, noteId);

    if (!existingNote) {
      throw new Error('Note not found or unauthorized');
    }

    const result = await db.updateNote(connectionId, noteId, data);

    if (!result) {
      throw new Error('Failed to update note');
    }
    return result;
  }

  async deleteNote(userId: string, connectionId: string, noteId: string) {
    const db = getUserWorkspace(userId);
    try {
      await db.deleteNote(connectionId, noteId);
      return true;
    } catch (error) {
      console.error('Error deleting note:', error);
      return false;
    }
  }

  async reorderNotes(
    userId: string,
    connectionId: string,
    notes: { id: string; order: number; isPinned?: boolean | null }[],
  ): Promise<boolean> {
    if (!notes || notes.length === 0) {
      return true;
    }

    const noteIds = notes.map((n) => n.id);

    const db = getUserWorkspace(userId);
    const userNotes = await db.findManyNotesByIds(connectionId, noteIds);

    const foundNoteIds = new Set(userNotes.map((n) => n.id));

    if (foundNoteIds.size !== noteIds.length) {
      const missingNotes = noteIds.filter((id) => !foundNoteIds.has(id));
      console.error(`Notes not found or unauthorized: ${missingNotes.join(', ')}`);
      throw new Error('One or more notes not found or unauthorized');
    }

    return await db.updateManyNotes(connectionId, notes);
  }
}
