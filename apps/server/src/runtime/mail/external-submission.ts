import { createPostgresExternalMailSubmissionRepository } from '../../modules/external-integration/postgres/mail-submission-repository';
import { processExternalMailSubmission } from '../../modules/external-integration/application/process-mail-submission';
import type { ExternalMailTaskCommand } from '../../modules/mail-tasks';
import { createMailOutboundRuntimeForEnvironment } from './outbound';
import type { MailInboundRuntimeResources } from './inbound';
import { createMailCoreForEnvironment } from './core';
import type { DB } from '../../db';

export const runExternalMailSubmissionCommand = async (
  db: DB,
  resources: MailInboundRuntimeResources,
  command: ExternalMailTaskCommand,
): Promise<void> => {
  await processExternalMailSubmission(command.submissionId, {
    repository: createPostgresExternalMailSubmissionRepository(db),
    core: createMailCoreForEnvironment(db, {
      blobStore: resources.blobStore,
      cursorSigningKey: resources.environment.BETTER_AUTH_SECRET,
    }),
    outbound: createMailOutboundRuntimeForEnvironment(db, resources),
    fetch,
    clock: { now: () => new Date() },
  });
};
