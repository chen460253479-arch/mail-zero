import { type Id } from '@zero/mail-core';
import { ulid } from 'ulid';

import { createMailCoreRuntime, R2BlobStore } from '../../modules/mail';
import { preprocessEmailHtml } from '../../lib/email-processor';
import type { ZeroEnv } from '../../env';
import type { DB } from '../../db';

export const createMailCoreForEnvironment = (db: DB, runtimeEnv: ZeroEnv) =>
  createMailCoreRuntime({
    db,
    blobStore: new R2BlobStore(runtimeEnv.THREADS_BUCKET),
    blobReadAuditSink: { record: async () => undefined },
    clock: { now: () => new Date() },
    idFactory: {
      next<Kind extends string>() {
        return ulid() as Id<Kind>;
      },
    },
    sanitizeHtml: preprocessEmailHtml,
  });
