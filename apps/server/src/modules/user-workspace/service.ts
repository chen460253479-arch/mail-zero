import { and, asc, desc, eq, inArray } from 'drizzle-orm';

import {
  account,
  emailTemplate,
  note,
  session,
  user,
  userHotkeys,
  userSettings,
} from '../../db/schema';
import { defaultUserSettings } from '../../lib/schemas';
import type { DB } from '../../db';

type UserRecord = typeof user.$inferSelect;
type UserUpdate = Partial<typeof user.$inferInsert>;
type NoteRecord = typeof note.$inferSelect;
type NoteInsert = typeof note.$inferInsert;
type NoteCreate = Omit<NoteInsert, 'userId' | 'connectionId' | 'createdAt' | 'updatedAt'>;
type NoteUpdate = Partial<Omit<NoteInsert, 'userId' | 'connectionId' | 'createdAt' | 'updatedAt'>>;
type NoteOrderUpdate = { id: string; order: number; isPinned?: boolean | null };
type SettingsRecord = typeof userSettings.$inferSelect;
type UserSettings = typeof defaultUserSettings;
type HotkeyRecord = typeof userHotkeys.$inferSelect;
type TemplateRecord = typeof emailTemplate.$inferSelect;
type TemplateInsert = typeof emailTemplate.$inferInsert;
type TemplateCreate = Omit<TemplateInsert, 'userId' | 'createdAt' | 'updatedAt'>;
type TemplateUpdate = Partial<Omit<TemplateInsert, 'id' | 'userId' | 'createdAt' | 'updatedAt'>>;

export const userDeletionOrder = ['accounts', 'sessions', 'settings', 'user', 'hotkeys'] as const;

export type UserDeletionTarget = (typeof userDeletionOrder)[number];

export type UserWorkspaceStore = {
  findUser(userId: string): Promise<UserRecord | undefined>;
  updateUser(userId: string, data: UserUpdate): Promise<unknown>;
  findManyNotesByThreadId(
    userId: string,
    connectionId: string,
    threadId: string,
  ): Promise<NoteRecord[]>;
  createNote(value: NoteInsert): Promise<NoteRecord[]>;
  updateNote(
    userId: string,
    connectionId: string,
    noteId: string,
    payload: NoteUpdate,
    updatedAt: Date,
  ): Promise<NoteRecord | undefined>;
  updateManyNotes(
    userId: string,
    connectionId: string,
    notes: NoteOrderUpdate[],
    updatedAt: Date,
  ): Promise<boolean>;
  findManyNotesByIds(
    userId: string,
    connectionId: string,
    noteIds: string[],
  ): Promise<NoteRecord[]>;
  deleteNote(userId: string, connectionId: string, noteId: string): Promise<unknown>;
  findNoteById(
    userId: string,
    connectionId: string,
    noteId: string,
  ): Promise<NoteRecord | undefined>;
  findHighestNoteOrder(
    userId: string,
    connectionId: string,
  ): Promise<{ order: number } | undefined>;
  deleteUser(userId: string, order: readonly UserDeletionTarget[]): Promise<void>;
  findUserSettings(userId: string): Promise<SettingsRecord | undefined>;
  findUserHotkeys(userId: string): Promise<HotkeyRecord[]>;
  upsertUserHotkeys(userId: string, shortcuts: unknown, now: Date): Promise<unknown>;
  insertUserSettings(
    userId: string,
    id: string,
    settings: UserSettings,
    now: Date,
  ): Promise<unknown>;
  upsertUserSettings(
    userId: string,
    id: string,
    settings: UserSettings,
    now: Date,
  ): Promise<unknown>;
  listEmailTemplates(userId: string): Promise<TemplateRecord[]>;
  createEmailTemplate(value: TemplateInsert): Promise<TemplateRecord[]>;
  deleteEmailTemplate(userId: string, templateId: string): Promise<unknown>;
  updateEmailTemplate(
    userId: string,
    templateId: string,
    data: TemplateUpdate,
    updatedAt: Date,
  ): Promise<TemplateRecord[]>;
};

const omitWorkspaceOwnership = <T extends Record<string, unknown>>(payload: T) => {
  const {
    userId: _userId,
    connectionId: _connectionId,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    ...safe
  } = payload;
  return safe;
};

const omitTemplateIdentity = <T extends Record<string, unknown>>(payload: T) => {
  const {
    id: _id,
    userId: _userId,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    ...safe
  } = payload;
  return safe;
};

