import { queryThreadDetail } from './thread-detail';
import type { MailViewProjection } from '../port';
import { queryThreadPage } from './thread-page';
import type { DB } from '../../../../db';

export const createPostgresMailViewProjection = (
  db: DB,
  cursorSigningKey: string,
): MailViewProjection => ({
  threadPage: (input) => queryThreadPage(db, input, cursorSigningKey),
  threadDetail: (input) => queryThreadDetail(db, input),
});
