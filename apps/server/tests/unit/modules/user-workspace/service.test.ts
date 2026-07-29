import { describe, expect, it, vi } from 'vitest';

import {
  createUserWorkspaceService,
  type UserWorkspaceStore,
} from '../../../../src/modules/user-workspace/service';

const createStore = () =>
  ({
    findUser: vi.fn(),
    updateUser: vi.fn(),
    findManyNotesByThreadId: vi.fn(),
    createNote: vi.fn(),
    updateNote: vi.fn(),
    updateManyNotes: vi.fn(),
    findManyNotesByIds: vi.fn(),
    deleteNote: vi.fn(),
    findNoteById: vi.fn(),
    findHighestNoteOrder: vi.fn(),
    deleteUser: vi.fn(),
    findUserSettings: vi.fn(),
    findUserHotkeys: vi.fn(),
    upsertUserHotkeys: vi.fn(),
    insertUserSettings: vi.fn(),
    upsertUserSettings: vi.fn(),
    listEmailTemplates: vi.fn(),
    createEmailTemplate: vi.fn(),
    deleteEmailTemplate: vi.fn(),
    updateEmailTemplate: vi.fn(),
  }) satisfies UserWorkspaceStore;

describe('UserWorkspaceService', () => {
  it('binds every workspace to its authenticated user ID', async () => {
    const store = createStore();
    const workspace = createUserWorkspaceService({ store }).forUser('user-1');

    await workspace.findUser();
    await workspace.updateUser({ name: 'Updated' });
    await workspace.findManyNotesByThreadId('connection-1', 'thread-1');

    expect(store.findUser).toHaveBeenCalledWith('user-1');
    expect(store.updateUser).toHaveBeenCalledWith('user-1', { name: 'Updated' });
    expect(store.findManyNotesByThreadId).toHaveBeenCalledWith(
      'user-1',
      'connection-1',
      'thread-1',
    );
  });

  it('does not allow note or template payloads to replace the bound owner', async () => {
    const store = createStore();
    const workspace = createUserWorkspaceService({
      store,
      randomUUID: () => 'generated-template-id',
      now: () => new Date('2026-07-29T00:00:00.000Z'),
    }).forUser('user-1');

    await workspace.createNote('connection-1', {
      id: 'note-1',
      threadId: 'thread-1',
      content: 'content',
      userId: 'attacker',
      connectionId: 'connection-2',
    } as never);
    await workspace.updateNote('connection-1', 'note-1', {
      content: 'updated',
      userId: 'attacker',
      connectionId: 'connection-2',
    } as never);
    await workspace.createEmailTemplate({
      name: 'Template',
      userId: 'attacker',
      id: 'caller-controlled-id',
    } as never);
    await workspace.updateEmailTemplate('template-1', {
      name: 'Updated',
      userId: 'attacker',
    } as never);

    expect(store.createNote).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        connectionId: 'connection-1',
      }),
    );
    expect(store.updateNote).toHaveBeenCalledWith(
      'user-1',
      'connection-1',
      'note-1',
      { content: 'updated' },
      new Date('2026-07-29T00:00:00.000Z'),
    );
    expect(store.createEmailTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'generated-template-id',
        userId: 'user-1',
      }),
    );
    expect(store.updateEmailTemplate).toHaveBeenCalledWith(
      'user-1',
      'template-1',
      { name: 'Updated' },
      new Date('2026-07-29T00:00:00.000Z'),
    );
  });

  it('awaits settings persistence before resolving', async () => {
    let release!: () => void;
    const persisted = new Promise<void>((resolve) => {
      release = resolve;
    });
    const store = createStore();
    store.upsertUserSettings.mockReturnValue(persisted);
    const workspace = createUserWorkspaceService({ store }).forUser('user-1');
    let completed = false;

    const operation = workspace.updateUserSettings({ language: 'en' } as never).then(() => {
      completed = true;
    });
    await Promise.resolve();

    expect(completed).toBe(false);
    release();
    await operation;
    expect(completed).toBe(true);
  });

  it('uses the preserved transactional deletion sequence', async () => {
    const store = createStore();
    const workspace = createUserWorkspaceService({ store }).forUser('user-1');

    await workspace.deleteUser();

    expect(store.deleteUser).toHaveBeenCalledWith('user-1', [
      'accounts',
      'sessions',
      'settings',
      'user',
      'hotkeys',
    ]);
  });
});