export const createPostgresUserWorkspaceStore = (db: DB): UserWorkspaceStore => ({
  async findUser(userId) {
    return await db.query.user.findFirst({ where: eq(user.id, userId) });
  },

  async updateUser(userId, data) {
    return await db.update(user).set(data).where(eq(user.id, userId));
  },

  async findManyNotesByThreadId(userId, connectionId, threadId) {
    return await db.query.note.findMany({
      where: and(
        eq(note.userId, userId),
        eq(note.connectionId, connectionId),
        eq(note.threadId, threadId),
      ),
      orderBy: [desc(note.isPinned), asc(note.order), desc(note.createdAt)],
    });
  },

  async createNote(value) {
    return await db.insert(note).values(value).returning();
  },

  async updateNote(userId, connectionId, noteId, payload, updatedAt) {
    const [updated] = await db
      .update(note)
      .set({ ...payload, updatedAt })
      .where(and(eq(note.id, noteId), eq(note.userId, userId), eq(note.connectionId, connectionId)))
      .returning();
    return updated;
  },

  async updateManyNotes(userId, connectionId, notesToUpdate, updatedAt) {
    return await db.transaction(async (tx) => {
      for (const noteToUpdate of notesToUpdate) {
        const updateData: Partial<typeof note.$inferInsert> = {
          order: noteToUpdate.order,
          updatedAt,
        };
        if (noteToUpdate.isPinned !== undefined) {
          updateData.isPinned = noteToUpdate.isPinned;
        }
        await tx
          .update(note)
          .set(updateData)
          .where(
            and(
              eq(note.id, noteToUpdate.id),
              eq(note.userId, userId),
              eq(note.connectionId, connectionId),
            ),
          );
      }
      return true;
    });
  },

  async findManyNotesByIds(userId, connectionId, noteIds) {
    return await db.query.note.findMany({
      where: and(
        eq(note.userId, userId),
        eq(note.connectionId, connectionId),
        inArray(note.id, noteIds),
      ),
    });
  },

  async deleteNote(userId, connectionId, noteId) {
    return await db
      .delete(note)
      .where(
        and(eq(note.id, noteId), eq(note.userId, userId), eq(note.connectionId, connectionId)),
      );
  },

  async findNoteById(userId, connectionId, noteId) {
    return await db.query.note.findFirst({
      where: and(eq(note.id, noteId), eq(note.userId, userId), eq(note.connectionId, connectionId)),
    });
  },

  async findHighestNoteOrder(userId, connectionId) {
    return await db.query.note.findFirst({
      where: and(eq(note.userId, userId), eq(note.connectionId, connectionId)),
      orderBy: desc(note.order),
      columns: { order: true },
    });
  },

  async deleteUser(userId, order) {
    await db.transaction(async (tx) => {
      for (const target of order) {
        switch (target) {
          case 'accounts':
            await tx.delete(account).where(eq(account.userId, userId));
            break;
          case 'sessions':
            await tx.delete(session).where(eq(session.userId, userId));
            break;
          case 'settings':
            await tx.delete(userSettings).where(eq(userSettings.userId, userId));
            break;
          case 'user':
            await tx.delete(user).where(eq(user.id, userId));
            break;
          case 'hotkeys':
            await tx.delete(userHotkeys).where(eq(userHotkeys.userId, userId));
            break;
        }
      }
    });
  },

  async findUserSettings(userId) {
    return await db.query.userSettings.findFirst({
      where: eq(userSettings.userId, userId),
    });
  },

  async findUserHotkeys(userId) {
    return await db.query.userHotkeys.findMany({
      where: eq(userHotkeys.userId, userId),
    });
  },

  async upsertUserHotkeys(userId, shortcuts, now) {
    return await db
      .insert(userHotkeys)
      .values({ userId, shortcuts, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: userHotkeys.userId,
        set: { shortcuts, updatedAt: now },
      });
  },

  async insertUserSettings(userId, id, settings, now) {
    return await db.insert(userSettings).values({
      id,
      userId,
      settings,
      createdAt: now,
      updatedAt: now,
    });
  },

  async upsertUserSettings(userId, id, settings, now) {
    return await db
      .insert(userSettings)
      .values({ id, userId, settings, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: userSettings.userId,
        set: { settings, updatedAt: now },
      });
  },

  async listEmailTemplates(userId) {
    return await db.query.emailTemplate.findMany({
      where: eq(emailTemplate.userId, userId),
      orderBy: desc(emailTemplate.updatedAt),
    });
  },

  async createEmailTemplate(value) {
    return await db.insert(emailTemplate).values(value).returning();
  },

  async deleteEmailTemplate(userId, templateId) {
    return await db
      .delete(emailTemplate)
      .where(and(eq(emailTemplate.id, templateId), eq(emailTemplate.userId, userId)));
  },

  async updateEmailTemplate(userId, templateId, data, updatedAt) {
    return await db
      .update(emailTemplate)
      .set({ ...data, updatedAt })
      .where(and(eq(emailTemplate.id, templateId), eq(emailTemplate.userId, userId)))
      .returning();
  },
});

