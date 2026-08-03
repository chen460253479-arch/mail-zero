import { describe, expect, it } from 'vitest';

import {
  isDefaultConnectionSelectable,
  selectDefaultConnectionRecord,
} from '../../../../../src/modules/mail-accounts/application/select-default-connection';

const record = (
  id: string,
  status: 'connected' | 'disconnecting' | 'disconnected' | 'reconnect_required' | 'deleting',
  createdAt: string,
) => ({
  connection: { id, status, createdAt: new Date(createdAt) },
  authorization: null,
});

describe('default mail connection selection', () => {
  it('prefers the requested connection only when it is connected', () => {
    const first = record('first', 'connected', '2026-01-01T00:00:00.000Z');
    const preferred = record('preferred', 'connected', '2026-01-02T00:00:00.000Z');

    expect(selectDefaultConnectionRecord([first, preferred], 'preferred')).toBe(preferred);
  });

  it('ignores a disconnected default and falls back to the first connected connection', () => {
    const disconnected = record('disconnected', 'disconnected', '2025-01-01T00:00:00.000Z');
    const later = record('later', 'connected', '2026-01-02T00:00:00.000Z');
    const earlier = record('earlier', 'connected', '2026-01-01T00:00:00.000Z');

    expect(
      selectDefaultConnectionRecord([disconnected, later, earlier], disconnected.connection.id),
    ).toBe(earlier);
  });

  it('returns null when no connected connection exists', () => {
    expect(
      selectDefaultConnectionRecord(
        [
          record('disconnected', 'disconnected', '2026-01-01T00:00:00.000Z'),
          record('reconnect', 'reconnect_required', '2026-01-02T00:00:00.000Z'),
        ],
        'disconnected',
      ),
    ).toBeNull();
  });

  it('allows only connected connections to be selected explicitly', () => {
    expect(isDefaultConnectionSelectable({ status: 'connected' })).toBe(true);
    expect(isDefaultConnectionSelectable({ status: 'disconnecting' })).toBe(false);
    expect(isDefaultConnectionSelectable({ status: 'disconnected' })).toBe(false);
    expect(isDefaultConnectionSelectable({ status: 'reconnect_required' })).toBe(false);
    expect(isDefaultConnectionSelectable({ status: 'deleting' })).toBe(false);
  });
});