export type UserWorkspaceServiceOptions = {
  db?: DB;
  store?: UserWorkspaceStore;
  now?: () => Date;
  randomUUID?: () => string;
};

export const createUserWorkspaceService = ({
  db,
  store = db ? createPostgresUserWorkspaceStore(db) : undefined,
  now = () => new Date(),
  randomUUID = () => crypto.randomUUID(),
}: UserWorkspaceServiceOptions) => {
  if (!store) {
    throw new Error('UserWorkspaceService requires a PostgreSQL database or store');
  }

  return {
    forUser(userId: string) {
      if (!userId) throw new Error('UserWorkspaceService requires a user ID');

      return {
        findUser: () => store.findUser(userId),
        updateUser: (data: UserUpdate) => store.updateUser(userId, data),
        findManyNotesByThreadId: (connectionId: string, threadId: string) =>
          store.findManyNotesByThreadId(userId, connectionId, threadId),
        createNote: (connectionId: string, payload: NoteCreate) => {
          const timestamp = now();
          const safePayload = omitWorkspaceOwnership(payload as Record<string, unknown>);
          return store.createNote({
            ...(safePayload as NoteCreate),
            userId,
            connectionId,
            createdAt: timestamp,
            updatedAt: timestamp,
          });
        },
        updateNote: (connectionId: string, noteId: string, payload: NoteUpdate) => {
          const safePayload = omitWorkspaceOwnership(payload as Record<string, unknown>);
          return store.updateNote(userId, connectionId, noteId, safePayload as NoteUpdate, now());
        },
        updateManyNotes: (connectionId: string, notesToUpdate: NoteOrderUpdate[]) =>
          store.updateManyNotes(userId, connectionId, notesToUpdate, now()),
        findManyNotesByIds: (connectionId: string, noteIds: string[]) =>
          store.findManyNotesByIds(userId, connectionId, noteIds),
        deleteNote: (connectionId: string, noteId: string) =>
          store.deleteNote(userId, connectionId, noteId),
        findNoteById: (connectionId: string, noteId: string) =>
          store.findNoteById(userId, connectionId, noteId),
        findHighestNoteOrder: (connectionId: string) =>
          store.findHighestNoteOrder(userId, connectionId),
        deleteUser: () => store.deleteUser(userId, userDeletionOrder),
        findUserSettings: () => store.findUserSettings(userId),
        findUserHotkeys: () => store.findUserHotkeys(userId),
        insertUserHotkeys: (shortcuts: unknown) =>
          store.upsertUserHotkeys(userId, shortcuts, now()),
        insertUserSettings: (settings: UserSettings) =>
          store.insertUserSettings(userId, randomUUID(), settings, now()),
        updateUserSettings: (settings: UserSettings) =>
          store.upsertUserSettings(userId, randomUUID(), settings, now()),
        listEmailTemplates: () => store.listEmailTemplates(userId),
        createEmailTemplate: (payload: TemplateCreate) => {
          const timestamp = now();
          const safePayload = omitTemplateIdentity(payload as Record<string, unknown>);
          return store.createEmailTemplate({
            ...(safePayload as TemplateCreate),
            id: randomUUID(),
            userId,
            createdAt: timestamp,
            updatedAt: timestamp,
          });
        },
        deleteEmailTemplate: (templateId: string) => store.deleteEmailTemplate(userId, templateId),
        updateEmailTemplate: (templateId: string, data: TemplateUpdate) => {
          const safeData = omitTemplateIdentity(data as Record<string, unknown>);
          return store.updateEmailTemplate(userId, templateId, safeData as TemplateUpdate, now());
        },
      };
    },
  };
};

export type UserWorkspaceService = ReturnType<typeof createUserWorkspaceService>;
export type UserWorkspace = ReturnType<UserWorkspaceService['forUser']>;
